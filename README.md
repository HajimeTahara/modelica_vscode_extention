# README

本書にはこのディレクトリ内の開発パッケージの使い方やセットアップなどユーザー対象の情報を記載する。

# Modelica Language (modelica_vscode_extention)

Modelica (`.mo`) 言語向けの VSCode 拡張機能。EAST ライブラリ開発を支援する。
プレーン JS 実装で**ビルド不要・依存パッケージなし**。ナビ/補完/リネームは自前の軽量シンボル
解決で動き（OpenModelica 不要）、コンパイル/計算実行のみ OpenModelica `omc` に委譲する
ハイブリッド構成。

## インストール

本フォルダ内の `install.bat` を実行する（install / update 兼用）。

```bat
install.bat              REM インストール / 更新
install.bat --uninstall  REM アンインストール
```

`%USERPROFILE%\.vscode\extensions\` へコピーされる。**実行後は VSCode を再起動**すると
`.mo` ファイルに自動適用される。バージョンを上げても古いフォルダは残らない。

開発時は本フォルダを VSCode で開き `F5`（拡張機能の開発ホスト）でも試せる。

## 機能一覧

| 機能 | 起動方法 | OpenModelica |
|---|---|---|
| シンタックスハイライト | `.mo` を開くと自動 | 不要 |
| パッケージツリー表示 | Activity Bar の Modelica タブ | 不要 |
| 新規ファイル/パッケージ作成 | フォルダ右クリック →「Modelica 新規作成」 | 不要 |
| 定義へのジャンプ | `F12` / `Ctrl`+クリック | 不要 |
| 入力予測（補完） | `.` 入力 / `Ctrl`+`Space` | 不要 |
| 一括リネーム | `F2` | 不要 |
| モデルをチェック | 右上 ✓ ボタン / 右クリック / パレット | 必要 |
| シミュレーション実行 | 右上 ▷ ボタン / 右クリック / パレット | 必要 |
| Documentation 表示 | 右上 📖 ボタン / パレット | 不要 |
| annotation の表示/非表示 | 右上 👁 ボタン / パレット | 不要 |
| ダイアグラム表示 | 右上 🔲 ボタン / パレット | 不要 |

---

## シンタックスハイライト

クラス定義・型・キーワード・演算子・数値・文字列・コメントを色分けする。あわせて括弧の
自動補完、`//` `/* */` コメント切替、インデント補助、単語境界（言語設定）も提供する。

## パッケージツリー表示

Activity Bar（左端の縦帯）の **Modelica タブ**を開くと、**Modelica Packages** ツリーが表示される。
エクスプローラーと違い、ファイル/フォルダではなく **Modelica の名前空間**でライブラリを辿れる。

- ルートはワークスペース内ライブラリのルートパッケージ。名前は `package.mo` の宣言から取るため、
  フォルダ名と違っていてもよい（フォルダ `ModelicaStandardLibrary` → 表示は `Modelica`）。
- 展開すると `Modelica.Blocks.Sources.Sine` のようにパッケージ／クラスを辿れる。
  展開したときにだけ中身を読むため、MSL のような大きなライブラリでも初期表示は重くならない。
- 項目をクリックすると定義ファイルを開く。1 ファイルに複数クラスがある場合は**定義行へジャンプ**する。
- 右クリックから「定義を開く」「Documentation を表示」「ダイアグラムを表示」を実行できる
  （エディタで開いていないクラスにも使える）。
- `.mo` の追加・削除・編集に追従して自動更新する。手動更新はビュー右上の 🔄。
- 並び順はアルファベット順（`package.order` の順序は未対応）。OpenModelica は不要。

## 新規ファイル/パッケージ作成

エクスプローラーでフォルダを右クリック →「**Modelica 新規作成**」、または
コマンドパレット（`Ctrl+Shift+P`）→「**Modelica: 新規作成**」から実行する。
名前を入力すると、テンプレートから `.mo` を生成して開き、`package.order` を自動更新する。

生成できる種別: `model` / `block (SISO)` / `record` / `connector` / `function` /
`type` / `package`。

- `within` 修飾名は配置先ディレクトリ構成（`package.mo` の連なり）から自動算出。
  トップレベルは `within ;`。
- Documentation は空の `<html></html>` のみ。中身は空のテンプレート。
- `package` は「ディレクトリ＋`package.mo`＋`package.order`」を生成し、
  `extends Modelica.Icons.Package;` を付与。親が実際にパッケージのときだけ親 `package.order`
  にも追記する（非パッケージの上位ディレクトリには作らない）。

