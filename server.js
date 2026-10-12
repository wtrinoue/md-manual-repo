// md-manual サーバー（依存なし）
//   /            → public/ の静的ファイル
//   /tree.json   → pages/ フォルダーの木構造（JSON。本番では scripts/build.js が静的ファイルとして出力）
//   /pages/...   → pages/ 内の Markdown や画像をそのまま配信
//   /events      → pages/ の変更を通知（自動リロード用の Server-Sent Events）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { readTree } = require('./lib/tree');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PAGES_DIR = path.join(ROOT, 'pages');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

// base 配下のファイルだけを返す（../ によるディレクトリ外アクセスを防ぐ）
function serveFile(res, base, relPath) {
  const filePath = path.resolve(base, '.' + path.sep + relPath);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not Found');
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---- 自動リロード ----
const clients = new Set();
let notifyTimer = null;
function notifyChange() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    for (const res of clients) res.write('data: change\n\n');
  }, 150);
}
try {
  fs.watch(PAGES_DIR, { recursive: true }, notifyChange);
} catch (e) {
  console.warn('pages/ の変更監視を開始できませんでした（自動リロードは無効）:', e.message);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (pathname === '/tree.json') {
    try {
      // live: true のときだけブラウザが自動リロードを使う
      const tree = { ...readTree(PAGES_DIR), live: true };
      return send(res, 200, JSON.stringify(tree), MIME['.json']);
    } catch (e) {
      return send(res, 500, String(e));
    }
  }

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname.startsWith('/pages/')) {
    return serveFile(res, PAGES_DIR, pathname.slice('/pages/'.length));
  }

  return serveFile(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
});

if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR);

server.listen(PORT, () => {
  console.log(`md-manual: http://localhost:${PORT}`);
  console.log('pages/ フォルダーの Markdown を編集すると自動で再読み込みされます。');
});
