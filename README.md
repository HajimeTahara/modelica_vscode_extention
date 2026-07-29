# README

本書にはこのディレクトリ内の開発パッケージの使い方やセットアップなどユーザー対象の情報を記載する。

# Modelica Language (modelica_vscode_extention)

Modelica (`.mo`) 言語向けの VSCode 拡張機能。EAST ライブラリ開発を支援する。
TypeScript 実装で**ランタイム依存パッケージなし**（ビルドにのみ `typescript` を使う）。
ナビ/補完/リネームは自前の軽量シンボル解決で動き（OpenModelica 不要）、
コンパイル/計算実行のみ OpenModelica `omc` に委譲するハイブリッド構成。

拡張機能の実体はリポジトリ直下の **`app/`** に置いてある。

## インストール

リポジトリ直下の `install.bat` を実行する（install / update 兼用）。

```bat
install.bat              REM インストール / 更新
install.bat --package    REM VSIX 作成のみ
install.bat --uninstall  REM アンインストール
```

`install.bat` は次の順で処理する。Node.js（`npm`）が必要。

1. `app/node_modules` が無ければ `npm install`
2. ルート `LICENSE` を一時的に `app/LICENSE` としてコピー
3. `app/` で `vsce package` を実行（`vscode:prepublish` により `npm run rebuild` も実行）
4. `.vsix-build/east.modelica-vscode-<version>.vsix` を作成し、一時コピーした `app/LICENSE` を削除
5. `code --install-extension <vsix> --force` で VSCode にインストール

**ビルドや VSIX 作成が失敗した場合はインストールに進まない**ので、既にインストール済みの版はそのまま残る。
**実行後は VSCode を再起動**すると `.mo` ファイルに自動適用される。
同じバージョンでも `--force` で上書きインストールする。
詳しい分岐と処理順は [docs/INSTALL_WORKFLOW.md](docs/INSTALL_WORKFLOW.md) にまとめている。

開発時はリポジトリを VSCode で開き `F5`（拡張機能の開発ホスト）でも試せる。
`F5` は起動前に `app/` のビルドを自動実行する。編集しながら試すなら
`npm: watch - app` タスクを走らせておく。

## 機能一覧

| 機能 | 起動方法 | OpenModelica |
|---|---|---|
| シンタックスハイライト | `.mo` を開くと自動 | 不要 |
| パッケージツリー表示 | Activity Bar の Modelica タブ | 不要 |
| Modelica パス / ファイルパスのコピー | Modelica ビューで右クリック | 不要 |
| 新規ファイル/パッケージ作成 | Modelica ビューの ＋ ボタン / パッケージ右クリック | 不要 |
| 定義へのジャンプ | `F12` / `Ctrl`+クリック | 不要 |
| 入力予測（補完） | `.` 入力 / `Ctrl`+`Space` | 不要 |
| 一括リネーム | `F2` | 不要 |
| モデルをチェック | 右上 ✓ ボタン / 右クリック / パレット | 必要 |
| シミュレーション実行 | 右上 ▷ ボタン / 右クリック / パレット | 必要 |
| Documentation 表示 | 右上 📖 ボタン / パレット | 不要 |
| annotation の表示/非表示 | 右上 👁 ボタン / パレット | 不要 |
| ダイアグラム表示 | Modelica ビューでモデルを右クリック / 右上 🔲 ボタン | 不要 |
| アイコン表示 | 右上 🎨 ボタン / パレット | 不要 |

---

## シンタックスハイライト

クラス定義・型・キーワード・演算子・数値・文字列・コメントを色分けする。あわせて括弧の
自動補完、`//` `/* */` コメント切替、インデント補助、単語境界（言語設定）も提供する。

## パッケージツリー表示

Activity Bar（左端の縦帯）の **Modelica タブ**を開くと、**Modelica Packages** ツリーが表示される。
エクスプローラーと違い、ファイル/フォルダではなく **Modelica の名前空間**でライブラリを辿れる。

- ルートはワークスペース内ライブラリのルートパッケージ。名前は `package.mo` の宣言から取るため、
  フォルダ名と違っていてもよい（フォルダ `ModelicaStandardLibrary` → 表示は `Modelica`）。
