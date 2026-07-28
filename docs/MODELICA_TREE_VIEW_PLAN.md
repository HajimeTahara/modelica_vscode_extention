# Modelica Tree View 実装方針

本書は、VS Code の Activity Bar に Modelica 専用ビューを追加し、ファイルツリーではなく
Modelica のパッケージ/クラス構造としてツリー表示するための実装方針をまとめる。

## 目的

- Activity Bar に `Modelica` 専用タブを追加する。
- その中に `Modelica Packages` ツリーを表示する。
- 表示単位はファイル/フォルダではなく、Modelica の名前空間とする。
  - 例: `Modelica.Blocks.Sources.Sine`
  - 例: `EAST.Orbital.Examples.SomeModel`
- ツリー項目をクリックしたら対応する `.mo` / `package.mo` を開く。
- 既存の軽量シンボル解決を再利用し、OpenModelica `omc` は不要とする。

## 既存コードで使えるもの

### ルートパッケージ検出

`src/extension.js` の `getRootMap()` は、ワークスペース内の `package.mo` を検索し、
ルートパッケージ名からディレクトリへの対応表を作る。

```js
{
  Modelica: "path/to/ModelicaStandardLibrary/Modelica",
  EAST: "path/to/EAST"
}
```

この処理は go-to-definition / 補完 / ダイアグラム表示ですでに使われているため、
Modelica ツリーのルート項目にも流用する。

### 子要素列挙

`src/symbols.js` の `listPackageChildren(qname, rootMap)` は、
指定した Modelica 修飾名の子クラス/子パッケージを列挙できる。

```js
symbols.listPackageChildren("Modelica.Blocks", rootMap);
// => [{ name: "Sources", kind: "package" }, { name: "Continuous", kind: "package" }, ...]
```

この関数は以下を見ている。

- ディレクトリ配下のサブパッケージ
- `.mo` ファイル
- `package.mo` 内のネストクラス
- `.mo` ファイル内のネストクラス

初期実装では、この関数をツリーの子要素取得にそのまま使う。

## VS Code 側の構成

### `package.json` に View Container を追加

Activity Bar のタブは `contributes.viewsContainers.activitybar` で定義する。

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "modelica",
      "title": "Modelica",
      "icon": "resources/modelica.svg"
    }
  ]
}
```

`icon` は単色 SVG が望ましい。VS Code のテーマ色で着色されるため、
`fill="currentColor"` または `stroke="currentColor"` を使う。

### `package.json` に View を追加

View Container の中に実際のツリー View を登録する。

```json
"views": {
  "modelica": [
    {
      "id": "modelica.packageTree",
      "name": "Modelica Packages"
    }
  ]
}
```

### コマンド候補

最小実装では以下を追加する。

- `modelica.packageTree.refresh`
  - ツリーを再読み込みする。
- `modelica.packageTree.open`
  - 選択項目の定義ファイルを開く。

将来拡張として以下も候補にする。

- `modelica.packageTree.revealActiveClass`
  - 現在開いている `.mo` に対応するツリー項目を表示する。
- `modelica.packageTree.showDocumentation`
  - 選択クラスの Documentation を表示する。
- `modelica.packageTree.showDiagram`
  - 選択クラスの Diagram を表示する。
- `modelica.packageTree.check`
  - 選択クラスを `checkModel` する。

## 実装ファイル構成

初期実装では、`src/extension.js` に直接実装してもよい。
ただし `extension.js` はすでに大きいため、保守性を優先するなら新規ファイルに分ける。

推奨構成:

```text
src/
  extension.js
  modelicaTree.js
  symbols.js
  util.js
