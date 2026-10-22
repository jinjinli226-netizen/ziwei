import {createHash} from 'node:crypto';

// This module only validates supplied data. It has no database, filesystem or network adapter.
export const PRESERVED_ADMIN_EMAIL = '2594156182@qq.com';
const kinds = ['login-account', 'business-resource', 'native-actor', 'platform-account', 'device-pairing', 'system-credential'];
const services = ['ecosystem', 'workspace', 'world', 'viral', 'beeftv', 'xianyu', 'growth', 'collaboration'];
const classifications = ['preserved-admin', 'other-login-account', 'shared', 'global', 'unowned', 'mixed', 'unknown'];
const text = (maxLength = 512) => ({type: 'string', minLength: 1, maxLength});
const choice = values => ({type: 'string', enum: values});
const object = properties => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const array = (items, minItems = 0) => ({type: 'array', minItems, maxItems: 100000, items});
const digest = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const evidence = array(text(256), 1);
const reference = {$ref: '#/$defs/reference'};
const references = array(reference);
const resolutions = ['verified', 'not-present-verified', 'pending'];
const administrator = object({email: {const: PRESERVED_ADMIN_EMAIL}, accountResolution: choice(resolutions), loginAccountRefs: references, associatedResourceRefs: references, evidenceRefs: evidence});

export const cleanupManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:ziwei:identity:cleanup-manifest:1',
  title: 'Identity cleanup manifest: read-only dry-run review',
  ...object({
    schemaVersion: {const: 1},
    service: object({id: choice(services), sourceVersion: text(), sourceFingerprint: digest, inventoryFingerprint: digest}),
    dryRun: {const: true},
    batch: object({id: text(256), createdAt: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$'}, summary: object({total: {type: 'integer', minimum: 0}, preserve: {type: 'integer', minimum: 0}, delete: {type: 'integer', minimum: 0}, pending: {type: 'integer', minimum: 0}, digest})}),
    administrator,
    inventory: object({complete: {type: 'boolean'}, stableIds: references}),
    items: array(object({
      resource: reference, decision: choice(['preserve', 'delete', 'pending']), reason: text(2000),
      ownership: object({classification: choice(classifications), loginAccountRefs: references, evidenceRefs: evidence}),
      dependencies: array(object({target: reference, relation: choice(['requires', 'references', 'owns']), onTargetDelete: choice(['blocks', 'no-impact', 'unknown']), evidenceRefs: evidence})),
      cascade: object({mode: choice(['none', 'explicit-only', 'unresolved']), targets: references, explanation: text(2000), evidenceRefs: evidence}),
      nativeDisposition: {anyOf: [{type: 'null'}, object({treatment: choice(['separately-reviewed-user-asset', 'retain-dependency', 'not-a-login-account', 'pending']), evidenceRefs: evidence})]},
      evidenceRefs: evidence,
    })),
    backup: object({status: choice(['planned', 'verified']), evidenceRef: text(256), artifactFingerprint: digest, sourceFingerprint: digest, consistencyEvidenceRef: text(256), accessPolicyRef: text(256), retentionPolicyRef: text(256)}),
    restore: object({status: choice(['not-run', 'verified']), evidenceRef: text(256), backupArtifactFingerprint: digest, isolated: {type: 'boolean'}, verifiedInventoryFingerprint: digest, administratorPreserved: {type: 'boolean'}, collaborationPreserved: {type: ['boolean', 'null']}}),
  }),
  $defs: {reference: object({kind: choice(kinds), type: text(256), id: text(512)})},
};

const contextSchema = object({
  sourceBaseline: object({serviceId: choice(services), sourceVersion: text(), sourceFingerprint: digest, inventoryFingerprint: digest, probe: object({kind: text(64), evidenceRef: text(256)})}),
  adminBaseline: object({serviceId: choice(services), sourceFingerprint: digest, ...administrator.properties}),
  reviewedBatchDigest: digest,
});
// Missing anchors are pending; present anchors must be complete and strictly typed.
contextSchema.required = [];
function freezeTree(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeTree(child);
  return Object.freeze(value);
}
freezeTree(cleanupManifestSchema);
freezeTree(contextSchema);
const refKey = value => JSON.stringify([value.kind, value.type, value.id]);
const sameRefs = (a, b) => JSON.stringify(a.map(refKey).sort()) === JSON.stringify(b.map(refKey).sort());
const sensitiveKey = /^(?:password|passwd|passphrase|secret|clientSecret|token|accessToken|refreshToken|cookie|authorization|apiKey|privateKey)$/i;
const sensitiveContent = /(?:\b(?:password|passwd|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function inspectJson(value, onIssue = () => {}) {
  const ancestors = new Set(); let nodes = 0;
  const visit = (current, path, depth) => {
    if (++nodes > 600000 || depth > 32) throw new TypeError('JSON limits exceeded');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {if (current.length > 10000) throw new TypeError('JSON string limit exceeded'); if (sensitiveContent.test(current)) onIssue('SENSITIVE_CONTENT', path); return;}
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (typeof current !== 'object' || ancestors.has(current)) throw new TypeError('JSON data required');
    if (Array.isArray(current) ? Object.getPrototypeOf(current) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(current))) throw new TypeError('Plain JSON data required');
    if (Object.getOwnPropertySymbols(current).length) throw new TypeError('JSON keys required');
    ancestors.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (Array.isArray(current)) {
      if (current.length > 100000 || Object.keys(current).length !== current.length) throw new TypeError('Dense JSON array required');
      for (let index = 0; index < current.length; index++) if (!Object.hasOwn(descriptors, String(index))) throw new TypeError('Dense JSON array required');
    }
    let index = 0;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current) && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Plain JSON properties required');
      // Unknown property names and values are never interpolated into diagnostics.
      const nextPath = `${path}[${index++}]`;
      if (sensitiveKey.test(key)) onIssue('SENSITIVE_FIELD', nextPath);
      visit(descriptor.value, nextPath, depth + 1);
    }
    ancestors.delete(current);
  };
  visit(value, '$', 0);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const sha = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

/** Inventory identity hash, not a substitute for native record/relationship fingerprints. */
export function fingerprintInventory(stableIds) {
  inspectJson(stableIds);
  const errors = [];
  checkShape(stableIds, references, '$', errors);
  if (errors.length) throw new TypeError('Typed reference array required');
  return sha(stableIds.map(value => [value.kind, value.type, value.id]).sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }));
}

