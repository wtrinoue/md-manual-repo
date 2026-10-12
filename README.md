# md-manual-repo
マークダウンを編集するだけで簡単にマニュアルを完成することができるようなものを作る

## 使い方

```bash
npm start
```

ブラウザで http://localhost:3000 を開きます（ポートは `PORT` 環境変数で変更可能）。
依存ライブラリはないので `npm install` は不要です（Node.js 18 以上）。

`pages/` フォルダーに Markdown を置くと、フォルダーの木構造がそのまま本になります。

```text
pages/
├── 00_表紙.md                 ← ページ
├── 01_はじめに/               ← 章（目次）
│   ├── 01_概要.md
│   └── 02_起動方法.md
└── 02_使い方/
    └── 01_基本/               ← 節（入れ子も可）
        ├── 01_フォルダーの作り方.md
        └── images/sample.svg  ← 画像（md がないフォルダーは目次に出ない）
```

- 左右ボタンでめくれるのは同じフォルダーのページだけです。目次で章をクリックすると、その章のページに切り替わります
- 名前順に並びます。先頭の番号（`01_` など）は表示されません
- `_` や `.` で始まるファイル・フォルダーは無視されます
- 画像やリンクは Markdown ファイルからの相対パスで書けます（`.md` へのリンクはそのページへ移動）
- `pages/` を編集すると、ブラウザが自動で再読み込みされます

## GitHub Pages で公開する

`main` ブランチに push すると、GitHub Actions（`.github/workflows/deploy.yml`）が自動でビルドして公開します。
**`pages/` を編集して push するだけで、公開中のマニュアルも更新されます。**

最初に一度だけ設定が必要です。

1. GitHub のリポジトリで **Settings → Pages** を開く
2. **Build and deployment → Source** を **GitHub Actions** にする
3. `main` に push する（または Actions タブから「Deploy to GitHub Pages」を手動実行）

公開先: https://wtrinoue.github.io/md-manual-repo/

ローカルで公開用ファイルを確認したいときは `npm run build` を実行すると `dist/` に出力されます。

## 構成

| ファイル | 役割 |
| --- | --- |
| `server.js` | 開発用サーバー。静的ファイル配信、`/tree.json`（pages の木構造）、`/events`（自動リロード） |
| `lib/tree.js` | pages フォルダーの探索（サーバーとビルドで共有） |
| `scripts/build.js` | GitHub Pages 用に `dist/` を出力（`tree.json` を静的ファイルとして生成） |
| `.github/workflows/deploy.yml` | push 時に自動でビルド・公開 |
| `public/index.html` | 画面の骨組み |
| `public/app.js` | 目次・ページ送りのロジック |
| `public/markdown.js` | Markdown パーサー（自作・依存なし） |
| `public/style.css` | 見た目 |

## やること
- [x] フォルダー構成の決定
- [x] 最低限必要なファイルやライブラリの用意（npmとか,index.htmlとか）
- [x] mdやfolderの読み込み方などのロジックの作成。探索の仕方など
- [x] UIなどの雰囲気の決定
- CLIによる簡単にフォルダー構成の内容更新
- CLIによる
- マークダウンに添付する画像とかどうにかしたほうがいいかもしれない。
