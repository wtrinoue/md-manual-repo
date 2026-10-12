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
  progress: $('progressBar'),
  menu: $('menuBtn'),
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
      a.textContent = p.title;
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
      head.innerHTML = '<span class="caret" aria-hidden="true"></span><span class="label"></span>';
      head.querySelector('.label').textContent = child.title;
      head.addEventListener('click', () => {
        const viewing = state.folder === child.path || state.folder.startsWith(child.path + '/');
        if (viewing) {
          // いま読んでいるフォルダーなら開閉だけ
          li.classList.toggle('open');
        } else {
          // 別のフォルダーならそのフォルダーのページに切り替える
          li.classList.add('open');
          const first = firstPageIn(child);
          if (first) openPage(first.path);
        }
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
    if (inside) li.classList.add('open');
  });
}

// ---------- ページ ----------

function renderTrack() {
  els.track.replaceChildren(...state.shelf.map((p, i) => {
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
    return card;
  }));
}

async function loadPage(i) {
  const page = state.shelf[i];
  if (!page) return;
  const card = els.track.children[i];
  if (card.dataset.loaded) return;
  card.dataset.loaded = '1';

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

  const body = card.querySelector('.page-body');
  body.innerHTML = md.trim() ? renderMarkdown(md, { resolveUrl: urlResolver(page.path) }) : '<p class="empty">（空のページ）</p>';

  // 本文に見出しがなければファイル名をタイトルとして表示
  if (!firstHeading(md)) {
    const h = document.createElement('h1');
    h.textContent = page.title;
    body.prepend(h);
  }
}

// ---------- 移動 ----------

// 開いているフォルダーの中で移動する
function go(i, { updateHash = true } = {}) {
  if (!state.shelf.length) return;
  i = Math.max(0, Math.min(state.shelf.length - 1, i));
  state.index = i;
  const page = state.shelf[i];

  els.track.style.setProperty('--i', i);
  [...els.track.children].forEach((card, k) => {
    card.classList.toggle('current', k === i);
    card.classList.toggle('near', Math.abs(k - i) === 1);
    card.setAttribute('aria-hidden', k === i ? 'false' : 'true');
  });

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
  state.folder = folder;
  state.shelf = state.pages.filter((p) => folderOf(p) === folder);
  renderTrack();
}

// 任意のページを開く。別フォルダーのページならフォルダーごと切り替える
function openPage(path, { updateHash = true, reload = false } = {}) {
  const page = state.pages.find((p) => p.path === path);
  if (!page) return false;

  const switching = folderOf(page) !== state.folder;
  if (switching || reload) showFolder(folderOf(page));
  const i = state.shelf.findIndex((p) => p.path === path);

  if (!switching && !reload) {
    go(i, { updateHash });
    return true;
  }

  // 切り替え直後はスライドせずに目的のページへ置く
  els.track.classList.add('no-anim');
  go(i, { updateHash });
  void els.track.offsetWidth;
  requestAnimationFrame(() => els.track.classList.remove('no-anim'));

  if (switching) {
    els.viewport.classList.remove('folder-in');
    void els.viewport.offsetWidth;
    els.viewport.classList.add('folder-in');
  }
  return true;
}

// ---------- 読み込み ----------

async function loadTree() {
  const current = state.shelf[state.index]?.path;
  const res = await fetch('tree.json', { cache: 'no-store' });
  state.tree = await res.json();
  if (state.tree.live) startLiveReload();
  state.pages = flatten(state.tree);
  state.cache.clear();

  if (!state.pages.length) {
    els.toc.innerHTML = '';
    els.track.innerHTML =
      '<article class="page current"><div class="page-body markdown"><h1>ページがありません</h1>' +
      '<p><code>pages/</code> フォルダーに Markdown ファイル（<code>.md</code>）を追加してください。</p></div></article>';
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
});

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

// スマホ用の目次ドロワー
function closeMenu() { document.body.classList.remove('menu-open'); }
els.menu.addEventListener('click', () => document.body.classList.toggle('menu-open'));
els.scrim.addEventListener('click', closeMenu);

// pages/ が変わったら自動で読み直す（npm start のときだけ。GitHub Pages では使わない）
let events = null;
function startLiveReload() {
  if (events || !('EventSource' in window)) return;
  events = new EventSource('events');
  events.onmessage = () => loadTree();
}

loadTree();
