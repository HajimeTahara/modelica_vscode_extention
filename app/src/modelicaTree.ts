// Modelica Packages ツリー（Activity Bar）— vscode 依存の UI 層。
//
// 表示単位はファイル/フォルダではなく Modelica の名前空間（Modelica.Blocks.Sources.Sine 等）。
// 解析本体は vscode 非依存の src/symbols.ts に置いたままとし、ここでは
// 「修飾名 → TreeItem」の変換と遅延展開だけを担当する（omc 不要・オフラインで動く）。

import type * as vscodeTypes from "vscode";
import { vscode } from "./vscodeApi";
import * as symbols from "./symbols";
import type { ChildItem, ClassKind, RootMap } from "./symbols";

// vscode が読めない環境ではダミーを基底にして、モジュール読み込み自体は成功させる。
const TreeItemBase: typeof vscodeTypes.TreeItem =
  (vscode && vscode.TreeItem) ||
  (class {} as unknown as typeof vscodeTypes.TreeItem);

/** ModelicaTreeNode の生成引数。 */
export interface ModelicaTreeNodeInit {
  label: string;
  qname: string;
  kind: ClassKind;
  expandable: boolean;
}

/** ツリー項目。Modelica の完全修飾名（qname）を持つ。 */
export class ModelicaTreeNode extends TreeItemBase {
  readonly qname: string;
  readonly kind: ClassKind;

  constructor({ label, qname, kind, expandable }: ModelicaTreeNodeInit) {
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
export class ModelicaTreeProvider
  implements vscodeTypes.TreeDataProvider<ModelicaTreeNode>
{
  private readonly getRootMap: () => Promise<RootMap>;
  private readonly _onDidChangeTreeData: vscodeTypes.EventEmitter<
    ModelicaTreeNode | undefined
  >;
  readonly onDidChangeTreeData: vscodeTypes.Event<ModelicaTreeNode | undefined>;
  /** 展開 1 回分の listPackageChildren 結果（ファイル読み込みの重複を避ける）。 */
  private readonly _childCache = new Map<string, ChildItem[]>();
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(getRootMap: () => Promise<RootMap>) {
    this.getRootMap = getRootMap;
    this._onDidChangeTreeData = new vscode.EventEmitter<
      ModelicaTreeNode | undefined
    >();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh(): void {
    this._childCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** ファイル監視の連続イベントをまとめて 1 回の refresh にする。 */
  refreshSoon(delayMs?: number): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.refresh();
    }, delayMs || 300);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: ModelicaTreeNode): ModelicaTreeNode {
    return element;
  }

  async getChildren(element?: ModelicaTreeNode): Promise<ModelicaTreeNode[]> {
    let rootMap: RootMap;
    try {
      rootMap = await this.getRootMap();
    } catch (_) {
      return [];
    }

    // ルート: ワークスペース内ライブラリのルートパッケージ（package.mo の宣言名）と、
    // package.mo に属さない単一ファイルの最上位クラス。
    if (!element) {
      return Object.keys(rootMap)
        .sort((a, b) => a.localeCompare(b))
        .map(
          (name) =>
            new ModelicaTreeNode({
              label: name,
              qname: name,
              kind: symbols.rootKind(rootMap, name),
              expandable: this._isExpandable(name, rootMap),
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
  private _children(qname: string, rootMap: RootMap): ChildItem[] {
    const cached = this._childCache.get(qname);
    if (cached) return cached;
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
  private _isExpandable(qname: string, rootMap: RootMap): boolean {
    const c = symbols.resolveContainer(qname, rootMap);
    if (!c) return false;
    if (c.type === "dir") return true;
    return this._children(qname, rootMap).length > 0;
  }
}

/** ノードの定義位置を開く。ネストクラスは定義行へジャンプする。 */
export async function openNode(
  node: ModelicaTreeNode | undefined,
  rootMap: RootMap
): Promise<void> {
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
