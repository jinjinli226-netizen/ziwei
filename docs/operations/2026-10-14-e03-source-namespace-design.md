# E03 finite source observer / producer ABI / API identity checkpoint

This is a reviewable product checkpoint, not a production source PASS or release. E03 owns this isolated observer/module/source-CLI change. E02 retains native scanner/legacy/HOME interpretation, app/server routing, the existing preservation CLI and packaging. R01 owns the reviewed native producer and authorized lifecycle capture. No real capture, stop, start, deployment, model or device action was performed here.

The previous physical-target correction is `2b45d693b207e2dffe81ac5dcf9f1f942b98c838`. Immutable original `installTargets` and signed `installed.targets/installedDigest` distinguish old stopped identity from approved new running identity.

## Immutable host references

Host-level `nativeSourceRefs` is included in both `specHash` and independently approved `trust.hosts[].bindingDigest`. The production source CLI stays unsafe without native references and original captures. Static reference shape is `{kind,canonicalPath,sha256}`; optional ownership is `{actionId,bindingDigest,originalInstance:{pid,createdAt}}`. `bindingDigest` names the full immutable bound client/API object. Paths and UTC birth times must be canonical. Source reads reject links in any ancestor, hard links and oversized files.

Static kinds: `namespace-policy-v1`, `legacy-source-archive`, `legacy-source-code`, `legacy-action-cache`, `legacy-action-logger`, `legacy-action-assessment`, `native-job-result`, `maintenance-evidence`. Windows action facts require the relevant exact reference kind/action/binding and historical PID/birth. Historical ownership may differ from the current daemon when approved evidence concerns an older action; E02's interpreter must establish that association from actual source material.

Directory references are `{kind,canonicalPath,producerSha256}` plus optional ownership. Kinds are `namespace-capture-directory-v1` and `runtime-identity-directory-v1`; there is at most one policy and one directory of each kind. The producer code digest is approved before capture. It is not the hash of its future output.

Only `before-stop.json` and `after-stop.json` in the namespace directory are authorized source-manifest files. The directory does not authorize arbitrary descendants, directories or databases. The runtime directory supplies the separately verified fresh `runtime-<challenge>.json`; runtime files do not enter the stable original manifest. This avoids a capture-hash/specHash self-reference. R producer writes must use exclusive creation (`wx`) and retain pre/post evidence.

The hashed policy is exactly `{schemaVersion:1,kind:'source-namespace-policy-v1',instances:[{kind,bindingDigest,namespace,identityOrigin}]}` with one entry per immutable original. Linux namespace is `{kind:'systemd-cgroup',unit,controlGroup}`. Windows namespace is `{kind:'windows-source'}`. Origins must be canonical loopback HTTP origins with explicit ports. JSON cannot name callbacks, arbitrary commands or remote endpoints.

## Original capture producer ABI

`createNamespaceCaptureEnvelope({payload,trust,hostId})` is an encoder/signer, not a native collector or lifecycle controller. R01's reviewed producer gathers native observations around already authorized native pause/drain/stop actions. The helper checks the approved host binding and operation/spec before signing; a signature or absent PID cannot supply missing scope facts.

Exact payload fields:

```js
{
 domain:'ziwei-production-namespace-capture-v1',schemaVersion:1,
 producer:'ziwei-source-namespace-v1',producerSha256,
 phase:'before-stop', // or 'after-stop'
 challenge,capturedAt,operationId,specHash,databaseIdentity,freezeDigest,
 bindingDigest:digestProduction(binding),policyDigest:digestProduction(policy),
 previousCaptureDigest:null, // post uses digestProduction(beforeEnvelope)
 instances:[{kind,bindingDigest,originalInstance,process,namespace}],
 workerFacts:null // Windows uses the finite structure below
}
```

Instances may additionally include `nonceDigest` for a real boot-nonce protocol. Pre `process` must report actual `pid,createdAt,nativeBirth,entryPath`; post is null or an actually observed reused PID. Capture time is canonical UTC and cannot be in the future. Post must chain the exact pre envelope and cannot predate it. Captures are durable original evidence (`capturedAt`), while fresh source requests independently bind challenge/TTL and the same operation/spec/database/freeze. There is no `safe` field in the capture schema.

The original Linux API has no API boot nonce: use `identityKind:'systemd-invocation'`, `nonceDigest=SHA256(actual InvocationID)` and `nativeBirth:{bootId,startTicks}` with `createdAt:null`. Ticks are actual `/proc/<pid>/stat` birth ticks, never an invented UTC timestamp. Windows pre-identity uses `identityKind:'legacy-os-start'`, `nonceDigest:null` and actual OS boot/birth. Existing boot-nonce identity remains strict.

Linux raw namespace fields are `kind,unit,controlGroup,InvocationID,KillMode,Delegate,SendSIGKILL,ActiveState,members,bootId,NRestarts,ExecMainStartTimestampMonotonic,ActiveEnterTimestampMonotonic`; optional `MainPID/FragmentPath` are accepted. The default Linux reader uses `systemctl show`, recursive actual cgroup `cgroup.procs`, and actual boot ID. Required flags are control-group kill, no delegation, and SIGKILL enabled. Pre includes original PID; post is empty and inactive/failed. Prepare/seal/abort also compare fresh post-stop invocation/restart/start markers, detecting restart followed by another exit. Restore allows only the independently verified new runtime PID, retaining the stopped-original proof.

