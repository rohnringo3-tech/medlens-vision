// MedLens dev server - zero dependencies, serves this folder on port 7860
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 7990;
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
  /* dev-only: ?eval=1&dump=photo-05 POSTs the exact RGBA pixels the browser
     fed the pipeline, so the Node/Lambda harness can be checked pixel-for-pixel */
  if (req.method === 'POST' && urlPath.startsWith('/dump-pixels/')) {
    const name = urlPath.slice('/dump-pixels/'.length).replace(/[^a-z0-9._-]/gi, '');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const dir = path.join(ROOT, 'aws', 'harness', 'dumps');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.rgba'), Buffer.concat(chunks));
      console.log('DUMP ' + name + ' ' + Buffer.concat(chunks).length + ' bytes');
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