/** SHA256 of canonical manifest; only batch.summary.digest is omitted. Array order is significant. */
export function fingerprintCleanupManifest(manifest) {
  inspectJson(manifest);
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new TypeError('Manifest object required');
  const copy = JSON.parse(canonical(manifest));
  if (copy.batch?.summary && typeof copy.batch.summary === 'object') delete copy.batch.summary.digest;
  return sha(copy);
}

function checkShape(value, schema, path, errors) {
  if (errors.length > 100) return;
  if (schema.$ref) schema = cleanupManifestSchema.$defs.reference;
  const fail = () => errors.push({code: 'SCHEMA_INVALID', path, message: 'Required field, value, or JSON type is invalid.'});
  if (schema.anyOf) {
    if (!schema.anyOf.some(candidate => {const issues = []; checkShape(value, candidate, path, issues); return issues.length === 0;})) fail();
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![].concat(schema.type).some(expected => expected === type || expected === 'integer' && Number.isSafeInteger(value))) {fail(); return;}
  if (type === 'string' && ((schema.minLength && value.trim().length < schema.minLength) || value.length > (schema.maxLength ?? Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value))) fail();
  if (type === 'number' && (value < (schema.minimum ?? -Infinity) || !Number.isSafeInteger(value))) fail();
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail();
    value.forEach((entry, index) => checkShape(entry, schema.items, `${path}[${index}]`, errors));
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push({code: 'SCHEMA_INVALID', path: `${path}.${key}`, message: 'Required field is missing.'});
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) {if (schema.additionalProperties === false) errors.push({code: 'SCHEMA_INVALID', path: `${path}.unknown`, message: 'Unknown field is forbidden.'});}
      else checkShape(value[key], schema.properties[key], `${path}.${key}`, errors);
    }
  }
}

