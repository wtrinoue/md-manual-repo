// 小さな Markdown パーサー（依存なし）
// 対応: 見出し / 段落 / 強調 / 打ち消し / インラインコード / コードブロック / 引用 /
//       箇条書き・番号付きリスト（入れ子・チェックボックス） / 表 / 水平線 / リンク / 画像
//
// renderMarkdown(src, { resolveUrl(url, kind) }) → HTML 文字列
//   resolveUrl はリンク・画像の相対パスを解決するためのフック（kind は 'link' | 'image'）

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*).*$/,
  heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^ {0,3}>\s?(.*)$/,
  listItem: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  blank: /^\s*$/,
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderInline(text, opt) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  // インラインコードは先に退避して、中身を他の記法として解釈しない
  text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) =>
    keep(`<code>${escapeHtml(code.trim())}</code>`));

  // バックスラッシュエスケープ
  text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (_, c) => keep(escapeHtml(c)));

  text = escapeHtml(text);

  // 画像 ![alt](src "title")
  text = text.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, alt, src, title) => {
    const url = opt.resolveUrl ? opt.resolveUrl(src, 'image') : src;
    const t = title ? ` title="${title}"` : '';
    return keep(`<img src="${url}" alt="${alt}"${t} loading="lazy">`);
  });

  // リンク [text](href "title")
  text = text.replace(/\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+&quot;(.*?)&quot;)?\s*\)/g, (_, label, href, title) => {
    const url = opt.resolveUrl ? opt.resolveUrl(href, 'link') : href;
    const external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#');
    const t = title ? ` title="${title}"` : '';
    const ext = external ? ' target="_blank" rel="noopener"' : '';
    return keep(`<a href="${url}"${t}${ext}>${label}</a>`);
  });

  // 自動リンク <https://...> と裸の URL
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) =>
    keep(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) =>
    pre + keep(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));

  text = text
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/( {2,}|\\)\n/g, '<br>\n');

  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseBlocks(lines, opt) {
  const out = [];
  let i = 0;

  const isBlockStart = (line, next) =>
    RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) ||
    RE.quote.test(line) || RE.listItem.test(line) ||
    (line.includes('|') && next !== undefined && RE.tableSep.test(next));

  while (i < lines.length) {
    const line = lines[i];

    if (RE.blank.test(line)) { i++; continue; }

    // コードブロック
    let m = line.match(RE.fence);
    if (m) {
      const fence = m[1];
      const lang = m[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++; // 閉じフェンス
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      out.push(`<pre>${label}<code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // 見出し
    m = line.match(RE.heading);
    if (m) {
      const level = m[1].length;
      const html = renderInline(m[2], opt);
      out.push(`<h${level} id="${slugify(m[2])}">${html}</h${level}>`);
      i++;
      continue;
    }

    // 水平線
    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

    // 引用
    if (RE.quote.test(line)) {
      const body = [];
      while (i < lines.length && !RE.blank.test(lines[i])) {
        const q = lines[i].match(RE.quote);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      out.push(`<blockquote>${parseBlocks(body, opt)}</blockquote>`);
      continue;
    }

    // 表
    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !RE.blank.test(lines[i])) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => {
        const a = aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
        return `<${tag}${a}>${renderInline(c || '', opt)}</${tag}>`;
      };
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        head.map((c, k) => cell('th', c, k)).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => cell('td', r[k], k)).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    // リスト
    m = line.match(RE.listItem);
    if (m) {
      const baseIndent = m[1].length;
      const ordered = /\d/.test(m[2]);
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items = [];
      let loose = false;

      while (i < lines.length) {
        const im = lines[i].match(RE.listItem);
        if (!im || im[1].length !== baseIndent || /\d/.test(im[2]) !== ordered) break;
        const contentIndent = im[1].length + im[2].length + 1;
        const body = [im[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (RE.blank.test(l)) {
            // 空行の後もインデントが続いていれば同じ項目の続き
            const next = lines[i + 1];
            if (next !== undefined && next.match(/^\s*/)[0].length > baseIndent) {
              body.push('');
              loose = true;
              i++;
              continue;
            }
            break;
          }
          const indent = l.match(/^\s*/)[0].length;
          if (indent > baseIndent) {
            body.push(l.slice(Math.min(indent, contentIndent)));
          } else if (!isBlockStart(l, lines[i + 1])) {
            body.push(l.trim()); // 遅延継続行
          } else {
            break;
          }
          i++;
        }
        items.push(body);
        // 項目間の空行
        if (i < lines.length && RE.blank.test(lines[i])) {
          const next = lines[i + 1] && lines[i + 1].match(RE.listItem);
          if (next && next[1].length === baseIndent) { loose = true; i++; }
        }
      }

      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      const lis = items.map((body) => {
        let checkbox = '';
        const task = body[0].match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          checkbox = `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> `;
          body[0] = task[2];
        }
        let html = parseBlocks(body, opt);
        if (!loose) html = html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        return `<li${task ? ' class="task"' : ''}>${checkbox}${html}</li>`;
      }).join('');
      out.push(`<${tag}${startAttr}>${lis}</${tag}>`);
      continue;
    }

    // 段落
    const para = [];
    while (i < lines.length && !RE.blank.test(lines[i]) && !(para.length && isBlockStart(lines[i], lines[i + 1]))) {
      para.push(lines[i++]);
    }
    out.push(`<p>${renderInline(para.join('\n'), opt)}</p>`);
  }

  return out.join('\n');
}

export function renderMarkdown(src, opt = {}) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseBlocks(lines, opt);
}

// 最初の見出しを取り出す（ページタイトル用）
export function firstHeading(src) {
  const m = src.match(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/m);
  return m ? m[1].replace(/[*_`]/g, '') : null;
}
