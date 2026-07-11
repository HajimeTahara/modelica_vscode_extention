# AGENTS.md

このファイルは、この拡張機能リポジトリで作業する coding agent 向けの必須ルールです。

## プロジェクト概要

Modelica (`.mo`) 言語向けの VS Code 拡張機能。ナビ / 補完 / リネームは自前の軽量シンボル解決で動き
（OpenModelica 不要）、コンパイル / 計算実行のみ OpenModelica `omc` に委譲するハイブリッド構成。

## 重要ディレクトリ / ファイル

- `src/extension.js`: エントリ。コマンド登録・各プロバイダの実装本体。
- `src/util.js` / `src/omc.js` / `src/annotations.js` / `src/symbols.js`: **vscode 非依存**の純粋ロジック。
- `src/graphics.js`: 同梱ライブラリ `modelicaGraphics/` への薄いアダプタ。
- `modelicaGraphics/`: グラフィック解析 / SVG 描画の同梱ライブラリ（vscode / omc 非依存・依存ゼロ）。
- `syntaxes/modelica.tmLanguage.json`: TextMate 文法（ハイライト定義）。
- `language-configuration.json`: 括弧 / コメント / インデント設定。
- `install.bat`: install / update / uninstall スクリプト（Windows）。

## 必須ルール

- 既存の未コミット変更はユーザー作業として扱い、明示要求なしに戻さない。
- `.modelica-build/` などのビルド生成物は生成物として扱う。
- ツール側の不具合はツール側で直す。拡張の都合で Modelica ファイルを書き換えないこと。
- `docs/DEVELOPMENT.md`（開発ルール・方針）、`docs/README.md`（使い方・構成）、`docs/UPDATE.md`（更新履歴）を
  適宜ユーザーからの指示で更新する。

## 記録・更新ルール

- 大きな機能追加、広範囲のリファクタリング、ツール更新などは作業単位がまとまった時点で git commit を作成する。
- コミット前に `git status` と差分を確認し、無関係な変更を巻き込まない。
- 更新履歴は `UPDATE.md` で管理する。
- バージョン番号は `ver x.x.x` 形式。2 桁目は機能追加、3 桁目は軽微な変更。1 桁目はユーザー指示時だけ更新する。
- バージョンを上げたら `install.bat` の `NAME=east.modelica-vscode-x.y.z` と
  `package.json` の `version` を合わせて更新する。
