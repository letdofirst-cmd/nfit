#!/usr/bin/env node
/* Tiny static file server for FitLife. No dependencies: `node server.js [port]` (default 4173).
   Serve over http://localhost (not file://) so YouTube embeds, video playback and secure-context features work. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
// Only the app itself is served, never tests, tools or this file.
const FILES = new Set(['index.html', 'styles.css', 'data.js', 'backend.js', 'app.js', 'favicon.svg']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  name = name === '/' ? 'index.html' : name.replace(/^\/+/, '');
  if (!FILES.has(name)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, name), (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, () => console.log('FitLife running at http://localhost:' + PORT));
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT +
  ' is already in use. Try: node server.js ' + (PORT + 1) : e.message); process.exit(1); });
