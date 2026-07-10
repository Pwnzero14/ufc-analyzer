// ── Analyzer preview server (dev-only) ──────────────────────────────────────
// Serves the project root over http://localhost:8123 so the analyzer UI can be
// inspected outside Chrome's extension sandbox. Two special behaviors:
//   1. /analyzer.html gets dev/chrome-shim.js injected at the top of <head>
//      (the shipped file on disk is never modified).
//   2. /dev/storage-backup.json streams the NEWEST ufc-storage-backup-*.json
//      from ~/Downloads, so the preview always renders current real data —
//      taking a fresh 💾 Backup in the extension upgrades the preview too.
// Read-only with respect to the real extension: nothing here can write to
// chrome.storage or the repo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function newestBackupPath() {
  const dl = path.join(os.homedir(), 'Downloads');
  try {
    const files = fs.readdirSync(dl).filter((f) => /^ufc-storage-backup-.*\.json$/i.test(f));
    if (!files.length) return null;
    files.sort(); // ISO timestamps in the filename sort lexicographically
    return path.join(dl, files[files.length - 1]);
  } catch {
    return null;
  }
}

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (url === '/dev/storage-backup.json') {
    const p = newestBackupPath();
    if (!p) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    fs.createReadStream(p).pipe(res);
    return;
  }

  const rel = url === '/' ? '/analyzer.html' : url;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    const ext = path.extname(file).toLowerCase();
    if (rel === '/analyzer.html') {
      const html = buf.toString('utf8').replace(/<head([^>]*)>/i, '<head$1>\n<script src="/dev/chrome-shim.js"></script>');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => {
  const bk = newestBackupPath();
  console.log(`analyzer preview on http://localhost:${PORT}/  (backup: ${bk ? path.basename(bk) : 'NONE FOUND'})`);
});
