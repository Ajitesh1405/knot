import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';

@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private driver!: Driver;

  // ─── Lifecycle: connect when the app starts, disconnect on shutdown ──
  onModuleInit() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    );
  }

  async onModuleDestroy() {
    await this.driver.close();
  }

  // ─── Add a node (or update if exists) ────────────────────────────────
  async upsertNode(userId: string, label: string, name: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (n:${this.safeLabel(label)} { name: $name, ownerId: $userId }) RETURN n`,
        { name, userId },
      );
    } finally {
      await session.close();
    }
  }

  // ─── Add a relationship between two nodes ────────────────────────────

  async upsertRelation(
    userId: string,
    fromName: string,
    relation: string,
    toName: string,
  ) {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (a { name: $from, ownerId: $userId }), (b { name: $to, ownerId: $userId })
       MERGE (a)-[r:${this.safeLabel(relation)}]->(b)
       RETURN r`,
        { from: fromName, to: toName, userId },
      );
    } finally {
      await session.close();
    }
  }

  // ─── Read all nodes + edges (for visualization later) ────────────────
  async getAll(userId: string) {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n { ownerId: $userId })
       OPTIONAL MATCH (n)-[r]->(m { ownerId: $userId })
       RETURN n, r, m`,
        { userId },
      );
      const nodes = new Map<string, { name: string; label: string }>();
      const edges: { from: string; to: string; type: string }[] = [];

      for (const record of result.records) {
        const n = record.get('n');
        nodes.set(n.properties.name, {
          name: n.properties.name,
          label: n.labels[0],
        });

        const r = record.get('r');
        const m = record.get('m');
        if (r && m) {
          nodes.set(m.properties.name, {
            name: m.properties.name,
            label: m.labels[0],
          });
          edges.push({
            from: n.properties.name,
            to: m.properties.name,
            type: r.type,
          });
        }
      }

      return { nodes: [...nodes.values()], edges };
    } finally {
      await session.close();
    }
  }

  // ─── Get facts as readable text for the Q&A prompt ───────────────────
  async getFactsAsText(userId: string): Promise<string> {
    const { nodes, edges } = await this.getAll(userId);
    if (nodes.length === 0) return '(nothing taught yet)';

    const lines = edges.map(
      (e) => `${e.from} ${e.type.toLowerCase().replace(/_/g, ' ')} ${e.to}`,
    );
    return lines.join('\n');
  }

  // ─── Facts about one entity (1-hop neighbourhood) as readable text ──
  // Used by ComposeSpecialist for recipient-relevant context, instead of
  // dumping the entire graph. `aliases` lets a display name ("Sarah Mehta"),
  // a first name ("Sarah"), and an email's local-part ("sarah.mehta") all
  // resolve to the same node — caller passes every form it knows.
  async getFactsAbout(userId: string, aliases: string[]): Promise<string> {
    // Keep meaningful tokens only (drop 1-char noise that matches everything).
    const terms = [...new Set(aliases.map((a) => a.toLowerCase().trim()))]
      .filter((a) => a.length >= 3);
    if (terms.length === 0) return '(nothing known about them yet)';

    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n { ownerId: $userId })
         WHERE any(t IN $terms WHERE toLower(n.name) CONTAINS t)
         OPTIONAL MATCH (n)-[r]-(m { ownerId: $userId })
         RETURN n, r, m`,
        { userId, terms },
      );
      const lines: string[] = [];
      for (const record of result.records) {
        const n = record.get('n');
        const r = record.get('r');
        const m = record.get('m');
        if (r && m) {
          const rel = r.type.toLowerCase().replace(/_/g, ' ');
          // edge direction can point either way after the undirected match
          const forward = r.start.equals(n.identity);
          lines.push(
            forward
              ? `${n.properties.name} ${rel} ${m.properties.name}`
              : `${m.properties.name} ${rel} ${n.properties.name}`,
          );
        }
      }
      return lines.length ? lines.join('\n') : '(nothing known about them yet)';
    } finally {
      await session.close();
    }
  }

  // ─── Cypher injection guard ──────────────────────────────────────────
  // Labels and relationship types can't be parameterized in Cypher, so we
  // must whitelist characters to prevent injection.
  private safeLabel(input: string): string {
    return input.replace(/[^A-Za-z0-9_]/g, '');
  }
}