Windows daemon is not a persistent Job. Snapshot shape is `{kind:'windows-source',visibility:'native-memory-and-registry',members,unresolved}`. Complete current native coverage is required and post scope must be empty. `workerFacts` is exactly `{kind:'windows-source-facts-v1',completeConnections:true,completeSameBootLogger:true,completeMaintenance:true,unresolved:[],sourceBindings:[approved static hashes],actions:[...]}`.

Every ACKed Windows action needs an exact digest-bound disposition. `job` fields are `actionId,actionDigest,kind,jobName,nonce,hostPid,processExit,evidenceSha256`; the approved `native-job-result` for that action must match raw schema/nonce/name/host/tree and the actual original action `resultExit`, with tree confirmed and zero active processes. Another exited Job cannot be borrowed. `never-dispatched` fields are `actionId,actionDigest,kind,bindingDigest,originalInstance,interpreterVerified,codeDigest,cachePrefixDigest,sameBootLoggerDigest,assessmentDigest`. Each digest must resolve to its correct reference kind/action/binding and the same historical PID/birth. `interpreterVerified` is an output of E02's reviewed interpretation, not an ops assertion. This finite scope validator does not itself interpret old source/cache/logger content or create a semantic legacy exception. Raw spawn, historical success, root-only exit or missing evidence remains unknown.

