# Server-only code rollout contract — 2026-10-14

This is a separate server code rollout, not prepare/seal/restore of the original data/native generation. It retains the same physical main database, object store, environment encryption key and current objects/tombstones. It does not clear, rewrite or replay original action payload/result/ACK/lease rows. The existing production semantic debt, native kernel, HOME and version-preservation guards remain unchanged.

The trial mode keeps all device execution closed. There is no positive client-qualification branch: online heartbeat, reported build/protocol/Hermes version, old validated_revision and request booleans cannot admit execution. It cannot stop work already cached or executing on an old client, and it does not claim that Windows/native workers were drained. Future per-device reopening requires a separate actual installed-and-running qualification implementation.

## Exact operator input

Run the planner **from the actual unpacked API package**, whose module ROOT contains preservation-package.json, with the original environment files/keys retained:

```sh
/opt/node-v24.13.0-linux-x64/bin/node /opt/ziwei/releases/server-first-CANDIDATE/v2/scripts/server-code-rollout.mjs plan --database /opt/ziwei/data/ziwei.sqlite --packages /opt/ziwei/.local/server-first/ROLLOUT/packages --objects /opt/ziwei/data/objects --environment-key /opt/ziwei/.local/employee-env.key --rollout-id ROLLOUT_UUID --output /opt/ziwei/.local/server-first/ROLLOUT/mode.json
```

The existing configured ZIWEI_ENV_ENCRYPTION_KEY / ZIWEI_SECRET_KEY takes precedence over the original file, exactly as the repository did. Never generate or substitute a new key. The planner writes a new private file with exclusive creation, prints only path/pin/rollout/source metadata, and reads database **copies**, leaving the original DB/WAL/SHM unchanged. Precreate the private canonical parent directory with the service's existing owner/access; the mode file must be a regular single-link file, mode 0600 on Linux, readable by the actual API service.

The schema is closed:

```js
{
  schemaVersion: 1,
  kind: 'server-code-rollout-v1',
  rolloutId: 'UUID',
  candidateCommit: '40-char SHA',
  database: {
    databaseId: 'UUID',
    canonicalPath: '/opt/ziwei/data/ziwei.sqlite',
    identity: {dev: 'decimal string', ino: 'decimal string'}
  },
  storage: {
    objectStoreDir: '/opt/ziwei/data/objects',
    environmentKey: {kind: 'configured', sha256: 'SHA256'}
    // OR {kind:'file', canonicalPath:'/opt/ziwei/.local/employee-env.key', sha256:'SHA256'}
  },
  releases: [
    {productRole:'v2', manifestPath:'canonical v2-manifest.json', manifestSha256:'SHA256', apiArtifactPath:'canonical v2-api.zip', apiArtifactSha256:'SHA256'},
    {productRole:'v1-compat', manifestPath:'canonical v1-compat-manifest.json', manifestSha256:'SHA256', apiArtifactPath:'canonical v1-compat-api.zip', apiArtifactSha256:'SHA256'}
  ],
  scheduler: 'disabled',
  deviceExecution: 'blocked'
}
```

Keep approval separate from this JSON. The deployment environment must pin the exact file bytes:

```sh
ZIWEI_SERVER_CODE_ROLLOUT_CONFIG=/opt/ziwei/.local/server-first/ROLLOUT/mode.json
ZIWEI_SERVER_CODE_ROLLOUT_CONFIG_SHA256=EXACT_CONFIG_SHA256
ZIWEI_DB_FILE=/opt/ziwei/data/ziwei.sqlite
ZIWEI_OBJECT_STORE_DIR=/opt/ziwei/data/objects
```

Continue using the existing API host/port/service and prior auth/origin/environment files. No new local listener or port is introduced by this implementation. Do not place the private mode file, key hashes, secrets or real database facts in Git or public artifacts.

## Startup, persistent binding and rollback

Preflight runs before mkdir or a writable SQLite open. Approved mode requires the existing exact canonical DB path/dev/ino, complete actual packaged API source files, descriptor product role/frozen versions, same candidate, both manifest pins and API archive bytes, original object directory and original key. A missing mode configuration is detected on copies of an existing database; it cannot create an empty wrong-path database or change the protected DB/WAL/SHM.

Production initialization additionally uses the existing Linux fstat/pread database connection identity reader. It refuses a path/handle swap or unsupported native handle reader. Only then may it add server_code_rollout control metadata and additive schema. It registers original preservation SQL functions but skips all historical startup UPDATE/backfill/seed paths in this mode. The original production_preservation_identity, version state, native proofs and full migration receipts are not changed or manufactured.

The durable server_code_rollout singleton stores rollout_id, database_id/path/identity, config_sha256, batch_commit, the complete approved mode_json and initial created_at. Private SQL triggers reject control rewrite/delete. Once present, missing/wrong approval, DB, source, role or storage refuses startup. Repository injection accepts only a real constructor-branded repository bound to that same mode, not a caller's truthy field or a repository constructed with different key/object-store closures.

