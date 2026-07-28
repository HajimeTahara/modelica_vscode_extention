# CLAUDE.md

このファイルは、この拡張機能リポジトリで作業する coding agent 向けの必須ルールです。

## プロジェクト概要

Modelica (`.mo`) 言語向けの VS Code 拡張機能。ナビ / 補完 / リネームは自前の軽量シンボル解決で動き
（OpenModelica 不要）、コンパイル / 計算実行のみ OpenModelica `omc` に委譲するハイブリッド構成。

## 構成ルール

- 拡張機能の実体はすべて **`app/`** 配下に置く。リポジトリ直下はドキュメント・`ref/`（MSL
  submodule）・`install.bat` のみ。新しいソース・アセット・マニフェストを直下に作らない。
- ソースは **TypeScript**。`app/src/*.ts` と `app/modelicaGraphics/**/*.ts` を
  `app/tsconfig.json` が `app/out/` へコンパイルする。`.js` を直接書かない。
- 変更したら `cd app && npm run compile`（型検査だけなら `npm run typecheck`）が通ることを確認する。
- `tsconfig.json` は `strict` ＋ `noUncheckedIndexedAccess`。文字走査は `text[i]` ではなく
  `text.charAt(i)` を使う（範囲外が `""` になり、比較・正規表現がそのまま成り立つ）。
- `util` / `omc` / `annotations` / `symbols` / `modelicaGraphics` は **vscode 非依存**を維持する。
  vscode API に触れてよいのは `extension.ts` / `modelicaTree.ts` / `vscodeApi.ts` だけ。
- vscode モジュールは `vscodeApi.ts` 経由で取り込む（VS Code 外から `require` しても
  モジュール読み込み自体は成功させるためのガード）。
