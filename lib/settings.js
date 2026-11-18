// settings/settings.json を読む（server.js と scripts/build.js で共有）
//   { "title": "マニュアル", "pageWidth": 1100 }
const fs = require('fs');

// 設定ファイルがない・項目が書かれていないときの値
const DEFAULTS = {
  title: 'マニュアル',
  pageWidth: 1100, // 紙（マークダウン）の最大幅（px）
};

function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ...DEFAULTS }; // ファイルがなければ既定値だけを使う
  }
  try {
    const json = JSON.parse(text.replace(/^﻿/, ''));
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('{ ... } の形で書いてください');
    return { ...DEFAULTS, ...json };
  } catch (e) {
    console.warn(`${file} を読めませんでした（既定値を使います）: ${e.message}`);
    return { ...DEFAULTS };
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// index.html に設定を埋め込む（読み込み直後から正しいタイトルを出すため）
function applySettingsToHtml(html, settings) {
  const title = escapeHtml(settings.title);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<h1 class="book-title" id="bookTitle">)[^<]*(<\/h1>)/, `$1${title}$2`);
}

module.exports = { readSettings, applySettingsToHtml };
