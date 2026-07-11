# DEVELOPMENT

本書にはこの拡張パッケージ固有の設計ルールと開発方針を記載する。

## DEVELOPMENT RULEs

### Modelica ファイルの編集について

本ツールとのインターフェース修正などの要因により、Modelica 言語ファイル側を修正・加筆しないこと。
ツール側の不具合はツール側で直す（Modelica を拡張の都合で書き換えない）。

### 実装方針

- プレーン JS（CommonJS）で実装。**ビルド不要・依存パッケージなし**。`src/extension.js` が本体。
- `util.js` / `omc.js` / `annotations.js` / `symbols.js` は **vscode 非依存**とし、Node 単体で
  純粋ロジックの検証ができる状態を保つ。
- グラフィック解析/描画は同梱ライブラリ `modelicaGraphics/`（vscode 非依存・依存ゼロ）に切り出す。
  `src/graphics.js` が薄いアダプタとして `../modelicaGraphics` を require する。

### 解析エンジン方針（ハイブリッド）

- **ナビ / 補完 / リネーム**は自前の軽量パーサ＋索引（`src/symbols.js`）で処理する（高速・オフライン・omc 不要）。
- **コンパイル / シミュレーション / エラー診断**は OpenModelica の `omc` に委譲する
  （`.mos` を都度生成 → `omc script.mos` を実行し出力をパース）。

## DEVELOPMENT PLAN

### Must 要件（全完了・実用ツール先行の実装順）

1. **新規ファイル作成**（v0.2.0）— model / block(SISO) / record / connector / function / type /
   package をテンプレート生成。package は dir＋package.mo＋package.order＋親 package.order 更新、
   `within` はディレクトリから自動算出。
2. **コンパイル・計算実行**（v0.3.0〜0.5.0）— omc 連携。`modelica.check`（checkModel→Problems 診断）/
   `modelica.simulate`。simulate は OMEdit 風の Simulation Setup ダイアログ（Webview）。中間ファイル削除、
   Logging(-lv) の個別 on/off、experiment / `__OpenModelica_simulationFlags` の読み取り・書き戻し
   （`src/annotations.js`）。ビルド生成物はクラス名の完全ネストで `.modelica-build/` 配下に出力。
3. **継承もと・変数宣言へのジャンプ**（v0.6.0）— 自前シンボル解決 `src/symbols.js`（omc 不要）。
   F12 / Ctrl+クリックで extends 先・型参照・変数宣言へ。ライブラリルートは package.mo の宣言名で判定。
4. **入力予測（補完）**（v0.7.0）— `.` / Ctrl+Space でパッケージ/クラスの子・コンポーネントのメンバー
   （extends 継承を辿る）・キーワード / 組込み型 / ローカル / ルート / 兄弟クラス。
5. **変数/オブジェクト名の一括変換（リネーム）**（v0.8.0）— F2。ローカル変数・コンポーネント名の宣言＋
   主クラス本体内の全参照を一括変更。文字列 / コメント / メンバー参照は除外。クラス名・型・キーワード・
   名前衝突は拒否（安全側）。omc の checkModel 成功を確認。

### 追加機能（完了）

- **Documentation 表示**（📖）— Webview で Documentation info の HTML を描画。
- **annotation 表示/非表示トグル**（👁）— FoldingRangeProvider で複数行 annotation を折りたたみ。
- **シミュレーション進捗バー**（v0.10.0）— omc の `-port` TCP status を Node `net` で受け 0→100%。
- **ダイアグラム表示**（🔲・v0.11.0〜）— `src/graphics.js`＋`modelicaGraphics/` で Placement / connect Line /
  Diagram を解析し SVG 描画。v0.13.0 でパン/ズーム、v0.14.0 で実 Icon 図形描画（extends を辿り基底クラスの
  Icon を収集、%name 置換、Placement へ配置、Icon 無しはボックスにフォールバック）。

### 既知の保留改善

- go-to-definition の外部ライブラリ対応（`modelica.libraryPaths`）、非クラスメンバー着地、存在しない名前の厳格化。
- ダイアグラム描画の制限: mirror 未対応・`%param` 未置換・fillPattern は Solid/None のみ・Bitmap 非対応。
- クラス名の横断リネームは未対応（リスク高・要相談）。

## 同梱ライブラリ modelicaGraphics

`modelicaGraphics/` は Modelica のグラフィカルアノテーション解析＋SVG 描画の再利用ライブラリ
（vscode / omc 非依存・プレーン JS・依存ゼロ）。元はリポジトリ直下の共有パッケージだったが、
拡張の自己完結化のため拡張フォルダ直下へ vendor（同梱）した。

- `index.js` — 公開 API のエントリ。
- `src/parse.js` — 低レベル解析（括弧/角括弧マッチ、数値配列、brace 値抽出）。
- `src/diagram.js` — 配置・接続の解析と `buildDiagramSvg`。
- `src/icon.js` — アノテーション値パーサ＋Icon パース＋プリミティブ→SVG。

拡張からは `src/graphics.js` 経由で `require("../modelicaGraphics")` する。ライブラリを更新する場合は
この同梱コピーを直接編集する。
