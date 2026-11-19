import { renderMarkdown, firstHeading } from './markdown.js';

const $ = (id) => document.getElementById(id);
const els = {
  toc: $('toc'),
  track: $('track'),
  viewport: $('viewport'),
  crumbs: $('crumbs'),
  counter: $('counter'),
  prev: $('prevBtn'),
  next: $('nextBtn'),
  top: $('topBtn'),
  progress: $('progressBar'),
  menu: $('menuBtn'),
  sidebarClose: $('sidebarClose'),
  scrim: $('scrim'),
};

// 先読みする前後のページ数
const PRELOAD = 2;

const state = {
  tree: null,
  pages: [],        // 全ページ { path, title, chapters: [node...] }（目次の順）
  folder: null,     // いま開いているフォルダーのパス（'' は pages/ 直下）
  shelf: [],        // いま開いているフォルダーのページ（左右ボタンで移動できる範囲）
  index: 0,         // shelf 内の位置
  cache: new Map(), // path → markdown テキスト
  scroll: new Map(), // path → 紙のスクロール位置（別のフォルダーへ移るまで覚えておく）
};

// ---------- 木構造 → ページ列 ----------

// フォルダー内のページ → サブフォルダーの順に深さ優先でたどる
function flatten(node, chapters = [], out = []) {
  for (const p of node.pages) out.push({ ...p, chapters });
  for (const child of node.children) flatten(child, [...chapters, child], out);
  return out;
}

const folderOf = (page) => page.chapters.at(-1)?.path ?? '';

// フォルダー（またはその中のサブフォルダー）の最初のページ
function firstPageIn(node) {
  const prefix = node.path + '/';
  return state.pages.find((p) => p.path.startsWith(prefix));
}

// ---------- URL ----------

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function pathFromHash() {
  const h = location.hash;
  if (!h.startsWith('#/')) return null;
  try { return decodeURIComponent(h.slice(2)); } catch { return null; }
}

// Markdown 内の相対パスを pages/ からの位置に解決する
function resolveRelative(pagePath, href) {
  const url = new URL(href, 'http://x/' + encodePath(pagePath));
  return decodeURIComponent(url.pathname.slice(1)) + url.hash;
}

