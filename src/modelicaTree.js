// Modelica Packages ツリー（Activity Bar）— vscode 依存の UI 層。
//
// 表示単位はファイル/フォルダではなく Modelica の名前空間（Modelica.Blocks.Sources.Sine 等）。
// 解析本体は vscode 非依存の src/symbols.js に置いたままとし、ここでは
// 「修飾名 → TreeItem」の変換と遅延展開だけを担当する（omc 不要・オフラインで動く）。

// vscode モジュールはランタイム外（単体テスト等）では読み込めないためガードする。
let vscode;
try {
  vscode = require("vscode");
} catch (_) {
  vscode = null;
}
const symbols = require("./symbols");

const TreeItemBase = vscode ? vscode.TreeItem : class {};

/** ツリー項目。Modelica の完全修飾名（qname）を持つ。 */
class ModelicaTreeNode extends TreeItemBase {
  constructor({ label, qname, kind, expandable }) {
    super(
      label,
      expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    // id を与えると再描画（refresh）をまたいで展開状態が保たれる。qname は一意。
    this.id = qname;
    this.qname = qname;
    this.kind = kind;
    this.tooltip = qname;
    this.description = kind === "package" ? "package" : "";
    this.contextValue = `modelica.${kind}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === "package" ? "package" : "symbol-class"
    );
    this.command = {
      command: "modelica.packageTree.open",
      title: "Open Modelica Class",
      arguments: [this],
    };
  }
}

/**
 * Modelica の名前空間ツリーを供給する TreeDataProvider。
 * getChildren() は展開時にだけ呼ばれるため、初期表示で全ツリーを総走査しない。
 */
class ModelicaTreeProvider {
  /** @param getRootMap () => Promise<{ルートパッケージ名: ディレクトリ}> */
  constructor(getRootMap) {
    this.getRootMap = getRootMap;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    // 展開 1 回分の listPackageChildren 結果（ファイル読み込みの重複を避ける）。
    this._childCache = new Map();
    this._timer = null;
  }

  refresh() {
    this._childCache.clear();
    this._onDidChangeTreeData.fire();
  }

  /** ファイル監視の連続イベントをまとめて 1 回の refresh にする。 */
  refreshSoon(delayMs) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.refresh();
    }, delayMs || 300);
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    let rootMap;
    try {
      rootMap = await this.getRootMap();
    } catch (_) {
      return [];
    }

    // ルート: ワークスペース内ライブラリのルートパッケージ（package.mo の宣言名）
    if (!element) {
      return Object.keys(rootMap)
        .sort((a, b) => a.localeCompare(b))
        .map(
          (name) =>
            new ModelicaTreeNode({
              label: name,
              qname: name,
              kind: "package",
              expandable: true,
            })
        );
    }

    try {
      return this._children(element.qname, rootMap).map((c) => {
        const qname = `${element.qname}.${c.name}`;
        return new ModelicaTreeNode({
          label: c.name,
          qname,
          kind: c.kind,
          expandable: this._isExpandable(qname, rootMap),
        });
      });
    } catch (_) {
      // 走査中にファイルが消える等。ツリー全体を壊さない。
      return [];
    }
  }

  /** qname 直下の子（名前順）。 */
  _children(qname, rootMap) {
    if (this._childCache.has(qname)) return this._childCache.get(qname);
    const items = symbols.listPackageChildren(qname, rootMap);
    items.sort((a, b) => a.name.localeCompare(b.name));
    this._childCache.set(qname, items);
    return items;
  }

  /**
   * 展開可能か。
   *  - ディレクトリパッケージ … 常に展開可
   *  - 単一ファイルのクラス   … ネストクラスを持つときだけ展開可
   *  - ファイル内ネストクラス … それ以上は辿れないため展開不可
   */
  _isExpandable(qname, rootMap) {
    const c = symbols.resolveContainer(qname, rootMap);
    if (!c) return false;
    if (c.type === "dir") return true;
    return this._children(qname, rootMap).length > 0;
  }
}

/** ノードの定義位置を開く。ネストクラスは定義行へジャンプする。 */
async function openNode(node, rootMap) {
  if (!node || !node.qname) return;
  const loc = symbols.resolveClass(node.qname, rootMap);
  if (!loc || !loc.file) {
    vscode.window.showWarningMessage(
      `Modelica: ${node.qname} の定義ファイルが見つかりません。`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(loc.file);
  const pos = new vscode.Position(loc.line, loc.character);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
  });
}

module.exports = { ModelicaTreeNode, ModelicaTreeProvider, openNode };
