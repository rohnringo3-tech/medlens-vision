// MedLens dev server - zero dependencies, serves this folder on port 7860
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7990;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  console.log(req.method + ' ' + req.url);
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  /* dev-only: the ?selftest=1 page POSTs its PASS/FAIL lines here so headless
     test runs can read them from the server log */
  if (req.method === 'POST' && urlPath === '/selftest-result') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      console.log('SELFTEST ' + body);
      res.writeHead(204); res.end();
    });
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('MedLens running at http://localhost:' + PORT));