- ワークスペースのルートに `package.mo` が無くてもよい。
  - 下位フォルダのライブラリ（`ref/ModelicaStandardLibrary/Modelica/` 等）は従来どおり検出する。
  - どの `package.mo` にも属さない `.mo` は、その 1 ファイルが最上位クラスとしてルートに並ぶ
    （単一ファイルライブラリ `Complex.mo` や、ばら置きのモデルなど）。中のクラスも展開できる。
  - 探索範囲はワークスペースフォルダから 3 階層まで（構造化ライブラリの中は除外）。
- 展開すると `Modelica.Blocks.Sources.Sine` のようにパッケージ／クラスを辿れる。
  展開したときにだけ中身を読むため、MSL のような大きなライブラリでも初期表示は重くならない。
- 項目をクリックすると定義ファイルを開く。1 ファイルに複数クラスがある場合は**定義行へジャンプ**する。
- 右クリックから「定義を開く」「Documentation を表示」「ダイアグラムを表示」
  「**Modelica パスをコピー**」「**ファイルパスをコピー**」を実行できる
  （エディタで開いていないクラスにも使える）。
  - Modelica パス … `Modelica.Blocks.Examples.RealNetwork1` 形式の修飾名。
  - ファイルパス … その定義がある `.mo` の絶対パス（パッケージなら `package.mo`）。
- `.mo` の追加・削除・編集に追従して自動更新する。手動更新はビュー右上の 🔄。
- **並び順**は Modelica のソースの並びに合わせる。OpenModelica は不要。
  - ディレクトリのパッケージ … `package.order` の順。`package.order` に無いものは
    後ろにアルファベット順で続く。`package.order` が無ければアルファベット順。
  - 1 ファイルに複数クラスがある場合（`Blocks/package.mo` の `Examples` など）
    … そのファイルで**定義されている順**。
  - ライブラリのルート（最上位）同士はアルファベット順。

## 新規ファイル/パッケージ作成

Activity Bar の **Modelica ビュー**から実行する。ビュー右上の **＋（Modelica 新規作成）**、
またはツリーの**パッケージを右クリック →「Modelica 新規作成」**。
コマンドパレット（`Ctrl+Shift+P`）→「**Modelica: 新規作成**」でも実行できる。
名前を入力すると、テンプレートから `.mo` を生成して開き、`package.order` を自動更新する。

作成先は次の順で決まる。どこに作られるかは名前入力欄のプロンプトに表示する。

1. 右クリックしたツリー項目のパッケージフォルダ
2. **ツリーで選択中**の項目のパッケージフォルダ（`Modelica.Fluid` を選んで ＋ を押せば
   `Modelica/Fluid/` に作られる）
3. 開いているエディタの場所
4. ワークスペースフォルダ（複数あるときは選択ダイアログ）

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

Modelica ビューの右クリック、エディタ右上の 📖 ボタン、またはコマンドパレット
「Modelica: Documentation を表示」で、そのクラスの `Documentation(info="<html>…")` を横の
プレビュー（Webview）に描画する。対象クラスの決め方はダイアグラム表示と同じ（1 ファイルに
複数クラスがある場合も、選んだクラスの Documentation を表示する）。
VSCode のテーマに追従し、`<code>` / `<pre>` / 表 / リンク等をスタイル付きで表示する。
Documentation が無いモデルではその旨を通知する。

## ダイアグラム表示

**Modelica ビューでモデル/ブロックを右クリック →「ダイアグラムを表示」**、エディタ右上の
🔲 ボタン、またはコマンドパレット「Modelica: ダイアグラムを表示」で、モデルの構成を横の
プレビュー（Webview・SVG）に描画する。

- **対象は 1 クラスだけ**。`Modelica/Blocks/package.mo` のように 1 ファイルへ複数モデルを
  書いた形式でも、選んだクラスの定義範囲（`model X … end X;`）だけを切り出して描画する。
  - Modelica ビューから起動 … その項目のクラス。
  - エディタから起動 … **カーソル位置を含む最も内側のクラス**（ネストしたクラスにも対応）。