function urlResolver(pagePath) {
  return (href, kind) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
    const resolved = resolveRelative(pagePath, href);
    if (kind === 'link' && /\.md(#.*)?$/i.test(resolved)) {
      return '#/' + encodePath(resolved.replace(/#.*$/, ''));
    }
    return 'pages/' + encodePath(resolved);
  };
}

// ---------- 目次 ----------

// フォルダー（章）とマークダウン（ページ）を見分けるアイコン
const ICONS = {
  folder: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 3.5c0-.55.45-1 1-1h3.4l1.6 1.75h5.5c.55 0 1 .45 1 1v6.75c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z"/></svg>',
  page: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.75 1.75h5.5l3 3v9.5h-8.5z"/><path d="M9.25 1.75v3h3M5.75 8h4.5M5.75 10.75h4.5"/></svg>',
};

function tocLabel(el, icon, text) {
  el.innerHTML = `<span class="toc-icon">${ICONS[icon]}</span><span class="toc-label"></span>`;
  el.querySelector('.toc-label').textContent = text;
}

function renderToc() {
  const build = (node, depth) => {
    const ul = document.createElement('ul');
    ul.className = 'toc-list';

    for (const p of node.pages) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'toc-page';
      a.href = '#/' + encodePath(p.path);
      a.dataset.path = p.path;
      tocLabel(a, 'page', p.title);
      li.append(a);
      ul.append(li);
    }

    for (const child of node.children) {
      const li = document.createElement('li');
      li.className = 'toc-chapter';
      li.dataset.path = child.path;

      const head = document.createElement('button');
      head.className = 'toc-chapter-head';
      head.style.setProperty('--depth', depth);
      tocLabel(head, 'folder', child.title);
      // 目次は常にすべて展開しておき、章をクリックしたらその章の最初のページへ
      head.addEventListener('click', () => {
        const viewing = state.folder === child.path || state.folder.startsWith(child.path + '/');
        if (viewing) return;
        const first = firstPageIn(child);
        if (first) openPage(first.path);
      });

      li.append(head, build(child, depth + 1));
      ul.append(li);
    }
    return ul;
  };

  els.toc.replaceChildren(build(state.tree, 0));
}

function updateToc() {
  const page = state.shelf[state.index];
  els.toc.querySelectorAll('.toc-page').forEach((a) => {
    const active = a.dataset.path === page.path;
    a.classList.toggle('active', active);
    if (active) a.scrollIntoView({ block: 'nearest' });
  });
  els.toc.querySelectorAll('.toc-chapter').forEach((li) => {
    const inside = page.path.startsWith(li.dataset.path + '/');
    li.classList.toggle('current', inside);
    li.classList.toggle('reading', li.dataset.path === state.folder);
  });
}

// ---------- ページ ----------

// 1 ページ = 縦スクロール枠（.slot）の中の、内容の長さぶんの紙（.page）
function renderTrack() {
  els.track.replaceChildren(...state.shelf.map((p, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = i;

    const card = document.createElement('article');
    card.className = 'page';
    card.dataset.index = i;

    const head = document.createElement('div');
    head.className = 'page-head';
    head.textContent = p.chapters.map((c) => c.title).join(' / ') || '　';

    const body = document.createElement('div');
    body.className = 'page-body markdown';

    const foot = document.createElement('div');
    foot.className = 'page-foot';
    foot.textContent = `${i + 1} / ${state.shelf.length}`;

    card.append(head, body, foot);
    card.addEventListener('click', () => { if (i !== state.index) go(i); });
    slot.append(card);
    return slot;
  }));
}

async function loadPage(i) {
  const page = state.shelf[i];
  if (!page) return;
  const slot = els.track.children[i];
  if (slot.dataset.loaded) return;
  slot.dataset.loaded = '1';

  let md = state.cache.get(page.path);
  if (md === undefined) {
    try {
      const res = await fetch('pages/' + encodePath(page.path), { cache: 'no-store' });
      md = res.ok ? await res.text() : `> 読み込めませんでした (${res.status})`;
    } catch (e) {
      md = `> 読み込めませんでした: ${e.message}`;
    }
    state.cache.set(page.path, md);
  }

  const body = slot.querySelector('.page-body');
  body.innerHTML = md.trim() ? renderMarkdown(md, { resolveUrl: urlResolver(page.path) }) : '<p class="empty">（空のページ）</p>';

  // 本文に見出しがなければファイル名をタイトルとして表示
  if (!firstHeading(md)) {
    const h = document.createElement('h1');
    h.textContent = page.title;
    body.prepend(h);
  }
  highlightCode(body);
  addCopyButtons(body);
  // 自動リロードで描き直したときも、読んでいた位置に戻す
  slot.scrollTop = state.scroll.get(page.path) ?? 0;
  updateFade(slot);
  body.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => updateFade(slot)));
}

// コードブロックを言語ごとに色分けする（highlight.js）
// ```csharp のように言語名が書いてあり、highlight.js が知っている言語だけを対象にする
function highlightCode(body) {
  const hljs = window.hljs;
  if (!hljs) return; // ライブラリが読み込めなかったときは色なしのまま
  body.querySelectorAll('pre code[class*="language-"]').forEach((code) => {
    const lang = code.className.match(/language-([\w+-]+)/)?.[1];
    if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
  });
}

