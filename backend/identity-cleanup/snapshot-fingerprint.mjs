import crypto from 'node:crypto';

/** Artifact hashes are evidence, never a self-issued source/review authorization. */
export function fingerprintConsistentSnapshot({databaseArtifactFingerprint, objectReferenceFingerprint, objectContentFingerprint, objectStoreFingerprint}) {
  const values=[databaseArtifactFingerprint,objectReferenceFingerprint,objectContentFingerprint,...(objectStoreFingerprint===undefined?[]:[objectStoreFingerprint])];
  if(values.some(value=>!(/^[0-9a-f]{64}$/).test(value||'')))throw new TypeError('A consistent database artifact and object reference/content SHA256 digests are required');
  return crypto.createHash('sha256').update(JSON.stringify({format:objectStoreFingerprint===undefined?'workspace-consistent-snapshot-v1':'workspace-consistent-snapshot-v2-all-store',databaseArtifactFingerprint,objectReferenceFingerprint,objectContentFingerprint,...(objectStoreFingerprint===undefined?{}:{objectStoreFingerprint})})).digest('hex');
}
