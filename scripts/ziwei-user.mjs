#!/usr/bin/env node

// The published/installed CLI is intentionally separate from the repository
// developer commands.  It keeps a remote computer's credential and logs under
// its user profile instead of writing into an arbitrary checkout.
import { defaultUserDir } from '../daemon/config.mjs';

if (!process.env.ZIWEI_USER_HOME) {
  process.env.ZIWEI_USER_HOME = defaultUserDir({ env: process.env });
}

await import('./ziwei-cli.mjs');
