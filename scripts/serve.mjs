/**
 * Minimal static file server, no dependencies.
 *
 * The site reads its CSV database with fetch(), and browsers refuse fetch() over
 * file:// — so opening index.html by double-clicking shows an empty map. This
 * serves the folder over http instead. That is the whole reason it exists.
 *
 *   node scripts/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_PORT = Number(process.argv[2]) || 8787;
const MAX_PORT_TRIES = 20;
const OPEN_BROWSER = !process.argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  // charset matters: the CSVs carry a BOM and names like Rönnskär.
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Resolve inside ROOT, then verify — a request for /../../secrets must not escape.
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, `Not found: ${pathname}`, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed below either way */
  }
}

let port = START_PORT;
let attempts = 0;

server.on('error', (err) => {
  // Someone else is on that port — step to the next one rather than dying.
  if (err.code === 'EADDRINUSE' && attempts < MAX_PORT_TRIES) {
    attempts++;
    port++;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(`\nCould not start the server: ${err.message}`);
  process.exit(1);
});

server.on('listening', () => {
  const url = `http://localhost:${port}/`;
  console.log(`\n  Critical Raw Materials Atlas`);
  console.log(`  running at ${url}`);
  console.log(`\n  Edit the CSVs in data/ and refresh the page to see your changes.`);
  console.log(`  Press Ctrl+C to stop.\n`);
  if (OPEN_BROWSER) openBrowser(url);
});

server.listen(port, '127.0.0.1');
