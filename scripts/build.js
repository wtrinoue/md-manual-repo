// GitHub Pages 用の静的サイトを dist/ に出力する
//   dist/
//   ├── index.html, app.js, ...  ← public/ の中身
//   ├── pages/                   ← pages/ の中身（Markdown と画像）
//   └── tree.json                ← pages/ の木構造と settings/settings.json の設定（サーバーの /tree.json の代わり）
const fs = require('fs');
const path = require('path');
const { readTree } = require('../lib/tree');
const { readSettings, applySettingsToHtml } = require('../lib/settings');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PAGES_DIR = path.join(ROOT, 'pages');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
fs.cpSync(PAGES_DIR, path.join(DIST, 'pages'), {
  recursive: true,
  // 目次に出さないファイル（_ や . で始まるもの）は公開しない
  filter: (src) => !/^[._]/.test(path.basename(src)) || src === PAGES_DIR,
});

const settings = readSettings(path.join(ROOT, 'settings', 'settings.json'));
const tree = { ...readTree(PAGES_DIR), settings };
fs.writeFileSync(path.join(DIST, 'tree.json'), JSON.stringify(tree));

// index.html にタイトルなどの設定を埋め込む
const indexPath = path.join(DIST, 'index.html');
fs.writeFileSync(indexPath, applySettingsToHtml(fs.readFileSync(indexPath, 'utf8'), settings));

// GitHub Pages の Jekyll 処理を無効にする
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

const count = (n) => n.pages.length + n.children.reduce((s, c) => s + count(c), 0);
console.log(`dist/ に出力しました（${count(tree)} ページ）`);
