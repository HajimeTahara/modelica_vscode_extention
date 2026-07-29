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

// Modelica のクラス種別 → codicon 名。ツリーのアイコンをクラスタイプ別に描き分ける。
const KIND_ICON: Record<ClassKind, string> = {
  package: "package",
  model: "symbol-class",
  block: "symbol-interface",
  record: "symbol-structure",
  connector: "plug",
  type: "symbol-ruler",
  function: "symbol-function",
  operator: "symbol-operator",
  class: "symbol-misc",
};

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
    this.tooltip = `${kind} ${qname}`;
    this.description = kind;
    this.contextValue = `modelica.${kind}`;
    this.iconPath = new vscode.ThemeIcon(KIND_ICON[kind] || "symbol-misc");
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

  /** qname 直下の子。並び順は symbols 側（package.order / 定義順）に従う。 */
  private _children(qname: string, rootMap: RootMap): ChildItem[] {
    const cached = this._childCache.get(qname);
    if (cached) return cached;
    const items = symbols.listPackageChildren(qname, rootMap);
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

/** 行全体を覆う Selection（手動折りたたみ範囲の指定用）。 */
function lineSpan(
  doc: vscodeTypes.TextDocument,
  from: number,
  to: number
): vscodeTypes.Selection {
  const last = Math.min(to, doc.lineCount - 1);
  return new vscode.Selection(from, 0, last, doc.lineAt(last).text.length);
}

/**
 * エディタを「startLine〜endLine の定義だけ」の表示にする。
 *
 * VS Code には任意の行を隠す API が無いため、手動折りたたみ範囲
 * （editor.createFoldingRangeFromSelection）で定義の前後を畳む。折りたたみは
 * 常に先頭行が残る仕様なので、後半は endLine 自身から畳んで余計な行を見せない。
 * 言語の既定の折りたたみ（FoldingRangeProvider / インデント）は壊さない。
 */
async function focusRange(
  editor: vscodeTypes.TextEditor,
  startLine: number,
  endLine: number
): Promise<void> {
  const doc = editor.document;
  const last = doc.lineCount - 1;
  const saved = editor.selection;
  try {
    // 前回のフォーカス表示を解除してから畳み直す。
    editor.selection = lineSpan(doc, 0, last);
    await vscode.commands.executeCommand("editor.removeManualFoldingRanges");
    await vscode.commands.executeCommand("editor.unfoldAll");
    if (endLine < last) {
      editor.selection = lineSpan(doc, endLine, last);
      await vscode.commands.executeCommand(
        "editor.createFoldingRangeFromSelection"
      );
    }
    // 先頭行は畳んでも残るため、2 行以上あるときだけ畳む。
    if (startLine >= 2) {
      editor.selection = lineSpan(doc, 0, startLine - 1);
      await vscode.commands.executeCommand(
        "editor.createFoldingRangeFromSelection"
      );
    }
  } catch (_) {
    // 折りたたみに失敗しても、行へのジャンプまでは成立させる。
    editor.selection = saved;
  }
}

/** フォーカス表示（手動折りたたみ）を解除して全体を戻す。 */
export async function clearFocus(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const saved = editor.selection;
  try {
    editor.selection = lineSpan(doc, 0, doc.lineCount - 1);
    await vscode.commands.executeCommand("editor.removeManualFoldingRanges");
    await vscode.commands.executeCommand("editor.unfoldAll");
  } finally {
    editor.selection = saved;
    editor.revealRange(saved, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

/**
 * ノードの定義位置を開く。ネストクラスは定義行へジャンプし、
 * 設定 modelica.tree.focusDefinition が有効なら定義だけを残して前後を折りたたむ。
 */
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
  const editor = await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
  });
  const focus = vscode.workspace
    .getConfiguration("modelica")
    .get<boolean>("tree.focusDefinition", true);
  if (focus && typeof loc.endLine === "number")
    await focusRange(editor, loc.line, loc.endLine);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.AtTop
  );
}