Rollback switches only to **this same batch's v1-compat API**, using the same mode file/pin, database inode/id, objects and original key. Both role packages include the new controller/entry and register existing ziwei_v2 SQL functions. Do not start bare historical a66 code on the upgraded current DB and do not restore an old whole database. Trial documents, configuration, object bytes, deletions and tombstones remain current; rollout metadata is not rewritten merely to report the alternate running role.

R owns deployment operations. Before first bootstrap, stop the actual main API writer, census its DB writer FDs, take a current consistent SQLite backup and object/config readback with integrity/FK checks, and retain an external private receipt. That receipt is server code-rollout backup evidence, not a full native/HOME preservation proof. Keep unrelated control API/nginx services and their existing ports under their established ownership.

## Closed execution and honest draft behavior

The policy blocks all new A2A actions, including unknown/unbound types and provision/validate/directory/cancel/maintenance; daemon poll (including status=all), device action GET, ordinary ACK/renew/start/gateway/admission, task/chat dispatch, manual/scheduled/retry routines, management retry/bootstrap, phone bootstrap and remote phone command/update/control paths. Additive SQL action guards reject INSERT/DELETE and changes to original execution identity/lease/payload fields. A copied boolean, supplied repository or forged this receiver cannot reopen the mode.

An original bound ACK can yield only a receipt without execution payload or lease renewal. Original authenticated valid results and events remain subject to their existing workspace/device/receipt checks; pending actions cannot self-submit a terminal result. Terminal original results remain idempotent. Successful collaboration receipts are still verified, but no follow-on collaboration action is dispatched. Old failed routine results are recorded without retry/webhook creation or delivery. Scheduler cannot be re-enabled by enableScheduler:true. Poll/history do not expire old action rows.

Heartbeat and stored history remain available. Model selection reads saved runtime metadata instead of launching local CLI discovery. Server configuration, independent profile/HOME **planning**, documents and draft employees remain editable under original permission boundaries. New Bot creates one employee/main conversation/owned-profile identity as a draft with waiting_client, no provision action, no invented actual HOME and no native work. Explicit provisioning, validation, activation and execution refuse. Pure server pause changes configuration only, preserves occupancy/actions and makes no claim of native stop. Existing UI shows the waiting/closed message and accepts the saved draft without a missing-provision error.

Health and workspace/device/Bot views report mode:server-only-code-rollout, actual productRole/candidate/build/manifest pin, databaseId, scheduler:disabled, deviceExecution:blocked, clientQualification:not_available and SERVER_CODE_ROLLOUT_CLIENT_REQUIRED. They do not report drained/nativePassed or a full migration completion.

## Observed finite checks

macOS, Node v24.14.0:

- node --test test/server-code-rollout.test.mjs frontend/src/bot-owned-profile.test.mjs: **23 passed, 0 failed** (six server-mode groups and seventeen related UI checks).
- node scripts/lint.mjs: **133 source files passed**.
- git diff --check and builder syntax: passed.

The tests use isolated package/SQLite/source fixtures, project lockfile dependencies, and an explicitly separate constructor IO seam for the simulated already-open DB handle. They are not Mac native adaptation or actual Linux handle/deployment evidence. The compatibility fixture uses the role-patched API code; actual builder archives and Linux same-batch compatibility startup require Q/R's separate package validation. Unit checks cover wrong-path/no-file effects; missing config preserving DB/WAL/SHM; source/approval/handle mismatch; old/missing/spoofed devices; zero-action Bot draft; pure pause; fixed scheduler; original expired+ACK row bytes/debt; legitimate results; current document object/tombstone preservation; repository branding and forged-receiver retry/webhook refusal.

No local listener, real model/phone, Windows restart, production stop or server deployment was performed by E03. R remains the sole publisher/operator; user has already authorized server deployment after finite package acceptance.

2026-10-14 a1d69c3 四项收尾：冻结 V1 overlay 同步 management bootstrap 拒绝、事件不续租、草稿设备选择；repository 使用构造器私有来源和最终函数身份校验，公开 guard 不可为复制对象登记。
服务器模式模块及其 CLI 保留于 API/shared，移出客户端显式 files，以免引入服务器 repository 依赖。
有限验证：`node --test test/server-code-rollout.test.mjs` 8/8；包含冻结 V1 实际源码 overlay 锚点与 bootstrap 调用，以及复制/descriptor复制/替换存储函数负例。草稿分支和事件续租目前为严格源码锚点证据，实际 V1 Linux 运行探针仍由 Q 完成。
本提交未建包、未停止或切换生产；R 必须创建全新批次，禁止复用 a1d69c3 的 NO_GO 产物。