// コードブロック（``` で囲んだ部分）にコピーボタンを付ける
// pre は横にスクロールするので、ボタンが一緒に流れないよう外側の枠に置く
function addCopyButtons(body) {
  body.querySelectorAll('pre').forEach((pre) => {
    const block = document.createElement('div');
    block.className = 'code-block';
    pre.before(block);

    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const lang = pre.querySelector('.code-lang');
    if (lang) bar.append(lang);

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'コピー';
    btn.addEventListener('click', async () => {
      const ok = await copyText(pre.querySelector('code')?.textContent ?? pre.textContent);
      btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
      btn.classList.toggle('done', ok);
      clearTimeout(btn.timer);
      btn.timer = setTimeout(() => { btn.textContent = 'コピー'; btn.classList.remove('done'); }, 1600);
    });
    bar.append(btn);
    block.append(pre, bar);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API が使えない環境（http の別ホストなど）向け
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}

// 紙が画面の上に吸い込まれている／下に続いているぶんだけ、その端をぼかす
function updateFade(slot) {
  const below = slot.scrollHeight - slot.clientHeight - slot.scrollTop;
  slot.style.setProperty('--fade-top', `${Math.min(Math.max(slot.scrollTop, 0), 56)}px`);
  slot.style.setProperty('--fade-bottom', `${Math.min(Math.max(below, 0), 72)}px`);
}

// ---------- 移動 ----------

// 開いているフォルダーの中で移動する
// rise: 紙を画面の下からせり上げる（フォルダーを開いたときだけ。左右の移動では上下に動かさない）
function go(i, { updateHash = true, rise = false } = {}) {
  if (!state.shelf.length) return;
  i = Math.max(0, Math.min(state.shelf.length - 1, i));
  const slot = els.track.children[i];
  state.index = i;
  const page = state.shelf[i];

  els.track.style.setProperty('--i', i);
  [...els.track.children].forEach((s, k) => {
    s.classList.toggle('current', k === i);
    s.classList.toggle('near', Math.abs(k - i) === 1);
    s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
  });

  updateFade(slot);
  updateTopBtn();
  if (rise) {
    // スクロール位置はそのまま（同じフォルダーにいる間は覚えている）
    const card = slot.querySelector('.page');
    card.classList.remove('rise');
    void card.offsetWidth;
    card.classList.add('rise');
  }

  for (let k = i - PRELOAD; k <= i + PRELOAD; k++) loadPage(k);

  els.prev.disabled = i === 0;
  els.next.disabled = i === state.shelf.length - 1;
  els.counter.textContent = `${i + 1} / ${state.shelf.length}`;
  els.progress.style.width = `${((i + 1) / state.shelf.length) * 100}%`;

  els.crumbs.replaceChildren(...[...page.chapters.map((c) => c.title), page.title].map((t, k, arr) => {
    const span = document.createElement('span');
    span.className = k === arr.length - 1 ? 'crumb last' : 'crumb';
    span.textContent = t;
    return span;
  }));

  document.title = `${page.title} - ${document.querySelector('#bookTitle').textContent}`;
  updateToc();
  closeMenu();

  if (updateHash) {
    const hash = '#/' + encodePath(page.path);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
}

// 開いているフォルダーを切り替える
function showFolder(folder) {
  if (folder !== state.folder) state.scroll.clear();
  state.folder = folder;
  state.shelf = state.pages.filter((p) => folderOf(p) === folder);
  renderTrack();
}

// 任意のページを開く。別フォルダーのページならフォルダーごと切り替える
function openPage(path, { updateHash = true, reload = false } = {}) {
  const page = state.pages.find((p) => p.path === path);
  if (!page) return false;

  const first = state.folder === null; // マニュアルを開いて最初の表示
  const switching = folderOf(page) !== state.folder;
  if (switching || reload) showFolder(folderOf(page));
  const i = state.shelf.findIndex((p) => p.path === path);

  if (!switching && !reload) {
    go(i, { updateHash });
    return true;
  }

  // 切り替え直後はスライドせずに目的のページへ置く。
  // 紙が下からせり上がるのは最初の表示だけで、フォルダーの切り替えは上下に動かさずにふわっと出す
  // （自動リロードで同じフォルダーを読み直すときは何もしない）
  els.track.classList.add('no-anim');
  go(i, { updateHash, rise: first });
  void els.track.offsetWidth;
  requestAnimationFrame(() => els.track.classList.remove('no-anim'));

  if (switching && !first) {
    els.viewport.classList.remove('fade-in');
    void els.viewport.offsetWidth;
    els.viewport.classList.add('fade-in');
  }
  return true;
}

// ---------- 読み込み ----------

async function loadTree() {
  const current = state.shelf[state.index]?.path;
  const res = await fetch('tree.json', { cache: 'no-store' });
  state.tree = await res.json();
  applySettings(state.tree.settings ?? {});
  if (state.tree.live) startLiveReload();
  state.pages = flatten(state.tree);
  state.cache.clear();

  if (!state.pages.length) {
    els.toc.innerHTML = '';
    els.track.innerHTML =
      '<div class="slot current"><article class="page"><div class="page-body markdown"><h1>ページがありません</h1>' +
      '<p><code>pages/</code> フォルダーに Markdown ファイル（<code>.md</code>）を追加してください。</p></div></article></div>';
    els.track.style.setProperty('--i', 0);
    state.folder = null;
    state.shelf = [];
    els.counter.textContent = '';
    els.crumbs.textContent = '';
    return;
  }

  renderToc();

  // ハッシュ → 直前のページ → 最初のページ の順で開く
  const target = [pathFromHash(), current, state.pages[0].path]
    .find((p) => p && state.pages.some((x) => x.path === p));
  openPage(target, { reload: true });
}

// settings/settings.json の内容を画面に反映する
function applySettings(settings) {
  // 紙（マークダウン）の最大幅。数値なら px
  const width = Number(settings.pageWidth);
  if (width > 0) document.documentElement.style.setProperty('--page-width', `${width}px`);
  else document.documentElement.style.removeProperty('--page-width');

  if (settings.title) {
    $('bookTitle').textContent = settings.title;
    const page = state.shelf[state.index];
    document.title = page ? `${page.title} - ${settings.title}` : settings.title;
  }
}

// ---------- 操作 ----------

els.prev.addEventListener('click', () => go(state.index - 1));
els.next.addEventListener('click', () => go(state.index + 1));

document.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(state.index + 1); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(state.index - 1); e.preventDefault(); }
  if (e.key === 'Home') { go(0); e.preventDefault(); }
  if (e.key === 'End') { go(state.shelf.length - 1); e.preventDefault(); }

  // 上下キー・スペースで紙を流す
  const slot = currentSlot();
  if (!slot || (e.key === ' ' && e.target instanceof Element && e.target.closest('button, a'))) return;
  const step = { ArrowDown: 80, ArrowUp: -80, ' ': slot.clientHeight * 0.8 }[e.key];
  if (step) {
    slot.scrollBy({ top: e.key === ' ' && e.shiftKey ? -step : step, behavior: 'smooth' });
    e.preventDefault();
  }
});

