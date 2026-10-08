#!/usr/bin/env node
// Runs locally. No network request or third-party QR service receives the URL.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { INSTALL_URL } from '../frontend/src/android-install.js';
const require = createRequire(import.meta.url);
let qrcode;
try { qrcode = require('qrcode-generator'); }
catch { qrcode = require('../.local/qr-tools/node_modules/qrcode-generator'); }
const code = qrcode(0, 'M');
code.addData(INSTALL_URL, 'Byte');
code.make();
const svg = code.createSvgTag({ cellSize: 5, margin: 20, scalable: true, alt: '紫薇·互联 Android 安装页二维码' });
await writeFile(new URL('../frontend/public/android-install-qr.svg', import.meta.url), `${svg}\n`);
console.log(`Generated local QR for ${INSTALL_URL}`);