## 定義へのジャンプ

識別子の上で `F12`（定義へ移動）または `Ctrl`+クリック。

- **継承もと・型参照** — `extends EAST.Orbital.Bodies.CelestialBodyData` や
  `Modelica.Blocks.Interfaces.SISO` などのクラス名から、その定義ファイル・定義行へジャンプ。
- **変数・コンポーネント宣言** — 使用箇所（例: `sun.mu` の `sun`）から現在ファイルの宣言行へ。
- ワークスペース内のライブラリ（EAST・MSL 等）をまたいで解決する。ルートパッケージは各
  `package.mo` の宣言名で判定するため、ディレクトリ名と異なっていてもよい
  （MSL: フォルダ `ModelicaStandardLibrary` / パッケージ `Modelica`）。

制限: 完全修飾名または現在ファイルの変数のみ対応。`import` 別名や継承経由の相対名は未対応。
参照先ライブラリがワークスペース内に無い場合はジャンプしない（`omc` はコンパイル時に自前の
MSL を使うため、MSL を vendor していないとシミュレーションは通るがジャンプは効かない）。

## 入力予測（補完）

`.` の入力、または `Ctrl`+`Space` で候補を表示。

- **パッケージ/クラスの子** — `Modelica.Blocks.` → `Interfaces` / `Sources` / `Math` …、
  `EAST.Orbital.Bodies.` → `Sun` / `Earth` / `Moon` …。
- **コンポーネントのメンバー** — `sun.` → その型（`EAST.Orbital.Bodies.Sun`）のフィールドを
  継承（`extends`）を辿って列挙（`bodyName` / `mu` / `equatorialRadius` / `rotationRate`）。
- **素の単語** — Modelica キーワード・組込み型（`Real` 等）・現在ファイルのコンポーネント・
  ルートパッケージ・同一パッケージの兄弟クラス。

## 一括リネーム

変数・コンポーネント（オブジェクト）名の上で `F2`。宣言と同一クラス本体内の全参照を一括変更する。

- **文字列・コメント内は変更しない**。`other.field` のような他オブジェクトのメンバー参照も除外。
- 全体一致のみ（`earthOrbit` を変えても `earthOrbitRadius` は変わらない）。
- 安全側の設計: 対象は変数・コンポーネント名のみ（クラス名・型・キーワードは拒否）。
  リネーム先が既存の名前と衝突する場合も拒否する。

クラス名の横断リネーム（ファイル名・`package.order`・全参照の更新）は現状未対応。

## Documentation 表示

エディタ右上の 📖 ボタン、またはコマンドパレット「Modelica: Documentation を表示」で、
モデルの `Documentation(info="<html>…")` を横のプレビュー（Webview）に描画する。
VSCode のテーマに追従し、`<code>` / `<pre>` / 表 / リンク等をスタイル付きで表示する。
Documentation が無いモデルではその旨を通知する。

## ダイアグラム表示

エディタ右上の 🔲 ボタン、またはコマンドパレット「Modelica: ダイアグラムを表示」で、
モデルの構成を横のプレビュー（Webview・SVG）に描画する。

- 各コンポーネントを型の**Icon 図形**（Line/Rectangle/Ellipse/Polygon/Text）で描画し、`Placement`
  （origin / extent / rotation）どおりに配置する。Icon は `extends` を辿って基底クラスから収集し、
  `%name` はコンポーネント名に置換する。Icon が無い型は名前付きボックスにフォールバック。
- `connect(...)` の `Line(points=…, color=…)` を**接続線**として描画（信号=青・熱=赤など元の色）。
- `Diagram(coordinateSystem(extent=…))` を座標系に採用。Modelica の Y 上向きは SVG 用に反転する。
- **パン/ズーム** — ドラッグでパン、ホイールでカーソル基点のズーム、ダブルクリックでリセット。

グラフィック解析/描画は同梱ライブラリ **`modelicaGraphics/`**（拡張フォルダ直下・vscode 非依存・
プレーン JS・依存ゼロ）に切り出している。

## annotation の表示/非表示

実行ボタン隣の 👁 ボタン、またはコマンドパレット「Modelica: annotation の表示/非表示」で、
ファイル内の**複数行 annotation ブロック**（`Documentation` / `Icon` / `Placement` /
`Line` など）をまとめて折りたたむ／展開する。図形定義などのノイズを隠して本文を読みやすくする。

- 折りたたみ（fold）で実現するため、1 行に収まる短い annotation は対象外。
- ボタンを押すたびに畳む／戻すが切り替わる。

## コンパイル・計算実行

