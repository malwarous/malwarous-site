/* ==========================================================================
   serve.js — a tiny local preview server, with no dependencies.
       npm run dev
       PORT=8080 npm run dev        (PowerShell: $env:PORT=8080; npm run dev)

   It serves ONLY public/, which is exactly what Cloudflare publishes. That
   makes it a useful check: anything that works here will find its files in
   production, and anything outside public/ is deliberately unreachable.
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ics': 'text/calendar; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (error) {
    return null;
  }

  const clean = decoded.split('?')[0].split('#')[0];
  const target = path.resolve(root, '.' + clean);

  // Never serve outside public/.
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return path.join(target, 'index.html');
  }

  // Match Cloudflare's clean URLs: /login serves login.html.
  if (!fs.existsSync(target) && !path.extname(target) && fs.existsSync(target + '.html')) {
    return target + '.html';
  }

  return target;
}

const server = http.createServer(function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'method not allowed');
  }

  const file = resolveFile(req.url || '/');
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const notFound = path.join(root, '404.html');
    if (fs.existsSync(notFound)) {
      return send(res, 404, fs.readFileSync(notFound), TYPES['.html']);
    }
    return send(res, 404, 'not found');
  }

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const body = fs.readFileSync(file);
  send(res, 200, req.method === 'HEAD' ? '' : body, type);
});

server.listen(port, host, function () {
  console.log('');
  console.log('  malwarous.dev — local preview');
  console.log('  http://' + host + ':' + port);
  console.log('');
  console.log('  serving public/ only. Ctrl+C to stop.');
});
