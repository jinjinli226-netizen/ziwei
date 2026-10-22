import {PRESERVED_ADMIN_EMAIL, fingerprintCleanupManifest, validateCleanupManifest} from './vendor/cleanup-manifest.mjs';

const key = ref => JSON.stringify([ref.kind,ref.type,ref.id]);
/** Pure proposed dispositions. No SQL execution or trusted-context construction. */
export function prepareCleanupManifest(probe, {syntheticFixture = false, backupEvidence, restoreEvidence, createdAt = new Date().toISOString(), batchId = 'workspace-review-' + probe.sourceFingerprint.slice(0,16)} = {}) {
  if (probe?.service !== 'workspace' || probe?.readOnly !== true || probe?.queryOnly !== true) throw new TypeError('A native workspace read-only probe is required');
  const blockers = new Set(probe.blockers);
  blockers.add('independent-reviewed-batch-not-provided');
  if (!syntheticFixture) blockers.add('pending_source_baseline');
  const protectedKeys = new Set([...probe.administrator.loginAccountRefs,...probe.administrator.associatedResourceRefs].map(key));
  const items = probe.resources.map(row => {
    let decision = protectedKeys.has(key(row.ref)) || row.ownership.classification === 'preserved-admin' ? 'preserve':'pending';
    if (syntheticFixture && probe.administrator.accountResolution === 'verified' && row.ownership.classification === 'other-login-account' && row.ownership.loginAccountRefs.length === 1 && ['login-account','business-resource'].includes(row.ref.kind)) decision = 'delete';
    return {resource:row.ref,decision,reason:decision === 'preserve'?'Protected native administrator reference; preserve the original ID and data without transferring other assets.':decision === 'delete'?'Synthetic fixture only: exclusive native login owner is independently represented in this proposed batch.':'Ownership, native dependencies or authoritative source baseline requires review; no deletion or reassignment.',ownership:structuredClone(row.ownership),dependencies:structuredClone(row.dependencies),cascade:{mode:'none',targets:[],explanation:'No deletion is executed. Structural reverse cascades are retained in the independent probe.',evidenceRefs:['native-probe#cascade:' + row.table]},nativeDisposition:['login-account','business-resource'].includes(row.ref.kind)?null:{treatment:'not-a-login-account',evidenceRefs:['native-probe#asset-kind:' + row.table]},evidenceRefs:['native-probe#resource:' + row.table]};
  });
  const byKey = new Map(items.map(row => [key(row.resource),row]));
  // Unknown/unprojected native tables may depend on a candidate. Incomplete
  // inventory blocks the whole deletion proposal instead of inventing owners.
  if (!probe.complete) for(const row of items)if(row.decision==='delete'){row.decision='pending';row.reason='retained-dependency:incomplete-native-inventory';blockers.add(row.reason);}
  let changed;
  do {
    changed = false;
    const block = (row, reason) => {if(row?.decision==='delete'){row.decision='pending';row.reason=reason;changed=true;blockers.add(reason);}};
    for (const row of items) {
      if (row.decision !== 'delete') for (const dependency of row.dependencies) if (dependency.onTargetDelete !== 'no-impact') block(byKey.get(key(dependency.target)), 'retained-dependency:' + dependency.target.type);
      if (row.decision === 'delete' && row.resource.kind !== 'login-account') {
        const owner = row.ownership.loginAccountRefs.length === 1 ? byKey.get(key(row.ownership.loginAccountRefs[0])) : null;
        if (owner?.decision !== 'delete') block(row,'owner-not-in-reviewed-deletion-set:' + row.resource.type);
      }
    }
    for (const resource of probe.resources) {
      const row = byKey.get(key(resource.ref));
      if (row.decision === 'delete' && resource.cascadeTargets.some(target => byKey.get(key(target))?.decision !== 'delete')) block(row,'retained-dependency:cascade:' + resource.ref.type);
    }
  } while (changed);
  for (const resource of probe.resources) {
    const row = byKey.get(key(resource.ref));
    if (row.decision === 'delete' && resource.cascadeTargets.length) row.cascade={mode:'explicit-only',targets:resource.cascadeTargets,explanation:'Only explicitly enumerated same-batch synthetic deletion targets. Cross-boundary cascades block the parent.',evidenceRefs:['native-probe#reverse-cascade:' + resource.table]};
  }
  const summary = {total:items.length,preserve:0,delete:0,pending:0};
  for (const row of items) summary[row.decision]++;
  const backup = backupEvidence || {status:'planned',evidenceRef:'pending:restricted-consistent-backup',sourceFingerprint:probe.sourceFingerprint,consistencyEvidenceRef:'pending:sqlite-snapshot',accessPolicyRef:'pending:restricted-backup-access',retentionPolicyRef:'pending:retention-review'};
  const restore = restoreEvidence || {status:'not-run',evidenceRef:'pending:isolated-restore',isolated:false,administratorPreserved:false,collaborationPreserved:null};
  if (!backupEvidence) blockers.add('no-real-backup-artifact-or-fingerprint');
  if (!restoreEvidence) blockers.add('isolated-restore-not-run');
  const proposedManifest = {schemaVersion:1,service:{id:'workspace',sourceVersion:probe.sourceVersion,sourceFingerprint:probe.sourceFingerprint,inventoryFingerprint:probe.inventoryFingerprint},dryRun:true,batch:{id:batchId,createdAt,summary:{...summary}},administrator:{...probe.administrator,email:PRESERVED_ADMIN_EMAIL},inventory:{complete:probe.complete,stableIds:probe.stableIds},items,backup,restore};
  proposedManifest.batch.summary.digest = fingerprintCleanupManifest(proposedManifest);
  // Deliberately no sourceBaseline/adminBaseline/reviewedBatchDigest. Those are independent coordinator inputs.
  const validation = validateCleanupManifest(proposedManifest, {});
  return {schemaVersion:1,status:syntheticFixture?'synthetic-fixture-review':'pending_source_baseline',dryRun:true,syntheticFixture,proposedManifest,validation,blockers:[...blockers],centralIdentityOperations:[],credentialPolicy:'Business-data preservation never re-enables old passwords, tokens, Cookie sessions or grants. Device/actor/platform identities remain separately classified.',incompleteManifestNote:backupEvidence&&restoreEvidence?null:'Required backup/restore artifact fields are intentionally absent, not fabricated. This is an incomplete proposal, not a schema-ready manifest or deletion authority.'};
}