`.mo` エディタで、右上の**アイコンボタン**（✓ チェック / ▷ シミュレーション）、エディタ右クリック、
またはコマンドパレット（`Modelica:`）から実行する。対象クラスは開いているファイルから
（ディレクトリ構成の `within` 修飾名 ＋ ファイル名で）自動判定する。

- **モデルをチェック (checkModel)** — ライブラリを読み込み `checkModel` で検証。
  エラー/警告は Problems パネルに表示され、該当行にジャンプできる。
- **シミュレーション実行 (simulate)** — OMEdit 風の **Simulation Setup ダイアログ**を表示し、
  その設定で `simulate` を実行。**実行中は進捗バー（0→100%）** で計算の進み具合を表示する。
  `<単純クラス名>.mat`（`_res` なし）を生成し、完了通知の「フォルダを開く」から出力先を開ける
  （結果描画は同梱の ResultViewer を利用）。

### エラー情報の表示先

チェック / シミュレーションで omc が返した情報は、次の場所に出る。

- **Problems パネル ＋ エディタの赤波線** — omc の診断（`source: omc`）。
  Error / Warning / Notification をそれぞれ エラー / 警告 / 情報 として、omc が示す
  `ファイル:行:列` に表示する。クリックで該当箇所へジャンプできる。
  - 位置は **チェックしたファイルとは別のファイルに出ることがある**。omc は実際の宣言箇所を
    指すため。例: あるモデルをチェックすると、その基底クラスや使用している媒体パッケージ側の行に
    エラーが出る（`checkModel(SomeModel)` の結果が `PartialXxx.mo` や `Media/…/package.mo` に付く等）。
  - 診断は **チェック/シミュレーションのたびに一旦すべて消去してから再設定**する。修正して
    再チェックすると更新され、解消したものは消える。古いエラーが残って見えるときは再チェックする。
- **出力パネル「Modelica」** — omc の生出力（`checkModel` の結果レポート、`SimulationResult`
  レコード、シミュレーションの `messages` / ログ）。失敗時は自動で前面に出る。
  コマンドパレットの `View: Toggle Output` →「Modelica」でも開ける。
- **通知（トースト）とステータスバー**
  - 成功: ステータスバーに「チェック成功」/「シミュレーション成功 → <ファイル名>」。
  - 失敗: 「N 件のエラー」通知を出し、Problems パネルを開く。
  - 位置に紐付かないエラー/警告（例: ライブラリ読み込み失敗）は警告通知として表示する。
- **進捗通知** — シミュレーション中の 0→100% の進捗バー。

### Simulation Setup ダイアログ

- **Simulation Interval** — Start/Stop Time、区間指定は **Number of Intervals** か
  **Interval（時間ステップ [s]）** を選択。
- **Integration** — 積分法（ソルバ）、Tolerance。
- **Output** — 出力形式（mat/csv）、および **中間コンパイルファイル (.c/.o/.h 等) を削除**
  （ON で結果とログのみ残す・既定 ON）。
- **Logging (-lv)** — `LOG_*` を個別に on/off（既定 ON: `LOG_STDOUT` / `LOG_ASSERT` / `LOG_STATS`）。
- 初期値はモデルの `annotation(experiment(...))` /
  `__OpenModelica_simulationFlags(...)` から読み取る（annotation > 前回設定 > 既定 の順）。
- **「モデルに保存」** ボタンで現在の設定を上記 annotation としてモデルへ書き戻す。

シミュレーションのビルド生成物（C/exe/mat 等）はソースを汚さないよう、ワークスペース直下の
`.modelica-build/` に**クラス名の完全ネスト**で出力する（自動生成・`.gitignore` 済）。
例: `EAST.Orbital.Examples.Foo` → `.modelica-build/EAST/Orbital/Examples/Foo/`。

結果と同じフォルダに、再現・アーカイブ用のモデル情報も出力する。

- `<単純名>.mat` — 結果ファイル。
- `<単純名>.mos` — 実行した `.mos` スクリプト（再実行可能）。
- `<単純名>_total.mo` — `saveTotalModel` による依存込みの自己完結モデル（単体で読み込み・実行可）。
- `<元ファイル名>.mo` — 元ソースのそのままコピー。

中間コンパイルファイルの削除（既定 ON）でも、これらのモデル情報（`.mo` / `.mos`）とログは残る。

### 必要環境（OpenModelica）

チェック / シミュレーションには **OpenModelica** が必要で、その `omc` 実行ファイルが
**`PATH` に通っている**こと。ターミナルで `omc --version` が動けば準備完了。
PATH に無い場合は設定 `modelica.omcPath` に実行ファイルの絶対パスを指定してもよい。