- パッケージを選んだ場合は描画せず、モデル/ブロックを選ぶよう通知する。
- 相対的に書かれた型名（`Sources.Sine` など）は、対象クラスを囲むパッケージを内側から
  順に補って解決する。
- 各コンポーネントを型の**Icon 図形**（Line/Rectangle/Ellipse/Polygon/Text）で描画し、`Placement`
  （origin / extent / rotation）どおりに配置する。Icon は `extends` を辿って基底クラスから収集し
  （基底が下・派生が上）、`%name` はコンポーネント名に置換する。Icon が無い型は名前と型名を書いた
  ボックスにフォールバック。
- **ポート（コネクタ）も描く**。型の Icon に置かれた `RealInput` / `Flange_a` / `Pin` などを
  継承込みで集め、それぞれのアイコンで本体の上に重ねる。
  - ポートかどうかは**型を解決して見出しが `connector` か**で判定する（型名の綴りでは決めない）。
    配置は `iconTransformation`、無ければ `transformation`（Modelica の既定どおり）。
  - `LimPID` の `Add addD if with_D` のような**条件付きの内部ブロックはポートではない**ので描かない。
- 図形の属性を Modelica の指定どおりに反映する。
  - `fillPattern` … Solid のほか、ハッチング（Horizontal/Vertical/Cross/Forward/Backward/CrossDiag）と
    グラデーション（HorizontalCylinder/VerticalCylinder/Sphere）。
  - `pattern` … Dash / Dot / DashDot / DashDotDot の線種。`radius`（角丸）、`borderPattern`。
  - `Line` の `arrow`（Filled/Open/Half）・`arrowSize`、`smooth=Bezier`（Line/Polygon）。
  - `Text` の `fontSize`（0 は枠に合わせて自動）・`fontName`・`textStyle`（Bold/Italic/UnderLine）・
    `horizontalAlignment`・改行。反転配置（extent の符号反転）でも文字は正立させる。
  - `visible=false` の図形は描かない。
- `annotation(Diagram(graphics=…))` に直接書かれた図形（枠・注記など）も描画する。
- `Foo x if cond` の**条件付きコンポーネント**は、Boolean パラメータの既定値から条件が false と
  分かる場合に薄く表示する。
- `connect(...)` の `Line(points=…, color=…)` を**接続線**として描画（信号=青・熱=赤など元の色）。
  マウスを乗せると接続元/先が出る。
- `Diagram(coordinateSystem(extent=…))` を座標系（キャンバス）として白く敷き、Orbis と同じ
  1/2/5×10ⁿ の目盛りを重ねる。Modelica の Y 上向きは SVG 用に反転する。
  - 指定が無いモデルは既定の `{{-100,-100},{100,100}}`。座標系の外に置かれた
    コンポーネント/接続線/図形があれば、そこまで表示範囲を自動で広げる（見切れを防ぐ）。
  - Modelica のアイコンは白背景前提で色が付いているため、キャンバスは VS Code のテーマに
    追従させず常に白。
- **パン/ズーム** — ドラッグでパン、ホイールでカーソル基点のズーム、ダブルクリックでリセット。
  viewBox を書き換えて拡大するので、拡大しても線の太さと目盛りの見かけは変わらない。
- 描画領域だけを表示し、見出しや操作ヒントは置かない（クラス名はパネルのタブに出る）。

グラフィック解析/描画は同梱ライブラリ **`app/modelicaGraphics/`**（vscode 非依存・依存ゼロ）に
切り出している。解析・描画のモデルは別プロジェクト **Orbis**（`ref/Orbis`）の
`app/src/features/modelica-browser` から移植したもので、型定義（`types.ts`）・annotation パーサ
（`annotation.ts`）・レイヤ抽出（`layers.ts`）・継承解決（`inheritance.ts`）・SVG 描画
（`render.ts`）に分かれている。Orbis 側は React コンポーネントで編集機能も持つが、この拡張は
表示専用のため描画を SVG 文字列生成へ置き換えている。

## アイコン表示

