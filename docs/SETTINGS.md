# Modelica 拡張機能の設定

この拡張機能の設定は `app/package.json` の `contributes.configuration` で定義している。
VS Code では設定画面や `settings.json` から変更できる。

## 設定一覧

| 設定キー | 型 | 既定値 | 用途 |
|---|---:|---|---|
| `modelica.omcPath` | string | `omc` | OpenModelica コンパイラ `omc` の実行ファイルパス。`checkModel` と `simulate` 実行時に使う。 |
| `modelica.checkOnSave` | boolean | `false` | `.mo` ファイル保存時に `checkModel` を自動実行するかどうか。 |
| `modelica.simulation.stopTime` | number | `1.0` | Simulation Setup ダイアログの Stop Time 初期値。モデル内の `annotation(experiment(...))` や前回設定が無い場合に使う。 |
| `modelica.simulation.numberOfIntervals` | integer | `500` | Simulation Setup ダイアログの Number of Intervals 初期値。モデル内の `Interval` や前回設定が無い場合に使う。 |
| `modelica.tree.focusDefinition` | boolean | `true` | Modelica Packages ツリーから定義を開いたとき、対象定義だけを残して前後を折りたたむかどうか。エディタ右上の「定義のフォーカス表示を解除」ボタンの表示条件にも使う。 |

## 変更方法

### VS Code の設定画面から変更する

1. `Ctrl+,` で Settings を開く。
2. 検索欄に `modelica` と入力する。
3. 必要な項目を変更する。

拡張機能画面から変更する場合は、Extensions でこの拡張機能を開き、歯車メニューから Extension Settings を選ぶ。

### settings.json に直接書く

ユーザー全体に反映したい場合は User Settings、ワークスペースごとに変えたい場合は `.vscode/settings.json` に書く。

```json
{
  "modelica.omcPath": "C:\\OpenModelica1.26.1-64bit\\bin\\omc.exe",
  "modelica.checkOnSave": true,
  "modelica.simulation.stopTime": 10,
  "modelica.simulation.numberOfIntervals": 1000,
  "modelica.tree.focusDefinition": false
}
```

## コード上の使われ方

### `modelica.omcPath`

`app/src/extension.ts` の `getConfig()` で読み込み、`checkModel` と `simulate` の実行時に
`app/src/omc.ts` の `runOmc()` へ渡す。

PATH に `omc` が通っている環境では既定値のままでよい。PATH に無い場合は `omc.exe` の絶対パスを指定する。

### `modelica.checkOnSave`

`app/src/extension.ts` の保存イベントで参照する。

`true` の場合、Modelica ファイル保存時に `checkModel` を自動実行し、Problems パネルへ診断を反映する。
`false` の場合は、右上のチェックボタン、右クリックメニュー、コマンドパレットから手動実行する。

### `modelica.simulation.stopTime`

Simulation Setup ダイアログを開くときの Stop Time 初期値として使う。

初期値の優先順位は次の通り。

1. モデル内の `annotation(experiment(StopTime=...))`
2. そのモデルで前回使った Simulation Setup の値
3. `modelica.simulation.stopTime`

### `modelica.simulation.numberOfIntervals`

Simulation Setup ダイアログを開くときの Number of Intervals 初期値として使う。

初期値の優先順位は次の通り。

1. そのモデルで前回使った Simulation Setup の値
2. `modelica.simulation.numberOfIntervals`

モデル内の `annotation(experiment(Interval=...))` がある場合は、ダイアログの区間指定モードは
Interval 優先になる。ただし Number of Intervals 側の初期値としては、この設定または前回値を保持する。

### `modelica.tree.focusDefinition`

`app/src/modelicaTree.ts` で、Modelica Packages ツリーから項目を開くときに参照する。

`true` の場合、対象クラスの定義範囲だけが見えるように前後を折りたたむ。
`false` の場合は、定義位置へジャンプするだけで折りたたみは行わない。

また `app/package.json` のメニュー条件でも使っており、設定が有効なときだけ
「Modelica: 定義のフォーカス表示を解除」をエディタタイトルに表示する。

## 設定項目を追加するとき

新しい設定を追加する場合は、基本的に次の手順で行う。

1. `app/package.json` の `contributes.configuration.properties` に設定キー、型、既定値、説明を追加する。
2. VS Code API を使ってよい場所で `vscode.workspace.getConfiguration("modelica").get(...)` する。
3. 設定変更に即時追従したい場合は `vscode.workspace.onDidChangeConfiguration(...)` を追加する。
4. `cd app && npm run compile` で型チェックを通す。

設定キーは `modelica.<機能>.<項目>` の形にすると、VS Code の設定画面で探しやすい。