既定インストール先（Windows）は次の形式で、`bin` フォルダを `PATH` に追加する。

```text
C:\Program Files\OpenModelica<バージョン>-64bit\bin
例: C:\Program Files\OpenModelica1.26.1-64bit\bin
```

`PATH` 追加後は VSCode（およびターミナル）を再起動して反映する。
チェック/シミュレーション以外の機能は OpenModelica なしでも動作する。

## 設定（Settings）

| 設定キー | 既定 | 説明 |
|---|---|---|
| `modelica.omcPath` | `omc` | omc 実行ファイルのパス |
| `modelica.checkOnSave` | `false` | 保存時に自動で checkModel を実行 |
| `modelica.simulation.stopTime` | `1.0` | Simulation Setup の Stop Time 初期値 |
| `modelica.simulation.numberOfIntervals` | `500` | Simulation Setup の Number of Intervals 初期値 |

## キーボードショートカット早見表

| 操作 | ショートカット |
|---|---|
| 定義へジャンプ | `F12`（または `Ctrl`+クリック） |
| 補完候補を表示 | `Ctrl`+`Space`（`.` 入力でも自動） |
| リネーム | `F2` |
| コマンドパレット | `Ctrl`+`Shift`+`P` →「Modelica:」 |

## ロードマップ

| 順 | 機能 | 実現方法 | 状態 |
|---|---|---|---|
| — | シンタックスハイライト | TextMate 文法 | ✅ |
| ⑤ | 新規ファイル/パッケージ作成 | コマンド + テンプレート | ✅ |
| ④ | コンパイル・計算実行 | OpenModelica `omc` 連携 | ✅ |
| ① | 継承もと・変数宣言へのジャンプ | 自前シンボル解決 | ✅ |
| ② | 入力予測 | 自前シンボル解決を再利用 | ✅ |
| ③ | 変数・オブジェクト名の一括変換 | 自前の参照探索 | ✅ |
| Want | ダイアグラムビュー | Webview（SVG・模式表示） | ✅ |
| Want | パッケージツリー表示 | Activity Bar + TreeDataProvider | ✅ |

保留中の改善候補: ワークスペース外ライブラリのジャンプ対応（`modelica.libraryPaths`）、
非クラスメンバー（定数）への定義行着地、`import` 別名/継承相対名の解決、クラス名の横断リネーム。

## 開発メモ

### ファイル構成

```text
modelica_vscode_extention/
├── install.bat                      # install / update / uninstall スクリプト
├── package.json                     # マニフェスト（言語/文法/コマンド/メニュー/設定）
├── language-configuration.json      # 括弧/コメント/インデント設定
├── src/
│   ├── extension.js                 # エントリ（コマンド登録・各プロバイダ）
│   ├── util.js                      # パス・修飾名ユーティリティ（vscode 非依存）
│   ├── omc.js                       # omc 連携（.mos 生成・実行・出力パース）
│   ├── annotations.js               # annotation の読み書き（experiment/Documentation/範囲抽出）
│   ├── symbols.js                   # シンボル解決（ジャンプ/補完/リネームの基盤・vscode 非依存）
│   ├── modelicaTree.js              # Modelica Packages ツリー（TreeDataProvider・UI 層）
│   └── graphics.js                  # modelicaGraphics への薄いアダプタ
├── resources/
│   └── modelica.svg                 # Activity Bar 用アイコン（単色 SVG）
├── syntaxes/
│   └── modelica.tmLanguage.json     # TextMate 文法（ハイライト定義）
└── modelicaGraphics/                # 同梱: グラフィック解析/SVG 描画ライブラリ（vscode 非依存）
    ├── index.js                     # 公開 API のエントリ
    └── src/
        ├── parse.js                 # 低レベル解析（括弧/配列/brace 値）
        ├── diagram.js               # 配置・接続の解析と buildDiagramSvg
        └── icon.js                  # Icon パース＋プリミティブ→SVG
```

プレーン JS のためビルド不要。`omc` 連携は Node 標準 `child_process` のみで依存パッケージなし。
`util.js` / `omc.js` / `annotations.js` / `symbols.js` は vscode に依存しないため、
Node 単体で純粋ロジックの検証ができる。

### ハイライトのデバッグ

コマンドパレット → `Developer: Inspect Editor Tokens and Scopes` で、カーソル位置のトークンに
割り当てられた TextMate スコープを確認できる。色が期待通りでない場合の原因特定に使う。