エディタ右上の 🎨 ボタン、またはコマンドパレット「Modelica: アイコンを表示」で、
そのクラスが**ダイアグラム上でどう見えるか**（`annotation(Icon(...))`）を横のプレビュー
（Webview・SVG）に描画する。対象クラスの決め方はダイアグラム表示と同じ。

- `annotation(Icon(coordinateSystem(extent=…)))` をキャンバス（座標系）として白く敷き、
  その上に図形をワールド座標のまま描く。指定が無ければ既定の `{{-100,-100},{100,100}}`。
- **`extends` の継承図形も描く**。基底クラスの Icon を下に、派生クラスの Icon を上に重ねる
  （ダイアグラム上での見た目と一致する）。表示専用ビューなので継承分も淡色化せず実物どおりに描く。
- **アイコンに配置されたコネクタ**（`RealInput` / `Flange_a` / `Pin` など）を、継承元で宣言された
  ものも含めて `iconTransformation`（無ければ `transformation`）どおりに重ねる。
  マウスを乗せるとインスタンス名と型名が出る。型のアイコンを解決できないコネクタは
  破線枠＋名前のボックスにフォールバック。
- 図形属性（fillPattern / 線種 / 矢印 / smooth / フォント / `%name` 置換など）の扱いと、
  **パン/ズーム**（ドラッグ・ホイール・ダブルクリックでリセット）、目盛りの描画は
  ダイアグラム表示と共通。座標系の外にはみ出た図形があれば表示範囲を自動で広げる。
- Icon の図形も配置コネクタも無いクラスではその旨を通知する。

ダイアグラム表示とは別のパネルで開くので、両方を並べて見比べられる。
描画は `app/modelicaGraphics/` の `buildIconSvg`（`render.ts`）が担い、Webview の HTML は
ダイアグラム表示と共用している。Orbis の**アイコンエディタ**（作図・レイヤー・書き戻し）に
相当する編集機能はまだ持たず、この拡張では表示のみ。

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
出力先のルートは設定 `modelica.buildDirectory` で変更できる。
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
`modelica.omcPath` が空の場合は OS の `PATH` から `omc` を探す。

既定インストール先（Windows）は次の形式で、`bin` フォルダを `PATH` に追加する。

```text
C:\Program Files\OpenModelica<バージョン>-64bit\bin
例: C:\Program Files\OpenModelica1.26.1-64bit\bin
```

`PATH` 追加後は VSCode（およびターミナル）を再起動して反映する。
チェック/シミュレーション以外の機能は OpenModelica なしでも動作する。

## 設定（Settings）

詳細な用途と変更方法は [docs/SETTINGS.md](docs/SETTINGS.md) にまとめている。

| 設定キー | 既定 | 説明 |
|---|---|---|
| `modelica.omcPath` | 空文字 | omc 実行ファイルのパス。空なら OS の PATH から検索 |
| `modelica.checkOnSave` | `false` | 保存時に自動で checkModel を実行 |
| `modelica.buildDirectory` | `.modelica-build` | checkModel / simulate の作業ディレクトリ |
| `modelica.simulation.startTime` | `0.0` | Simulation Setup の Start Time 初期値 |
| `modelica.simulation.stopTime` | `1.0` | Simulation Setup の Stop Time 初期値 |
| `modelica.simulation.interval` | `0.1` | Simulation Setup の Interval 初期値 |
| `modelica.simulation.numberOfIntervals` | `500` | Simulation Setup の Number of Intervals 初期値 |
| `modelica.tree.focusDefinition` | `true` | パッケージツリーから定義を開いたときに定義範囲へフォーカス表示 |

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
| Want | アイコンビュー | Webview（SVG・表示専用） | ✅ |
| Want | パッケージツリー表示 | Activity Bar + TreeDataProvider | ✅ |

保留中の改善候補: ワークスペース外ライブラリのジャンプ対応（`modelica.libraryPaths`）、
非クラスメンバー（定数）への定義行着地、`import` 別名/継承相対名の解決、クラス名の横断リネーム。

## 開発メモ

### ファイル構成