```

`src/modelicaTree.js` は VS Code 依存の UI 層とし、Modelica の解析本体は既存の
`src/symbols.js` / `src/util.js` に置いたままにする。

## TreeDataProvider 設計

### ノード構造

ツリー項目は Modelica の完全修飾名を持つ。

```js
class ModelicaTreeNode extends vscode.TreeItem {
  constructor({ label, qname, kind, file }) {
    super(
      label,
      kind === "package"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.qname = qname;
    this.kind = kind;
    this.file = file;
    this.tooltip = qname;
    this.description = kind === "package" ? "package" : "";
    this.contextValue = `modelica.${kind}`;
    this.command = file
      ? {
          command: "modelica.packageTree.open",
          title: "Open Modelica Class",
          arguments: [this],
        }
      : undefined;
  }
}
```

### Provider の基本形

```js
class ModelicaTreeProvider {
  constructor(getRootMap) {
    this.getRootMap = getRootMap;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    const rootMap = await this.getRootMap();

    if (!element) {
      return Object.keys(rootMap)
        .sort()
        .map((name) => new ModelicaTreeNode({
          label: name,
          qname: name,
          kind: "package",
          file: path.join(rootMap[name], "package.mo"),
        }));
    }

    return symbols
      .listPackageChildren(element.qname, rootMap)
      .map((child) => {
        const qname = `${element.qname}.${child.name}`;
        const resolved = symbols.resolveClass(qname, rootMap);
        return new ModelicaTreeNode({
          label: child.name,
          qname,
          kind: child.kind,
          file: resolved && resolved.file,
        });
      });
  }
}
```

### 登録

`activate(context)` で provider とコマンドを登録する。

```js
const treeProvider = new ModelicaTreeProvider(getRootMap);

context.subscriptions.push(
  vscode.window.registerTreeDataProvider("modelica.packageTree", treeProvider),
  vscode.commands.registerCommand("modelica.packageTree.refresh", () => {
    rootMapCache = null;
    treeProvider.refresh();
  }),
  vscode.commands.registerCommand("modelica.packageTree.open", async (node) => {
    if (!node || !node.file) return;
    const doc = await vscode.workspace.openTextDocument(node.file);
    await vscode.window.showTextDocument(doc);
  })
);
```

`createTreeView()` を使うと `reveal()` が使いやすくなる。
初期実装では `registerTreeDataProvider()` で十分だが、将来
`revealActiveClass` を実装するなら `createTreeView()` に切り替える。

## ツリー更新

既存コードでは `**/package.mo` の作成/削除時に `rootMapCache` を無効化している。
ツリー View も同じタイミングで更新する。

追加で監視したいもの:

- `**/*.mo`
  - クラスファイルの増減
  - ファイル内ネストクラスの増減
- `**/package.order`
  - 表示順を反映する場合

初期実装では以下でよい。

```js
const modelicaWatcher = vscode.workspace.createFileSystemWatcher("**/*.mo");
modelicaWatcher.onDidCreate(() => treeProvider.refresh());
modelicaWatcher.onDidDelete(() => treeProvider.refresh());
modelicaWatcher.onDidChange(() => treeProvider.refresh());
context.subscriptions.push(modelicaWatcher);
```

`package.mo` の増減時は `rootMapCache = null` も必要。

## 表示順

初期実装:

- アルファベット順
- package / class は同列表示

改善案:

- `package.order` がある場合はその順序を優先する。
- `package` を先、`class` を後にする。
- `partial` / `model` / `block` / `record` / `connector` などの種別を表示する。

`package.order` 対応を入れる場合は、`symbols.listPackageChildren()` 側に順序制御を足すと、
補完など他機能にも同じ並びを流用できる。

## アイコン

TreeItem の `iconPath` には ThemeIcon を使う。

```js
node.iconPath =
  kind === "package"
    ? new vscode.ThemeIcon("package")
    : new vscode.ThemeIcon("symbol-class");
```

将来、種別ごとに分ける場合:

- `package`: `package`
- `model` / `class`: `symbol-class`
- `block`: `symbol-method` または専用 SVG
- `record`: `symbol-struct`
- `connector`: `plug`
- `function`: `symbol-function`
- `type`: `symbol-type-parameter`

ただし現状の `listPackageChildren()` は `package` / `class` のみを返すため、
詳細種別を出すには `symbols.js` にクラスキーワード取得 API を追加する。

## クリック時の挙動

初期実装:

- package: `package.mo` を開く
- class: 対応する `.mo`、またはネストクラスを含むファイルを開く
- ネストクラスの場合は定義行へジャンプする

`symbols.resolveClass(qname, rootMap)` は `{ file, line, character }` を返せるため、
開くだけでなく位置指定もできる。

```js
const loc = symbols.resolveClass(node.qname, rootMap);
const doc = await vscode.workspace.openTextDocument(loc.file);
await vscode.window.showTextDocument(doc, {
  selection: new vscode.Range(loc.line, loc.character, loc.line, loc.character),
});
```

## Context Menu

`package.json` の `menus.view/item/context` に追加する。

```json
"view/item/context": [
  {
    "command": "modelica.packageTree.open",
    "when": "view == modelica.packageTree && viewItem =~ /modelica\\./",
    "group": "navigation@1"
  },
  {
    "command": "modelica.showDocumentation",
    "when": "view == modelica.packageTree && viewItem =~ /modelica\\.(package|class)/",
    "group": "modelica@2"
  },
  {
    "command": "modelica.showDiagram",
    "when": "view == modelica.packageTree && viewItem =~ /modelica\\.class/",
    "group": "modelica@3"
  }
]
```

既存の `modelica.showDocumentation` / `modelica.showDiagram` は現在アクティブエディタ前提なので、
ツリー選択ノードから呼べるようにするには、ファイルを開いてから既存処理へ渡すか、
内部関数を `doc` 引数で呼ぶコマンドを別に用意する。

## 実装手順

1. `resources/modelica.svg` を追加する。
2. `package.json` に `viewsContainers` / `views` を追加する。
3. `package.json` に refresh / open コマンドを追加する。
4. `src/modelicaTree.js` を追加する。
5. `src/extension.js` の `activate()` で TreeDataProvider とコマンドを登録する。
6. `package.mo` / `.mo` の watcher から `treeProvider.refresh()` を呼ぶ。
7. ツリー項目クリックで `symbols.resolveClass()` の位置へジャンプする。
8. 手動確認後、必要なら `package.order` 順に対応する。

## 検証観点

- Activity Bar に `Modelica` タブが表示される。
- `Modelica Packages` ツリーが表示される。
- ルートパッケージが `package.mo` の宣言名で表示される。
- `ModelicaStandardLibrary` ディレクトリでも、ルート名は `Modelica` になる。
- パッケージを展開すると Modelica の子要素が表示される。
- `.mo` ファイルのクラスをクリックすると該当ファイルが開く。
- ネストクラスをクリックすると定義行に移動する。
- `.mo` / `package.mo` を追加・削除したときに refresh される。
- ワークスペースに Modelica パッケージが無い場合でもエラーにならない。
- 大きい MSL を含むワークスペースで、展開時に極端に重くならない。

## 注意点

- TreeDataProvider の `getChildren()` は展開時に呼ばれるため、全ツリーを最初に総走査しない。
- `rootMapCache` の無効化とツリー refresh は別物として扱う。
- `src/symbols.js` / `src/util.js` は vscode 非依存を維持する。
- `omc` は使わない。ツリー表示はオフラインで動く軽量機能とする。
- Modelica ファイルを拡張都合で書き換えない。

## 将来拡張

- `package.order` による表示順対応。
- クラス種別ごとのアイコン表示。
- アクティブエディタに対応するツリー項目の reveal。
- ツリー項目から check / simulate / documentation / diagram を実行。
- `modelica.libraryPaths` 設定を追加し、ワークスペース外ライブラリも表示。
- ツリー内検索、または QuickPick による Modelica クラスジャンプ。
