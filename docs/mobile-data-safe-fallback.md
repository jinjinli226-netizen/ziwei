# Mobile data compatibility fallback

This branch prepares a compatibility fallback on base
`8629091c2993e32625b25cfe7835805541286f4f`. It has not been deployed.
The only changed product runtime file is `backend/repository.mjs`, using the
same canonical Git blob as reviewed source
`20da8856beb7f008d8c3b85f65103f53b9deef19` (SHA-256
`f81d9aa44c3ebaf3c44df7280fff561a89fb59622e187311409f090062781878`).
No mobile feed, application route, Android code, database migration, dependency
or client update is introduced here.

The fallback retains server-derived assignment evidence when a task is created
or its persisted assignee actually changes. Unknown and unassigned replacements
write explicit markers. Task, audit and notification writes share a savepoint;
public callbacks wait for commit, including existing template transactions.
The original task body and response shapes remain unchanged. Reads and same-value
full DTO saves do not manufacture evidence for legacy tasks.

Assignment evidence remains in the internal audit row. Public audit rows,
notification raw JSON and parsed payloads, archive/restore responses and outgoing
events strip only the top-level `assignmentBinding` field of `task.created` and
`task.updated`. Old rows are projected without being rewritten. Other event
types and task rows without that field retain their original payload bytes.

## Why a projection-only rollback is insufficient

An unmodified old writer can change A → B → A without an assignment marker.
The newer feed can then find an older A proof whose text hash matches again.
If the original public employee was renamed and the A alias now belongs to a
private employee, that proof identifies the wrong employee. The test suite has
an explicit negative control using the complete, unmodified base repository to
demonstrate this condition. Its expected unsafe result is not an accepted
fallback result.

The trusted writer, real-change markers, atomic writes and public projection
must be kept together. If the unmodified old writer has already been used on a
database, this fallback does not reconstruct missing history. Keep the new feed
disabled until affected assignments have fresh trusted evidence. This branch
does not automatically deploy, switch a production release, recover a database,
or update devices.

## Portable verification

Use Node.js with `node:sqlite`, Python 3 and the project's existing dependencies.
The source repository must contain both fixed commits above. The verifier fails
if a commit is unavailable, a pinned source hash differs, dependencies are
missing, the fallback runtime differs, or the test process fails or is signalled.
There are no default skipped tests.

```sh
node scripts/verify-mobile-data-safe-fallback.mjs \
  --source-repo /path/to/repository-containing-reviewed-commits \
  --dependencies /path/to/existing/node_modules \
  --report .local/mobile-data-safe-fallback/verification-result.json
```

This checkout must have its normal `node_modules`, since the tests also import
its checked-out repository and application modules. `--dependencies` selects the
dependency directory for the frozen archive copies; it does not replace that
checkout prerequisite. Both path arguments are optional when this checkout
already contains the Git objects and has its normal `node_modules`. `--source-commit`, if provided, must
equal the fixed reviewed forward commit. No machine-specific path is built into
the verifier. The report and adjacent TAP log are local evidence, not source
inputs or release authorization.

The verifier runs five assignment-writer tests and six compatibility tests.
The latter extract the complete fixed base/forward source modules into a
validated temporary archive and import the actual repository implementations;
they do not replace writer functions or simulate their SQL. Each round-trip
case uses its own temporary SQLite file, explicit fixture encryption key and
object directory. Connections are closed before each new → fallback → new
phase, and the temporary files are removed after testing.

Coverage includes the A/B/A alias takeover and old-writer negative control,
unresolved/unassigned/fresh task markers, original proof bytes, old task DTO and
schema compatibility, numeric SQLite echoes, audit/notification failure rollback,
authenticated member HTTP/SSE reads, historical notification copies,
archive/restore, deferred commit and rollback, and the WebSocket-shared event
payload. The round-trip test process throws if `net.Server.listen` is called;
HTTP requests use in-memory streams. WebSocket payload coverage uses the same
hub envelope, without a network handshake. No models or real databases are used.

Production packaging, deployment, service switching and production rollback
remain separate work requiring review of the exact release and data identity.
