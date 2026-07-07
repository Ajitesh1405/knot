// Both the compose and scheduler HITL graphs own a PostgresSaver pointed at the
// same `langgraph` schema, and each runs `.setup()` in its own onModuleInit.
// Nest fires module-init hooks concurrently (Promise.all), so the two setups
// race to create the shared `checkpoint_migrations` objects — Postgres then
// throws `duplicate key value violates unique constraint pg_type_typname_nsp_index`.
//
// `.setup()` is idempotent when run one-at-a-time, so we simply serialize the
// calls through a module-level promise chain. The first call creates the
// tables; the second sees them already present and no-ops.
let chain: Promise<void> = Promise.resolve();

export function serializeCheckpointerSetup(
  run: () => Promise<void>,
): Promise<void> {
  // Run `run` only after any previously queued setup settles (success or
  // failure), so the actual setups never overlap.
  const next = chain.then(run, run);
  // Keep the chain alive even if this setup rejects — swallow here so a failure
  // doesn't poison later links; the awaited `next` still surfaces the error.
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
