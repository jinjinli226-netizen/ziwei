// Frozen build protocol from the actual 15687444502b Windows client.
// SHA256 of the original exported function: f0092d32e9f6b3ae30a297d9335502f1a52291375537e81e326ca173749f649b
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function clientBuildIdentity(root) {
  const hash = createHash('sha256');
  const files = ['package.json', 'backend/a2a-auth.mjs', 'scripts/ziwei-user.mjs', 'scripts/ziwei-cli.mjs', 'scripts/start-ziwei-user.mjs', 'scripts/ziwei-mcp.mjs', 'scripts/ziwei-terminal-mcp.mjs', 'scripts/client-lifecycle.mjs', 'scripts/client-retained-stop-recovery.mjs', 'scripts/client-historical-prelaunch-recovery.mjs', 'scripts/client-legacy-identity.mjs', 'scripts/client-legacy-identity.ps1', 'scripts/client-maintenance-helper.mjs', 'scripts/client-update.mjs', 'scripts/client-update-worker.mjs'];
  files.push('scripts/client-remote-update-worker.mjs', 'scripts/client-local-history-stop-recovery.mjs');
  files.push('backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','backend/preservation-legacy-archive.mjs','backend/preservation-legacy-source.mjs','backend/preservation-source-namespace.mjs','backend/preservation-legacy-coverage.mjs','backend/preservation-legacy-integration.mjs','backend/preservation-source-native-windows.ps1','backend/production-preservation.mjs','scripts/production-source-proof.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs');
  function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : /\.(mjs|py|ps1)$/.test(entry.name) ? [path.relative(root, path.join(directory, entry.name))] : []);
  }
  files.push(...walk(path.join(root, 'daemon')), ...walk(path.join(root, 'src')));
  for (const file of [...new Set(files)].sort()) if (fs.existsSync(path.join(root, file))) hash.update(file.replaceAll('\\', '/')).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return hash.digest('hex');
}