拡張機能の実体はすべて `app/` 配下。リポジトリ直下にはドキュメント・参照ライブラリ・
インストーラだけを置く。

```text
modelica_vscode_extention/
├── install.bat                          # build → install / update / uninstall スクリプト
├── README.md / LICENSE / docs/
├── ref/ModelicaStandardLibrary/         # 参照用 MSL（git submodule）
└── app/                                 # ← VSCode 拡張の実体
    ├── package.json                     # マニフェスト（言語/文法/コマンド/メニュー/設定）
    ├── tsconfig.json                    # TS ビルド設定（strict・out/ へ出力）
    ├── language-configuration.json      # 括弧/コメント/インデント設定
    ├── src/
    │   ├── extension.ts                 # エントリ（コマンド登録・各プロバイダ）
    │   ├── util.ts                      # パス・修飾名ユーティリティ（vscode 非依存）
    │   ├── omc.ts                       # omc 連携（.mos 生成・実行・出力パース）
    │   ├── annotations.ts               # annotation の読み書き（experiment/Documentation/範囲抽出）
    │   ├── symbols.ts                   # シンボル解決（ジャンプ/補完/リネームの基盤・vscode 非依存）
    │   ├── modelicaTree.ts              # Modelica Packages ツリー（TreeDataProvider・UI 層）
    │   ├── graphics.ts                  # modelicaGraphics への薄いアダプタ
    │   └── vscodeApi.ts                 # vscode モジュールの読み込みガード
    ├── resources/
    │   ├── modelica-icon-lg.png         # Activity Bar 用アイコン（透過 PNG・テーマ色で塗られる）
    │   └── modelica.svg                 # 旧 Activity Bar 用アイコン（単色 SVG・未使用）
    ├── syntaxes/
    │   └── modelica.tmLanguage.json     # TextMate 文法（ハイライト定義）
    ├── modelicaGraphics/                # 同梱: グラフィック解析/SVG 描画ライブラリ（vscode 非依存）
    │   ├── index.ts                     # 公開 API のエントリ
    │   └── src/
    │       ├── parse.ts                 # 低レベル解析（括弧/配列/brace 値）＋座標型
    │       ├── diagram.ts               # 配置・接続の解析と buildDiagramSvg
    │       └── icon.ts                  # Icon パース＋プリミティブ→SVG
    └── out/                             # ビルド成果物（git 管理外・実行されるのはこちら）
```

### ビルド

```bat
cd app
npm install          REM 初回のみ（typescript / @types / vsce など）
npm run compile      REM out/ へコンパイル（差分）
npm run rebuild      REM out/ を消してからコンパイル（install.bat が使う）
npm run clean        REM out/ を消すだけ
npm run watch        REM 監視ビルド
npm run typecheck    REM 型検査のみ（出力なし）
```

普段の開発は `compile` / `watch` でよい。`tsc` はソースをリネーム・削除しても `out/` の
古い `.js` を消さないため、VSIX 作成時は `vscode:prepublish` 経由で必ず `rebuild` を使う。

`package.json` の `main` は `./out/src/extension.js`。`rootDir` を `app/` にしているので
`out/src/` と `out/modelicaGraphics/` の相対関係がソースと同じになり、
`graphics.ts` の `../modelicaGraphics` がビルド後もそのまま解決される。

TypeScript は `strict` に加え `noUncheckedIndexedAccess` を有効にしている。文字走査は
`text[i]`（`string | undefined`）ではなく `text.charAt(i)`（範囲外は `""`）を使う。

`omc` 連携は Node 標準 `child_process` のみでランタイム依存パッケージはない。
`util` / `omc` / `annotations` / `symbols` / `modelicaGraphics` は vscode に依存しないため、
ビルド後に Node 単体で純粋ロジックの検証ができる（`extension.js` 自体も
`vscodeApi.ts` のガードにより VSCode 外から `require` できる）。

### ハイライトのデバッグ

コマンドパレット → `Developer: Inspect Editor Tokens and Scopes` で、カーソル位置のトークンに
割り当てられた TextMate スコープを確認できる。色が期待通りでない場合の原因特定に使う。
