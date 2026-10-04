#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMCPTokenPath, writeMCPCredential } from '../backend/mcp-auth.mjs';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--workspace') result.workspace = argv[++index];
    else if (key === '--file') result.file = path.resolve(argv[++index]);
    else if (key === '--token') result.token = argv[++index];
    else throw new Error(`未知参数: ${key}`);
  }
  return result;
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const input = args(process.argv);
    const workspace = String(input.workspace || process.env.ZIWEI_MCP_WORKSPACE || '').trim();
    if (!workspace) throw new Error('必须提供 --workspace，令牌不会默认授权所有工作区');
    const saved = writeMCPCredential({ file: input.file || defaultMCPTokenPath(), token: input.token, workspaces: [workspace] });
    // Keep the bearer secret out of normal command output and shell logs.
    process.stdout.write(`${JSON.stringify({ file: saved.file, workspace })}\n`);
  } catch (error) {
    process.stderr.write(`create-mcp-token: ${error.message}\n`);
    process.exitCode = 1;
  }
}

