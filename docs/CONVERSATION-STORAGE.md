# PostgreSQL conversation storage

The shared history boundary selects PostgreSQL when `JARVIS_DATABASE_URL` or a private `postgres.env` in the bridge state directory is configured. The file contains one `DATABASE_URL` entry; it must be owned by the current user, regular, and mode 0600. Credentials never belong in source or frontend configuration. Use a dedicated database and non-administrative role. Unconfigured installations retain JSON compatibility. Configured database failures fail closed; they never silently switch back to JSON.

Install runtime dependencies with `npm ci --omit=dev` before enabling PostgreSQL. Only this optional backend needs the `pg` runtime driver; source packages include its locked dependency but not node_modules. `JARVIS_DATABASE_SCHEMA` optionally selects a validated schema name for isolated deployments/tests; the default is `jarvis_memory`. Do not point independent installations at one schema.

On startup, migrations run under a transaction and advisory lock before requests are accepted. Version 1 stores stable conversation/message IDs, original text, timestamps, agent/model metadata, per-thread provider-session references, ordered message sequences and an import ledger. The existing adapter session file remains the resume cache until explicit thread continuation is added. Personality remains in its existing shared private store.

The first import reads history.json, conversations.json and sessions.json, saves a mode-0600 legacy snapshot in the private memory-backups directory, and imports all messages transactionally. Original files remain untouched. Invalid data aborts the entire import; correcting it permits a safe retry. Successful imports have a ledger marker and never duplicate rows on restart. Full transcripts remain authoritative. Reset archives active conversations instead of deleting their messages.

## Activation and recovery

Stop the bridge only after its reply finishes before an offline migration or configuration change. Never import from JSON while an older bridge can still append to it. Configure the private connection and start the managed bridge normally; its first startup migrates the final JSON state. Do not restart an active conversation merely to activate storage.

Maintenance commands, run from the source root with the bridge stopped:

- `node scripts/conversation-storage.mjs migrate STATE_DIRECTORY`: transactional, retryable import.
- `node scripts/conversation-storage.mjs backup STATE_DIRECTORY`: consistent private snapshot including provider session references.
- `node scripts/conversation-storage.mjs restore-empty STATE_DIRECTORY SNAPSHOT`: restore to a migrated but empty schema; refuses populated destinations and rolls back on errors.

For a code rollback immediately before activation, originals remain available. After PostgreSQL has accepted new messages, old JSON is stale: keep PostgreSQL enabled or restore the latest database snapshot into an empty recovery destination. Never switch back to old JSON and claim it contains new database messages. No destructive down migration or automatic database clearing is provided. Keep private backups separately; volume persistence is not a backup. Database backups and legacy snapshots contain conversations and session identifiers and need the same protection as live history.

## Verification

`JARVIS_TEST_DATABASE_ENV=PRIVATE_PROJECT_ENV node tests/postgres-history.mjs` uses synthetic messages and uniquely named schemas, and removes only those test schemas. It verifies restricted-role privileges, exact preservation, ordering, concurrent appends, stable IDs, restart persistence, idempotent import, private backups, restore and failed-transaction rollback/retry. It never imports real history. The existing integration and kanban-bridge tests exercise authenticated shared clients and the serialized runner with fake agents. Search, embedding models, summaries and conversation-selection UI belong to later stages and are not enabled by this storage change.