Native semantics: [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [systemd Control Group Interface](https://systemd.io/CONTROL_GROUP_INTERFACE/). Required facts are checked rather than inferred from a namespace name or last-handle close.

## Private API identity interface for E02

Exports are `createApiIdentityRequest({sourceRequest,trust,target})`, `createProductionApiIdentityHandler({db,trust,hostId})`, `verifyApiIdentityProof({envelope,trust,request,target,process})` and `verifyRuntimeCaptureEnvelope({envelope,trust,request})`.

E02 can mount the factory at an explicitly configured private `POST /internal/preservation/identity`, using existing `repo.db` and independent host trust. Do not construct another repository/DB or configure this by public request JSON. The handler enforces loopback, HMAC/domain/host/approved spec/target/freshness, sets `Cache-Control:no-store`, reads only, and returns finite 403 refusal.

Before listening, the factory captures physical loaded root/entry, actual `PRODUCT_ROLE` (V2 required), role descriptor/source closure, process PID and a newly generated per-process nonce digest/identity initialization time. Requests cannot replace boot facts. Approved same-batch source closure is checked. Code-only IO injection exists for tests/platform implementation; JSON cannot supply it.

Request domain is `ziwei-production-api-identity-request-v1`, with exact fields `domain,schemaVersion,kind:'api-runtime',command:'restore',challenge,issuedAt,expiresAt,operationId,specHash,databaseIdentity,freezeDigest,binding,target,expectedSources,controlIdentity`. It is derived from a validated fresh product source request and its exact approved API target.

Proof domain is `ziwei-production-api-identity-proof-v1`, with exact fields `domain,schemaVersion,service:'ziwei-api',command:'restore',challenge,issuedAt,expiresAt,operationId,specHash,freezeDigest,targetDigest,pid,startedAt,nonceDigest,root,entryPath,productRole,buildDigest,bootSourcesDigest,databaseIdentity,fenceState,intentDigest,snapshotDigest,versionsDigest`. Actual DB/control comes from the existing connection: canonical main filename, physical dev/ino, persisted databaseId, same operation's sealed state/frozen versions/intent/snapshot. Signer host and approved target are pinned; inner API nonce must equal the outer runtime sample nonce.

The default Linux DB-handle check examines actual `/proc/self/fd` SQLite main-file descriptors, conservatively requires all such descriptors in the API process to have the same physical identity, and pins it at factory initialization. Every response rechecks this identity against current path and request. A copied/renamed handle cannot borrow the old filename/databaseId; additional SQLite main databases are refused until a reviewed precise mapping exists. This Linux native path needs independent Linux qualification. Windows fixture IO does not qualify Linux FD behavior; non-Linux default handle inspection is unsupported.

R01's reviewed producer performs the actual private API probe and writes a fresh signed runtime capture. Source observer performs no network calls; it separately checks real PID birth/entry and socket owner. Runtime payload exact fields are `domain:'ziwei-production-runtime-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256,command:'restore',challenge,issuedAt,expiresAt,operationId,specHash,databaseIdentity,freezeDigest,bindingDigest,installedDigest,instances`. API sample exact fields are `kind,bindingDigest,targetDigest,root,entryPath,productRole,buildDigest,pid,nativeBirth,nonceDigest,apiIdentity`; approved host targets must be covered once each. Runtime proof is excluded from stable original evidence digest but separately verified by observer and product adapter, including correspondence with running observations.

## Explicit limits and next ownership

Default Windows full native memory/registry inspection returns `SOURCE_WINDOWS_NATIVE_INSPECTION_REQUIRED`. Client runtime capture returns `SOURCE_RUNTIME_CLIENT_IDENTITY_UNSUPPORTED`; copied health JSON and `maintenance.safe:true` cannot establish loaded client identity. These are explicit unknown outcomes, not green fixture claims.

E02 must combine its clean legacy/scanner/HOME implementation, mount the private API factory under explicit configuration, and include the new module in loaded package/source closure. Windows scope facts do not become a semantic legacy exception: E02 must supply actual actionDigest/host/operation/spec/challenge-bound interpretation. E03's current base retains the old scanner, so standalone real Windows CLI remains refused. Root/R01 can review this clean finite ABI and prepare the actual producer. Actual lifecycle capture, supported Windows native inspection, attested client runtime identity and Q01 exact combined package qualification remain gates.

Cross-host source checks use only each host's A2A scope, with API-owned queues retained. Per-host bindings must exactly equal derived action scope; extra/duplicate/foreign bindings and legacy assessments are rejected. Product rechecks the complete global projection/debt after all host proofs verify. Tests cover Windows expired-ACK evidence only on its owner host, API host without that device, wrong host/digest/unowned device and global pending rejection before first schema write. Targeted production/crypto/namespace/hooks/version/native-seal test counts, lint and diff checks are recorded in the clean handoff; they are not production source PASS.

## Next finite Windows interfaces (planned, not exported by this commit)

Root clarified ownership after review: E03 owns this new module's default Windows `readNamespace` and client runtime identity verification/factory. E02 owns one private read-only daemon client identity hook and one private app API hook. These Windows paths must be completed for the final user goal; the fixture count does not make the product ready for deployment. R01 must use only clean documented interfaces, not assume planned exports already exist.

Proposed factory: `createProductionClientIdentityHandler({trust,hostId,boot,readState})`. Trusted daemon startup code supplies immutable `boot:{nonce,startedAt,clientBuild,configPath,runtimeDir}` from its actual own lifecycle nonce, boot timestamp, already loaded client build and existing configuration/runtime variables. The factory independently captures actual process PID, physical module root/argv entry, actual PRODUCT_ROLE, source closure, configuration file hash and original configured connection scope before listening. `readState()` is code supplied by the daemon, not JSON; it reads current action/poll/delivery/auxiliary/connection state from existing runtime objects without executing actions. E02 mounts that returned handler under explicit private host-trust configuration. The factory's physical startup/config/source checks remain its responsibility; startup strings or a descriptor label alone cannot certify a client.

Proposed signed request domain is `ziwei-production-client-identity-request-v1`. Minimum fields are `domain,schemaVersion,kind:'client-runtime',command:'restore',challenge,issuedAt,expiresAt,operationId,specHash,freezeDigest,binding,target,expectedSources,originScope,workspaceScope`. `target` is the approved client installation; origins come from the immutable authorization, and workspace ID/slug mapping is restricted to the binding. Derivation must validate the fresh signed product source request and independent host trust. No auth, environment, action text or callback names enter this payload.

Proposed separate proof domain is `ziwei-production-client-identity-proof-v1`. Minimum actual fields are `domain,schemaVersion,service:'ziwei_user',command:'restore',challenge,issuedAt,expiresAt,operationId,specHash,freezeDigest,requestDigest,targetDigest,pid,startedAt,nonceDigest,root,entryPath,productRole,clientBuild,bootSourcesDigest,configPath,configSha256,runtimeDir,connections,activeActionCount,pollingCount,pendingDeliveryCount,blockedDeliveryCount,managedAuxiliaryCount`. Exact field closure and the source-list representation must be frozen in the next tested commit before R adoption. Connection facts name actual approved origin/device/workspace and their original runtime scope. Client has no main server DB connection: it does not emit asserted `databaseIdentity`, `databaseId` or `fenceState:'sealed'`. Linux API's actual same-DB/sealed proof plus product aggregate checks remain responsible for those facts. Source independently verifies fresh client signature/host/challenge/target/boot nonce, real CIM birth/entry and exact listening owner, then approved source/config/connection scope.

Default Windows namespace IO needs bounded context, proposed as `readNamespace(selector,{binding,original,request,nativeRefs})`, supplied by product code. It may read only approved physical source/runtime/connection paths and referenced snapshots/results, plus bounded native CIM/handle/registry observations of that exact original daemon and associated workers/updaters. Required inputs are complete original connections/action/delivery/cache/same-boot logger sources, precise original birth and source/config identity, retained native worker/Job results when execution occurred, update/uninstall maintenance scope, and fresh independent native scope observations. CIM PID/argv absence alone cannot set completeness. Daemon is not assigned an invented persistent Job; unknown raw-spawn workers, unreadable required native state, missing archived handler provenance or ambiguous HOME/maintenance ownership stays unknown. This work does not create a general OS/env/auth inspection framework or perform lifecycle/device actions. Fresh actual signed client runtime identity complements this scope check; unauthenticated health JSON cannot replace it.

This next Windows implementation and E02 hook integration are separate finite work after the clean checkpoint, using actual source inputs rather than fabricated production evidence.
