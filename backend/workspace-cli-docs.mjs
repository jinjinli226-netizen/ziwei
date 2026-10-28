import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultPublicDirectory = fileURLToPath(new URL('../docs/public/workspace-cli/', import.meta.url));
const routes = Object.freeze([
  {url:'/docs', file:'index.html', contentType:'text/html; charset=utf-8'},
  {url:'/docs/cli.md', file:'cli.md', contentType:'text/markdown; charset=utf-8'},
  {url:'/llms.txt', file:'llms.txt', contentType:'text/plain; charset=utf-8'}
]);

/** Public documentation only. No wildcard/static fallback or business authorization exemption. */
export function registerWorkspaceCliDocs(app, {publicDirectory = defaultPublicDirectory} = {}) {
  for (const {url, file, contentType} of routes) {
    app.get(url, (_req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const document = fs.readFileSync(path.join(publicDirectory, file));
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=300');
        if (file === 'index.html') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
        return res.send(document);
      } catch (error) {
        const missing = error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(missing ? 404 : 500).send(missing ? 'Documentation not found.\n' : 'Documentation temporarily unavailable.\n');
      }
    });
  }
}
