# SETTINGS

本書ではmodelica vscode拡張機能の設定一覧をまとめる

## 設定一覧

| 設定キー | 型 | デフォルト | 用途 |
|---|---:|---|---|
| `modelica.omcPath` | string | 空文字 | OpenModelica コンパイラ `omc` の実行ファイルパス。空の場合、または指定パスが見つからない場合は OS の `PATH` から `omc` を探す。 |
| `modelica.checkOnSave` | boolean | `false` | `.mo` ファイル保存時に `checkModel` を自動実行するかどうか。 |
| `modelica.buildDirectory` | string | `.modelica-build` | `checkModel` と `simulate` の作業ディレクトリ。相対パスは対象ファイルが属するワークスペースフォルダから解決する。 |
| `modelica.libraryFiles` | string[] | `[]` | `checkModel` と `simulate` で既定として読み込むライブラリのトップ `package.mo`。配列の順序で `loadFile` する。 |
| `modelica.simulation.startTime` | number | `0.0` | Simulation Setup ダイアログの Start Time 初期値。モデル内の `annotation(experiment(...))` や前回設定が無い場合に使う。 |
| `modelica.simulation.stopTime` | number | `1.0` | Simulation Setup ダイアログの Stop Time 初期値。モデル内の `annotation(experiment(...))` や前回設定が無い場合に使う。 |
| `modelica.simulation.interval` | number | `0.1` | Simulation Setup ダイアログの Interval 初期値。モデル内の `annotation(experiment(Interval=...))` や前回設定が無い場合に使う。 |
| `modelica.simulation.numberOfIntervals` | integer | `500` | Simulation Setup ダイアログの Number of Intervals 初期値。前回設定が無い場合に使う。 |
| `modelica.tree.focusDefinition` | boolean | `true` | Modelica Packages ツリーから定義を開いたとき、対象定義だけを残して前後を折りたたむかどうか。エディタ右上の「定義のフォーカス表示を解除」ボタンの表示条件にも使う。 |

## Tips : 拡張機能設定の変更方法

### VS Code 設定画面

1. `Ctrl+,` で Settings を開く。
2. 検索欄に `modelica` と入力する。
3. 必要な項目を変更する。

拡張機能画面から変更する場合は、Extensions でこの拡張機能を開き、歯車メニューから Extension Settings を選ぶ。

### settings.json 

ユーザー全体に反映したい場合は User Settings、ワークスペースごとに変えたい場合は `.vscode/settings.json` に書く。

```json
{
  "modelica.omcPath": "C:\\OpenModelica1.26.1-64bit\\bin\\omc.exe",
  "modelica.checkOnSave": true,
  "modelica.buildDirectory": ".modelica-build",
  "modelica.libraryFiles": [
    "${workspaceFolder}/../ModelicaStandardLibrary/Modelica/package.mo",
    "${workspaceFolder}/../Helion/package.mo"
  ],
  "modelica.simulation.startTime": 0,
  "modelica.simulation.stopTime": 10,
  "modelica.simulation.interval": 0.1,
  "modelica.simulation.numberOfIntervals": 1000,
  "modelica.tree.focusDefinition": false
}
```

`modelica.buildDirectory` に相対パスを指定した場合は、対象ファイルが属するワークスペースフォルダからの相対パスとして扱う。
絶対パスを指定した場合は、その場所をそのまま作業ディレクトリのルートにする。

`modelica.omcPath` は空でもよい。空の場合は OS の `PATH` から `omc` を探す。
値を指定した場合はそのパスを先に試し、見つからなければ最後に OS の `PATH` から `omc` を探す。

`modelica.libraryFiles` はワークスペース設定に置くことを推奨する。手動で「モデルをチェック」または
「シミュレーション実行」を選ぶと Setup 画面が開き、ここに指定した有効な項目がライブラリ入力欄の
初期値として表示される。その実行だけ追加・除外できる。「ライブラリを追加」で行を作り、各行の
フォルダボタンからエクスプローラーでトップ `package.mo` を選ぶ。入力した内容は設定へ保存されない。
保存時の自動チェックでは、この既定リストをそのまま使う。

VS Code 標準の Settings UI にある配列の入力欄へ、拡張機能からファイル選択ボタンは追加できない。
既定値をエクスプローラーから設定するには、コマンドパレットで
**「Modelica: 既定ライブラリをエクスプローラーから選択」**を実行する。選んだトップ `package.mo` は、
アクティブなワークスペース（複数なら選択したワークスペース）の `modelica.libraryFiles` に保存される。