const currentSlot = () => els.track.querySelector('.slot.current');

// scroll はバブリングしないのでキャプチャで拾う
els.track.addEventListener('scroll', (e) => {
  const slot = e.target;
  if (!slot.classList?.contains('slot')) return;
  updateFade(slot);
  const page = state.shelf[slot.dataset.index];
  if (page) state.scroll.set(page.path, slot.scrollTop);
  if (slot.classList.contains('current')) updateTopBtn();
}, true);

// ページの先頭へ戻るボタン（紙が完全に先頭にあるときだけ隠す）
function updateTopBtn() {
  els.top.classList.toggle('show', (currentSlot()?.scrollTop ?? 0) > 1);
}
els.top.addEventListener('click', () => {
  currentSlot()?.scrollTo({ top: 0, behavior: 'smooth' });
});
els.track.addEventListener('animationend', (e) => updateFade(e.target.closest('.slot')));
window.addEventListener('resize', () => [...els.track.children].forEach(updateFade));

// 目次の出し入れなどで表示領域の幅が変わったら、紙の横位置を計算し直す
// （幅に応じた位置指定が、ブラウザによっては自動で更新されないため）
new ResizeObserver(() => {
  els.track.classList.add('no-anim');
  els.track.style.transform = 'none';
  void els.track.offsetWidth;
  els.track.style.transform = '';
  void els.track.offsetWidth;
  els.track.classList.remove('no-anim');
  [...els.track.children].forEach(updateFade);
}).observe(els.viewport);

