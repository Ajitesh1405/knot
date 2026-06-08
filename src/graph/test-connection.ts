import 'dotenv/config';
import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
);

async function test() {
  const session = driver.session();
  try {
    const result = await session.run("RETURN 'connected' AS status");
    console.log('✓', result.records[0].get('status'));
  } finally {
    await session.close();
    await driver.close();
  }
}

test().catch(console.error);