/** Context must be assembled by trusted coordination code from independent read-only probes/review. */
export function validateCleanupManifest(manifest, context = {}) {
  const errors = [], pending = [];
  const summary = {total: 0, preserve: 0, delete: 0, pending: 0};
  let batchDigest = null, dryRun = false;
  const error = (code, path, message) => errors.push({code, path, message});
  const wait = (code, path, message) => pending.push({code, path, message});
  const result = () => ({status: errors.length ? 'errors' : pending.length ? 'pending' : 'ready', readiness: errors.length ? 'errors' : pending.length ? 'pending' : 'dry_run_ready', dryRun, errors, pending, summary, batchDigest});
  try {
    inspectJson(manifest, (code, path) => error(code, path, 'Secret-bearing data is forbidden.'));
    inspectJson(context, (code, path) => error(code, `context${path}`, 'Secret-bearing data is forbidden.'));
  } catch {error('INVALID_JSON', '$', 'Bounded plain JSON data is required.'); return result();}
  if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
    dryRun = manifest.dryRun === true;
    if (Object.hasOwn(manifest, 'dryRun') && !dryRun) error('DRY_RUN_REQUIRED', '$.dryRun', 'Only read-only dry-run manifests are accepted.');
  }
  checkShape(manifest, cleanupManifestSchema, '$', errors);
  checkShape(context, contextSchema, '$context', errors);
  if (errors.length) return result();
  dryRun = true;
  const {service, administrator, inventory, items, backup, restore} = manifest;
  const isCollaboration = service.id === 'collaboration';
  const rows = new Map(), inventoryKeys = new Set();
  const adminKeys = new Set([...administrator.loginAccountRefs, ...administrator.associatedResourceRefs].map(refKey));
  const adminLoginKeys = new Set(administrator.loginAccountRefs.map(refKey));
  const validateRefs = (refs, path, {loginOnly = false} = {}) => {
    const seen = new Set();
    refs.forEach((ref, index) => {
      const key = refKey(ref);
      if (seen.has(key)) error('DUPLICATE_REFERENCE', `${path}[${index}]`, 'Typed stable reference must appear once.');
      seen.add(key);
      if (loginOnly && ref.kind !== 'login-account') error('LOGIN_REFERENCE_REQUIRED', `${path}[${index}]`, 'Only verified login-account references are allowed here.');
    });
  };
  validateRefs(inventory.stableIds, '$.inventory.stableIds');
  inventory.stableIds.forEach(ref => inventoryKeys.add(refKey(ref)));
  items.forEach((row, index) => {
    const key = refKey(row.resource);
    if (rows.has(key)) error('DUPLICATE_REFERENCE', `$.items[${index}].resource`, 'One disposition is required per typed stable reference.');
    rows.set(key, row); summary.total++; summary[row.decision]++;
  });
  if (inventoryKeys.size !== rows.size || [...inventoryKeys].some(key => !rows.has(key))) error('INVENTORY_COVERAGE_MISMATCH', '$.inventory', 'Inventory and disposition references must match exactly.');
  const requireInventoried = (refs, path) => refs.forEach((ref, index) => {if (!inventoryKeys.has(refKey(ref))) error('REFERENCE_NOT_IN_INVENTORY', `${path}[${index}]`, 'Reference must exist in this complete inventory.');});
  validateRefs(administrator.loginAccountRefs, '$.administrator.loginAccountRefs', {loginOnly: true});
  validateRefs(administrator.associatedResourceRefs, '$.administrator.associatedResourceRefs');
  requireInventoried([...administrator.loginAccountRefs, ...administrator.associatedResourceRefs], '$.administrator');
  if (administrator.accountResolution === 'verified' && administrator.loginAccountRefs.length === 0 || administrator.accountResolution === 'not-present-verified' && administrator.loginAccountRefs.length !== 0) error('ADMIN_RESOLUTION_INVALID', '$.administrator', 'Administrator resolution must match the independently resolved login IDs.');
  if (administrator.accountResolution === 'pending') wait('ADMIN_RESOLUTION_PENDING', '$.administrator', 'Exact administrator identity resolution is required.');
  if (!inventory.complete) wait('INVENTORY_INCOMPLETE', '$.inventory', 'A complete native inventory is required.');
  if (!Number.isFinite(Date.parse(manifest.batch.createdAt))) error('INVALID_TIMESTAMP', '$.batch.createdAt', 'A valid UTC timestamp is required.');
  if (fingerprintInventory(inventory.stableIds) !== service.inventoryFingerprint) error('INVENTORY_FINGERPRINT_MISMATCH', '$.service.inventoryFingerprint', 'Inventory identity fingerprint does not match enumerated references.');
  if (Object.keys(summary).some(key => summary[key] !== manifest.batch.summary[key])) error('SUMMARY_MISMATCH', '$.batch.summary', 'Batch counts must match every disposition.');
  batchDigest = fingerprintCleanupManifest(manifest);
  if (batchDigest !== manifest.batch.summary.digest) error('BATCH_DIGEST_MISMATCH', '$.batch.summary.digest', 'Manifest changed after its batch digest was produced.');
  if (!context.reviewedBatchDigest) wait('REVIEW_ANCHOR_REQUIRED', '$context.reviewedBatchDigest', 'An independent reviewed batch digest is required.');
  else if (batchDigest !== context.reviewedBatchDigest) error('REVIEWED_DIGEST_MISMATCH', '$context.reviewedBatchDigest', 'Manifest differs from the independently reviewed batch.');
  if (!context.sourceBaseline) wait('SOURCE_BASELINE_REQUIRED', '$context.sourceBaseline', 'An independent native read-only source baseline is required.');
  else {
    const baseline = context.sourceBaseline;
    if (baseline.probe.kind !== 'native-read-only') error('UNTRUSTED_SOURCE_BASELINE', '$context.sourceBaseline.probe', 'Source baseline must come from a native read-only probe.');
    if (baseline.serviceId !== service.id || ['sourceVersion', 'sourceFingerprint', 'inventoryFingerprint'].some(key => baseline[key] !== service[key])) error('SOURCE_BASELINE_MISMATCH', '$context.sourceBaseline', 'Service source version or native snapshot differs from the independent baseline.');
  }
  if (!context.adminBaseline) wait('ADMIN_BASELINE_REQUIRED', '$context.adminBaseline', 'Independent protected administrator references are required.');
  else {
    const baseline = context.adminBaseline;
    validateRefs(baseline.loginAccountRefs, '$context.adminBaseline.loginAccountRefs', {loginOnly: true});
    validateRefs(baseline.associatedResourceRefs, '$context.adminBaseline.associatedResourceRefs');
    if (baseline.serviceId !== service.id || baseline.sourceFingerprint !== service.sourceFingerprint || baseline.email !== administrator.email || baseline.accountResolution !== administrator.accountResolution || !sameRefs(baseline.loginAccountRefs, administrator.loginAccountRefs) || !sameRefs(baseline.associatedResourceRefs, administrator.associatedResourceRefs)) error('ADMIN_BASELINE_MISMATCH', '$.administrator', 'Protected administrator references differ from independent identity resolution.');
  }
  items.forEach((row, index) => {
    const path = `$.items[${index}]`, key = refKey(row.resource), owners = row.ownership.loginAccountRefs;
    validateRefs(owners, `${path}.ownership.loginAccountRefs`, {loginOnly: true});
    requireInventoried(owners, `${path}.ownership.loginAccountRefs`);
    if (row.resource.kind === 'login-account' && ['preserved-admin', 'other-login-account'].includes(row.ownership.classification)) {
      const isDeclaredAdmin = row.ownership.classification === 'preserved-admin';
      if (owners.length !== 1 || refKey(owners[0]) !== key || isDeclaredAdmin !== adminLoginKeys.has(key)) error('LOGIN_ACCOUNT_OWNERSHIP_INVALID', `${path}.ownership`, 'A login account must reference itself and match the independently protected administrator ID set.');
    }
    if (row.decision === 'pending') wait('DISPOSITION_PENDING', path, 'Disposition requires native owner review.');
    if (!isCollaboration && row.ownership.classification === 'other-login-account' && row.decision === 'preserve') wait('OLD_ACCOUNT_PRESERVATION_UNRESOLVED', path, 'Other old login accounts and their exclusive data require deletion review or an unresolved disposition.');
    if (!isCollaboration && ['shared', 'global', 'unowned', 'mixed', 'unknown'].includes(row.ownership.classification) && row.decision !== 'pending') error('UNCERTAIN_DISPOSITION', path, 'Uncertain ownership must remain pending without reassignment or deletion.');
    const protectedByOwner = owners.some(ref => adminLoginKeys.has(refKey(ref)));
    if (row.decision === 'delete') {
      if (isCollaboration) error('COLLABORATION_DELETE_FORBIDDEN', path, 'All existing collaboration accounts and business data must be retained.');
      if (adminKeys.has(key) || protectedByOwner || row.ownership.classification === 'preserved-admin') error('ADMIN_DELETE_FORBIDDEN', path, 'Administrator accounts and associated resources cannot be deleted.');
      const ownerRow = owners.length === 1 ? rows.get(refKey(owners[0])) : null;
      if (row.ownership.classification !== 'other-login-account' || owners.length !== 1 || !ownerRow || ownerRow.resource.kind !== 'login-account' || ownerRow.decision !== 'delete' || adminLoginKeys.has(refKey(owners[0])) || row.resource.kind === 'login-account' && refKey(owners[0]) !== key) error('DELETE_OWNER_NOT_VERIFIED', `${path}.ownership`, 'Deletion requires an exclusive verified owner login account in the same deletion set.');
      if (!['login-account', 'business-resource'].includes(row.resource.kind) && row.nativeDisposition?.treatment !== 'separately-reviewed-user-asset') error('NATIVE_REVIEW_REQUIRED', `${path}.nativeDisposition`, 'Native actor, platform, pairing or credential requires a separate explicit asset review.');
    }
    if (adminKeys.has(key) && row.decision !== 'preserve') {
      if (row.decision !== 'delete') wait('ADMIN_PRESERVATION_PENDING', path, 'Protected administrator resources must be explicitly preserved.');
    }
    if (row.ownership.classification === 'preserved-admin' && !protectedByOwner && !adminKeys.has(key)) error('ADMIN_OWNERSHIP_UNPROVEN', path, 'Administrator ownership requires protected native ID evidence.');
    row.dependencies.forEach((dependency, dependencyIndex) => {
      requireInventoried([dependency.target], `${path}.dependencies[${dependencyIndex}].target`);
      const target = rows.get(refKey(dependency.target));
      if (row.decision !== 'delete' && target?.decision === 'delete' && dependency.onTargetDelete !== 'no-impact') error('PRESERVED_DEPENDENCY_DELETE', `${path}.dependencies[${dependencyIndex}]`, 'A retained or unresolved resource would lose a blocking or unknown dependency.');
    });
    validateRefs(row.cascade.targets, `${path}.cascade.targets`);
    requireInventoried(row.cascade.targets, `${path}.cascade.targets`);
    if (row.cascade.mode === 'none' && row.cascade.targets.length) error('CASCADE_MODE_MISMATCH', `${path}.cascade`, 'No-cascade mode cannot contain cascade targets.');
    if (row.cascade.mode === 'unresolved') wait('CASCADE_UNRESOLVED', `${path}.cascade`, 'Cascade effects must be resolved before the dry-run review is ready.');
    row.cascade.targets.forEach((target, targetIndex) => {
      if (rows.has(refKey(target)) && rows.get(refKey(target)).decision !== 'delete') error('CASCADE_TARGET_NOT_DELETE', `${path}.cascade.targets[${targetIndex}]`, 'Every cascade target must be an explicit reviewed deletion row.');
    });
  });
  if (backup.status !== 'verified') wait('BACKUP_NOT_VERIFIED', '$.backup', 'A consistent restricted backup and evidence are required.');
  else if (backup.sourceFingerprint !== service.sourceFingerprint) error('BACKUP_BASELINE_MISMATCH', '$.backup.sourceFingerprint', 'Backup must cover the exact reviewed native source snapshot.');
  if (restore.status !== 'verified') wait('RESTORE_NOT_VERIFIED', '$.restore', 'An isolated restore verification is required.');
  else {
    if (restore.backupArtifactFingerprint !== backup.artifactFingerprint) error('RESTORE_BACKUP_MISMATCH', '$.restore.backupArtifactFingerprint', 'Restore must verify the exact referenced backup artifact.');
    if (!restore.isolated) error('RESTORE_NOT_ISOLATED', '$.restore.isolated', 'Restore verification must run in isolation.');
    if (restore.verifiedInventoryFingerprint !== service.inventoryFingerprint) error('RESTORE_INVENTORY_MISMATCH', '$.restore.verifiedInventoryFingerprint', 'Restored inventory must match the reviewed stable references.');
    if (!restore.administratorPreserved) error('ADMIN_RESTORE_NOT_PRESERVED', '$.restore.administratorPreserved', 'Restore evidence must confirm protected administrator preservation.');
    if (isCollaboration && !restore.collaborationPreserved) error('COLLABORATION_RESTORE_NOT_PRESERVED', '$.restore.collaborationPreserved', 'Restore evidence must confirm preservation of all collaboration data.');
  }
  return result();
}