// 紙の外（余白や隣のページの上）でホイールを回しても、開いている紙を流す
els.viewport.addEventListener('wheel', (e) => {
  const slot = currentSlot();
  if (!slot || slot.contains(e.target) || e.ctrlKey) return;
  slot.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY });
  e.preventDefault();
}, { passive: false });

window.addEventListener('hashchange', () => {
  const p = pathFromHash();
  if (p) openPage(p, { updateHash: false });
});

// ページ内アンカー (#見出し) はカード内でスクロール
els.track.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]:not([href^="#/"])');
  if (!a) return;
  e.preventDefault();
  const id = decodeURIComponent(a.getAttribute('href').slice(1));
  const target = a.closest('.page-body').querySelector(`[id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// スワイプで移動
let touch = null;
els.viewport.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY };
}, { passive: true });
els.viewport.addEventListener('touchend', (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(state.index + (dx < 0 ? 1 : -1));
});

// 目次の出し入れ
//   広い画面：目次の « でしまい、しまっている間だけ出る ☰ で戻す（次に開いたときも同じ状態にする）
//   狭い画面：☰ で引き出しとして重ねて出し、« か外側のクリックで閉じる
function closeMenu() { document.body.classList.remove('menu-open'); }
const narrow = matchMedia('(max-width: 900px)');

function setSidebarClosed(closed) {
  document.body.classList.toggle('sidebar-closed', closed);
  try { localStorage.setItem('sidebarClosed', closed ? '1' : ''); } catch {}
}

els.menu.addEventListener('click', () => {
  if (narrow.matches) document.body.classList.toggle('menu-open');
  else setSidebarClosed(false);
});
els.sidebarClose.addEventListener('click', () => {
  if (narrow.matches) closeMenu();
  else setSidebarClosed(true);
});
try { if (localStorage.getItem('sidebarClosed')) document.body.classList.add('sidebar-closed'); } catch {}

// 境界線をドラッグして目次の幅を変える（広い画面のみ。幅は次に開いたときも同じにする）
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const resizer = $('sidebarResizer');

function setSidebarWidth(px, save = true) {
  const root = document.documentElement;
  if (px == null) {
    root.style.removeProperty('--sidebar-w');
  } else {
    px = Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, px)));
    root.style.setProperty('--sidebar-w', `${px}px`);
  }
  if (save) try { localStorage.setItem('sidebarWidth', px ?? ''); } catch {}
}

try {
  const saved = Number(localStorage.getItem('sidebarWidth'));
  if (saved) setSidebarWidth(saved, false);
} catch {}

resizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const sidebar = $('sidebar').getBoundingClientRect();
  let width = sidebar.width;
  const move = (ev) => {
    width = ev.clientX - sidebar.left;
    setSidebarWidth(width, false);
  };
  const end = () => {
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', end);
    resizer.removeEventListener('pointercancel', end);
    document.body.classList.remove('resizing');
    setSidebarWidth(width); // 最後にドラッグした幅で確定して保存
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);
});

// ダブルクリックで元の幅に戻す
resizer.addEventListener('dblclick', () => setSidebarWidth(null));
els.scrim.addEventListener('click', closeMenu);

// pages/ が変わったら自動で読み直す（npm start のときだけ。GitHub Pages では使わない）
let events = null;
function startLiveReload() {
  if (events || !('EventSource' in window)) return;
  events = new EventSource('events');
  events.onmessage = () => loadTree();
}

loadTree();
