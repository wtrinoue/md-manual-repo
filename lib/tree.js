// pages/ フォルダーの木構造を読む（server.js と scripts/build.js で共有）
const fs = require('fs');
const path = require('path');

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

// "01_はじめに" → "はじめに" のように並び順用の番号を取り除いて表示名にする
function displayName(name) {
  const base = name.replace(/\.md$/i, '');
  const stripped = base.replace(/^\d+[\s._-]*/, '');
  return stripped || base;
}

function isHidden(name) {
  return name.startsWith('.') || name.startsWith('_');
}

// pages/ を再帰的に探索して { name, title, path, pages: [...], children: [...] } を作る
function readTree(dir, rel = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !isHidden(e.name))
    .sort((a, b) => collator.compare(a.name, b.name));

  const node = {
    name: rel ? path.posix.basename(rel) : '',
    title: rel ? displayName(path.posix.basename(rel)) : '',
    path: rel,
    pages: [],
    children: [],
  };

  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const child = readTree(path.join(dir, e.name), childRel);
      // Markdown を含まないフォルダー（画像置き場など）は目次に出さない
      if (child.pages.length || child.children.length) node.children.push(child);
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      node.pages.push({ name: e.name, title: displayName(e.name), path: childRel });
    }
  }
  return node;
}

module.exports = { readTree };
