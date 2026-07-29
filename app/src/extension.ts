// Modelica VSCode 拡張 — エントリポイント
//
// 実装済み:
//   - シンタックスハイライト（TextMate 文法・宣言のみ）
//   - ⑤ 新規ファイル作成（model/block/record/connector/function/type/package）
//   - ④ コンパイル・計算実行（omc 連携: checkModel / simulate）

import type * as vscodeTypes from "vscode";
import { vscode } from "./vscodeApi";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as util from "./util";
import * as omc from "./omc";
import * as annotations from "./annotations";
import * as symbols from "./symbols";
import * as graphics from "./graphics";
import * as modelicaTree from "./modelicaTree";
import type { RootMap } from "./symbols";
import type {
  ClassTextResolver,
  DiagramSvgResult,
  GraphicsLayer,
  IconMap,
  NodeIcon,
} from "./graphics";

const { isValidIdent, qualifiedName, findLibraryRoot, classNameForFile } = util;

/** catch した値からユーザ向けメッセージを取り出す。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// =====================================================================
// ⑤ 新規ファイル作成
// =====================================================================

/** 新規作成できる Modelica エンティティの種別。 */
type EntityKind =
  | "model"
  | "block"
  | "record"
  | "connector"
  | "function"
  | "type"
  | "package";

const KIND_LABEL: Record<EntityKind, string> = {
  model: "空モデル",
  block: "ブロック (SISO)",
  record: "レコード",
  connector: "コネクタ",
  function: "関数",
  type: "型",
  package: "パッケージ",
};

function renderTemplate(kind: EntityKind, name: string, within: string): string {
  const w = `within ${within};`;
  const doc = `  annotation (Documentation(info="<html>\n</html>"));`;
  switch (kind) {
    case "model":
      return `${w}\nmodel ${name}\n\n${doc}\nend ${name};\n`;
    case "block":
      return `${w}\nblock ${name}\n  extends Modelica.Blocks.Interfaces.SISO;\n\n${doc}\nend ${name};\n`;
    case "record":
      return `${w}\nrecord ${name}\n\n${doc}\nend ${name};\n`;
    case "connector":
      return `${w}\nconnector ${name}\n\n${doc}\nend ${name};\n`;
    case "function":
      return `${w}\nfunction ${name}\n\n${doc}\nend ${name};\n`;
    case "type":
      return `${w}\ntype ${name} = Real annotation (Documentation(info="<html>\n</html>"));\n`;
    case "package":
      return `${w}\npackage ${name}\n  extends Modelica.Icons.Package;\n\n${doc}\nend ${name};\n`;
    default:
      throw new Error(`未知のエンティティ種別: ${kind}`);
  }
}

/** dir/package.order に name を追記する（重複時は何もしない） */
function addToPackageOrder(dir: string, name: string): void {
  const orderPath = path.join(dir, "package.order");
  let lines: string[] = [];
  if (fs.existsSync(orderPath)) {
    lines = fs
      .readFileSync(orderPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
  }
  if (!lines.includes(name)) {
    lines.push(name);
  }
  fs.writeFileSync(orderPath, lines.join("\n") + "\n", "utf8");
}

/**
 * 親ディレクトリの package.order を更新する。ただし親が実際に Modelica パッケージ
 * （package.mo を持つ）のときだけ。トップパッケージ作成時に非パッケージの上位ディレクトリへ
 * package.order を作らないようにする。
 */
function updateParentOrder(dir: string, name: string): void {
  if (fs.existsSync(path.join(dir, "package.mo"))) {
    addToPackageOrder(dir, name);
  }
}

/** 修飾名の所在フォルダ（パッケージならそのフォルダ、クラスなら定義ファイルの置き場）。 */
async function dirOfQname(qname: string): Promise<string | undefined> {
  const c = symbols.resolveContainer(qname, await getRootMap());
  if (!c) return undefined;
  return c.type === "dir" ? c.path : path.dirname(c.path);
}

/**
 * コマンド起動元から作成先ディレクトリを決定する。
 *  - Modelica ビューの項目（qname を持つ）… そのパッケージのフォルダ（クラスならその置き場）
 *  - Uri                                  … そのフォルダ（ファイルなら親フォルダ）
 *  - 引数なし                             … ツリーで選択中の項目 → 開いているエディタの場所
 *                                           → ワークスペースフォルダ
 */
async function resolveTargetDir(arg?: unknown): Promise<string | undefined> {
  if (arg && typeof arg === "object") {
    const node = arg as { qname?: unknown };
    if (typeof node.qname === "string") return await dirOfQname(node.qname);
    const uri = arg as vscodeTypes.Uri;
    if (uri.fsPath) {
      try {
        return fs.statSync(uri.fsPath).isDirectory()
          ? uri.fsPath
          : path.dirname(uri.fsPath);
      } catch (_) {
        /* fall through */
      }
    }
  }
  // ビューのタイトルバー（＋ ボタン）からは引数が来ないため、ツリーの選択を使う。
  const selected = selectedTreeQname();
  if (selected) {
    const dir = await dirOfQname(selected);
    if (dir) return dir;
  }
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === "file") {
    return path.dirname(ed.document.uri.fsPath);
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return undefined;
  if (folders.length === 1) return folders[0]!.uri.fsPath;
  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "作成先のワークスペースフォルダ",
  });
  return picked ? picked.uri.fsPath : undefined;
}

async function createEntity(kind: EntityKind, arg?: unknown): Promise<void> {
  const dir = await resolveTargetDir(arg);
  if (!dir) {
    vscode.window.showErrorMessage(
      "作成先フォルダを特定できません。Modelica ビューでパッケージを右クリックするか、.mo ファイルを開いてください。"
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    title: `Modelica: ${KIND_LABEL[kind]}を新規作成`,
    prompt: `${KIND_LABEL[kind]}の名前（作成先: ${qualifiedName(dir) || dir}）`,
    validateInput: (v) =>
      isValidIdent(v)
        ? undefined
        : "Modelica 識別子（英字か _ で始まり、英数字か _ のみ）を入力してください。",
  });
  if (!name) return;

  try {
    let openPath: string;
    if (kind === "package") {
      const pkgDir = path.join(dir, name);
      if (fs.existsSync(pkgDir)) {
        vscode.window.showErrorMessage(`既に存在します: ${pkgDir}`);
        return;
      }
      fs.mkdirSync(pkgDir);
      const within = qualifiedName(dir);
      fs.writeFileSync(
        path.join(pkgDir, "package.mo"),
        renderTemplate("package", name, within),
        "utf8"
      );
      fs.writeFileSync(path.join(pkgDir, "package.order"), "", "utf8");
      updateParentOrder(dir, name);
      openPath = path.join(pkgDir, "package.mo");
    } else {
      const filePath = path.join(dir, `${name}.mo`);
      if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`既に存在します: ${filePath}`);
        return;
      }
      const within = qualifiedName(dir);
      fs.writeFileSync(filePath, renderTemplate(kind, name, within), "utf8");
      updateParentOrder(dir, name);
      openPath = filePath;
    }

    const doc = await vscode.workspace.openTextDocument(openPath);
    await vscode.window.showTextDocument(doc);
  } catch (err) {
    vscode.window.showErrorMessage(`作成に失敗しました: ${errorMessage(err)}`);
  }
}

// =====================================================================
// ④ コンパイル・計算実行（omc 連携）
// =====================================================================

let diagnostics!: vscodeTypes.DiagnosticCollection;
let output!: vscodeTypes.OutputChannel;
let extContext!: vscodeTypes.ExtensionContext; // workspaceState 用
let docPanel: vscodeTypes.WebviewPanel | undefined; // Documentation 表示の Webview（使い回し）
let diagramPanel: vscodeTypes.WebviewPanel | undefined; // Diagram View の Webview（使い回し）
let packageTreeView: vscodeTypes.TreeView<modelicaTree.ModelicaTreeNode> | undefined;
const annotationsHidden = new Set<string>(); // annotation を折りたたみ中のドキュメント URI

/** Modelica ビューで選択中の項目の修飾名。選択が無ければ undefined。 */
function selectedTreeQname(): string | undefined {
  const sel = packageTreeView && packageTreeView.selection;
  return sel && sel.length ? sel[0]!.qname : undefined;
}

/**
 * コマンド引数（ツリー項目）から修飾名を得る。
 * コマンドパレット等で引数が無い場合はツリーの選択にフォールバックする。
 */
function qnameForCommand(arg: unknown): string | undefined {
  if (arg && typeof arg === "object") {
    const node = arg as { qname?: unknown };
    if (typeof node.qname === "string") return node.qname;
  }
  return selectedTreeQname();
}

/** Modelica 形式の修飾名（Modelica.Blocks.Examples.RealNetwork1）をクリップボードへ。 */
async function copyModelicaPath(arg: unknown): Promise<void> {
  const qname = qnameForCommand(arg);
  if (!qname) {
    vscode.window.showWarningMessage(
      "Modelica: コピー対象がありません。Modelica ビューで項目を選んでください。"
    );
    return;
  }
  await vscode.env.clipboard.writeText(qname);
  vscode.window.setStatusBarMessage(`Modelica: コピーしました — ${qname}`, 3000);
}

/** 定義ファイルのパスをクリップボードへ。 */
async function copyFilePath(arg: unknown): Promise<void> {
  const qname = qnameForCommand(arg);
  if (!qname) {
    vscode.window.showWarningMessage(
      "Modelica: コピー対象がありません。Modelica ビューで項目を選んでください。"
    );
    return;
  }
  const loc = symbols.resolveClass(qname, await getRootMap());
  if (!loc || !loc.file) {
    vscode.window.showWarningMessage(
      `Modelica: ${qname} の定義ファイルが見つかりません。`
    );
    return;
  }
  await vscode.env.clipboard.writeText(loc.file);
  vscode.window.setStatusBarMessage(`Modelica: コピーしました — ${loc.file}`, 3000);
}

/** 拡張設定。 */
interface ModelicaConfig {
  omcPath: string;
  checkOnSave: boolean;
  stopTime: number;
  intervals: number;
}

function getConfig(): ModelicaConfig {
  const c = vscode.workspace.getConfiguration("modelica");
  return {
    omcPath: c.get("omcPath", "omc"),
    checkOnSave: c.get("checkOnSave", false),
    stopTime: c.get("simulation.stopTime", 1.0),
    intervals: c.get("simulation.numberOfIntervals", 500),
  };
}

function toSeverity(s: omc.OmcSeverity): vscodeTypes.DiagnosticSeverity {
  switch (s) {
    case "Error":
      return vscode.DiagnosticSeverity.Error;
    case "Warning":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/** パース済みエラー配列をファイル別に DiagnosticCollection へ反映する */
function applyDiagnostics(parsed: omc.OmcDiagnostic[]): void {
  diagnostics.clear();
  const byFile = new Map<string, vscodeTypes.Diagnostic[]>();
  for (const e of parsed) {
    // omc は 1 始まり・終端は包含。VSCode は 0 始まり・終端は排他。
    const range = new vscode.Range(
      Math.max(0, e.startLine - 1),
      Math.max(0, e.startCol - 1),
      Math.max(0, e.endLine - 1),
      Math.max(0, e.endCol)
    );
    const d = new vscode.Diagnostic(range, e.message, toSeverity(e.severity));
    d.source = "omc";
    const key = path.normalize(e.file);
    let list = byFile.get(key);
    if (!list) {
      list = [];
      byFile.set(key, list);
    }
    list.push(d);
  }
  for (const [file, ds] of byFile) {
    diagnostics.set(vscode.Uri.file(file), ds);
  }
}

/**
 * ワークスペース直下 .modelica-build にクラス名の完全ネストで実行用ディレクトリを用意する。
 * 例: EAST.Orbital.Examples.Foo -> .modelica-build/EAST/Orbital/Examples/Foo
 */
function ensureBuildDir(referenceFsPath: string, className: string): string {
  const wsFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(referenceFsPath)
  );
  const base = wsFolder ? wsFolder.uri.fsPath : path.dirname(referenceFsPath);
  const root = path.join(base, ".modelica-build");
  fs.mkdirSync(root, { recursive: true });
  const gi = path.join(root, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n", "utf8");
  const sub = className ? className.split(".").join(path.sep) : "";
  const buildDir = sub ? path.join(root, sub) : root;
  fs.mkdirSync(buildDir, { recursive: true });
  return buildDir;
}

/** omc 実行の共通パラメータ。 */
interface OmcTarget {
  filePath: string;
  loadTarget: string;
  className: string;
}

/** 対象ドキュメントから omc 実行の共通パラメータを組み立てる */
function resolveTarget(doc: vscodeTypes.TextDocument): OmcTarget {
  const filePath = doc.uri.fsPath;
  const root = findLibraryRoot(path.dirname(filePath));
  const loadTarget = root ? path.join(root, "package.mo") : filePath;
  const className = classNameForFile(filePath);
  return { filePath, loadTarget, className };
}

async function runCheck(doc: vscodeTypes.TextDocument | undefined): Promise<void> {
  if (!doc || doc.languageId !== "modelica") {
    vscode.window.showErrorMessage("チェックする Modelica ファイルを開いてください。");
    return;
  }
  await doc.save();
  const cfg = getConfig();
  const { filePath, loadTarget, className } = resolveTarget(doc);
  if (!className) {
    vscode.window.showErrorMessage("チェック対象のクラス名を特定できません。");
    return;
  }
  const script = omc.buildCheckScript({ loadTarget, className });
  const buildDir = ensureBuildDir(filePath, className);

  try {
    const res = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `Modelica: ${className} をチェック中…`,
      },
      () => omc.runOmc(cfg.omcPath, script, buildDir)
    );

    const located = omc.parseErrors(res.stdout);
    const unlocated = omc.parseUnlocated(res.stdout);
    applyDiagnostics(located);

    output.appendLine(`# checkModel(${className})`);
    output.appendLine(res.stdout.trim());
    output.appendLine("");

    const nErr =
      located.filter((e) => e.severity === "Error").length +
      unlocated.filter((u) => u.severity === "Error").length;

    if (nErr === 0) {
      vscode.window.setStatusBarMessage(`Modelica: ${className} チェック成功`, 5000);
      if (unlocated.length) {
        vscode.window.showWarningMessage(
          `omc: ${unlocated.map((u) => u.message).join(" / ")}`
        );
      }
    } else {
      vscode.commands.executeCommand("workbench.actions.view.problems");
      const extra = unlocated.length
        ? `（${unlocated.map((u) => u.message).join(" / ")}）`
        : "";
      vscode.window.showErrorMessage(
        `Modelica: ${className} に ${nErr} 件のエラー${extra}`
      );
    }
  } catch (e) {
    vscode.window.showErrorMessage(errorMessage(e));
  }
}

// omc がサポートする代表的なソルバ（Simulation Setup のプルダウン用・許可リスト兼用）
const SOLVERS = [
  "dassl",
  "euler",
  "heun",
  "rungekutta",
  "impeuler",
  "trapezoid",
  "imprungekutta",
  "irksco",
  "dopri45",
  "rungekuttaSsc",
  "radau5",
  "radau3",
  "radau1",
  "lobatto2",
  "lobatto4",
  "lobatto6",
  "gauss2",
  "gauss4",
  "gauss6",
  "cvode",
  "ida",
];

const OUTPUT_FORMATS = ["mat", "csv"];

// Simulation Setup の Logging で選べる代表的な LOG_* ストリーム（許可リスト兼用）
const LOG_FLAGS = [
  "LOG_STDOUT",
  "LOG_ASSERT",
  "LOG_STATS",
  "LOG_INIT",
  "LOG_SOLVER",
  "LOG_EVENTS",
  "LOG_NLS",
  "LOG_LS",
  "LOG_JAC",
  "LOG_DEBUG",
  "LOG_SUCCESS",
];

// 既定 ON の Logging（ユーザ要望: STDOUT / ASSERT / STATS）
const DEFAULT_LOGGING = ["LOG_STDOUT", "LOG_ASSERT", "LOG_STATS"];

/** Simulation Setup の確定値。 */
interface SimOptions {
  startTime: number;
  stopTime: number;
  intervalMode: "interval" | "numberOfIntervals";
  numberOfIntervals: number;
  interval: number;
  tolerance: number;
  method: string;
  outputFormat: string;
  deleteIntermediates: boolean;
  logging: string[];
}

/**
 * Webview から来た生入力を検証・正規化する。
 * 数値は Number 化し、method/outputFormat は許可リストに丸める。
 * .mos スクリプトへ埋め込むため、値の妥当性検証はインジェクション防止も兼ねる。
 */
function sanitizeOptions(raw: unknown): SimOptions {
  const r = (raw || {}) as Record<string, unknown>;
  const num = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  let intervals = parseInt(String(r["numberOfIntervals"]), 10);
  if (!Number.isFinite(intervals) || intervals < 1) intervals = 500;
  let interval = num(r["interval"], 0);
  if (!(interval > 0)) interval = 0;
  const method = r["method"];
  const outputFormat = r["outputFormat"];
  const logging = r["logging"];
  return {
    startTime: num(r["startTime"], 0),
    stopTime: num(r["stopTime"], 1),
    intervalMode:
      r["intervalMode"] === "interval" ? "interval" : "numberOfIntervals",
    numberOfIntervals: intervals,
    interval,
    tolerance: num(r["tolerance"], 1e-6),
    method: typeof method === "string" && SOLVERS.includes(method) ? method : "dassl",
    outputFormat:
      typeof outputFormat === "string" && OUTPUT_FORMATS.includes(outputFormat)
        ? outputFormat
        : "mat",
    deleteIntermediates:
      r["deleteIntermediates"] === undefined ? true : !!r["deleteIntermediates"],
    logging: Array.isArray(logging)
      ? logging.filter((f): f is string => typeof f === "string" && LOG_FLAGS.includes(f))
      : DEFAULT_LOGGING.slice(),
  };
}

/** intervalMode に応じて実際の numberOfIntervals を求める */
function effectiveIntervals(o: SimOptions): number {
  if (o.intervalMode === "interval" && o.interval > 0) {
    const span = o.stopTime - o.startTime;
    return Math.max(1, Math.round(span / o.interval));
  }
  return o.numberOfIntervals;
}

/** ビルドディレクトリの中間生成物を削除し、結果(.mat/.csv)・ログ(.log)・
 *  モデル情報(.mo/.mos)だけ残す */
function cleanBuildDir(buildDir: string, resultFile: string | null): void {
  const keepExt = new Set([".mat", ".csv", ".log", ".mo", ".mos"]);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(buildDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const p = path.join(buildDir, e.name);
    if (resultFile && path.normalize(p) === path.normalize(resultFile)) continue;
    if (keepExt.has(path.extname(e.name).toLowerCase())) continue;
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * saveTotalModel が出力した <simpleName>_total.mo が単体で有効かを、別のクリーンな omc
 * セッションで load + checkModel して検証する。無効なら .invalid にリネームして出力パネルに注記。
 * （`redeclare constant` を含む媒体等では saveTotalModel の出力が壊れて再ロードできないため）
 * 非同期・非ブロッキングで呼ぶ。失敗しても致命的でない。
 */
async function validateTotalModel(
  buildDir: string,
  className: string,
  simpleName: string,
  omcPath: string
): Promise<void> {
  const totalPath = path.join(buildDir, `${simpleName}_total.mo`);
  if (!fs.existsSync(totalPath)) return;
  const script = [
    "loadModel(Modelica); getErrorString();",
    `loadFile("${omc.toOmcPath(totalPath)}"); getErrorString();`,
    `checkModel(${className});`,
    "getErrorString();",
    "",
  ].join("\n");
  try {
    const res = await omc.runOmc(omcPath, script, buildDir);
    const nErr = omc
      .parseErrors(res.stdout)
      .filter((e) => e.severity === "Error").length;
    const valid = /completed successfully/.test(res.stdout) && nErr === 0;
    if (!valid) {
      const invalidPath = totalPath + ".invalid";
      try {
        fs.rmSync(invalidPath, { force: true });
      } catch (_) {
        /* ignore */
      }
      try {
        fs.renameSync(totalPath, invalidPath);
      } catch (_) {
        /* ignore */
      }
      output.appendLine(
        `# saveTotalModel 検証: ${simpleName}_total.mo は単体で読み込めませんでした` +
          `（redeclare constant を含む媒体等が原因で saveTotalModel の出力が壊れる）。` +
          `${path.basename(totalPath)}.invalid にリネームしました。` +
          `再現には .mos と元ソース(.mo)・結果(.mat)を利用してください。`
      );
      output.appendLine("");
    }
  } catch (_) {
    /* 検証自体の失敗は無視 */
  }
}

/** 指定オプションで実際に simulate を実行する */
async function runSimulation(
  doc: vscodeTypes.TextDocument | undefined,
  rawOptions: unknown
): Promise<void> {
  if (!doc || doc.languageId !== "modelica") {
    vscode.window.showErrorMessage(
      "シミュレーションする Modelica ファイルを開いてください。"
    );
    return;
  }
  const options = sanitizeOptions(rawOptions);
  await doc.save();
  const cfg = getConfig();
  const { filePath, loadTarget, className } = resolveTarget(doc);
  if (!className) {
    vscode.window.showErrorMessage("実行対象のクラス名を特定できません。");
    return;
  }
  const numberOfIntervals = effectiveIntervals(options);
  const buildDir = ensureBuildDir(filePath, className);
  const simpleName = className.split(".").pop()!;

  // モデル情報の保存（再現・アーカイブ用）:
  //  - <単純名>.mos       … 実行スクリプト（keepScriptPath で保存）
  //  - <単純名>_total.mo  … 依存込みの自己完結モデル（saveTotalModel、.mos 内で実行）
  //  - <元ファイル名>.mo  … 元ソースのそのままコピー
  const scriptPath = path.join(buildDir, `${simpleName}.mos`);
  try {
    fs.copyFileSync(filePath, path.join(buildDir, path.basename(filePath)));
  } catch (_) {
    /* ソースコピー失敗は致命的でない */
  }

  // 今回の実行で結果が生成されたかで成否を判定するため、古い結果ファイルを先に消す。
  const resultExt = options.outputFormat === "csv" ? "csv" : "mat";
  const expectedResult = path.join(buildDir, `${simpleName}.${resultExt}`);
  try {
    fs.rmSync(expectedResult, { force: true });
  } catch (_) {
    /* ignore */
  }

  // シミュレーション状態を受け取る TCP サーバ（omc の実行ファイルが -port で接続し進捗を送る）
  let reporter: vscodeTypes.Progress<{
    message?: string;
    increment?: number;
  }> | null = null;
  let lastPct = 0;
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (d: Buffer) => {
      buf += d.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const m = /^(\d+)\s/.exec(line); // "<0..10000> <status>"
        if (m && reporter) {
          const pct = Math.min(100, Math.round(parseInt(m[1]!, 10) / 100));
          if (pct > lastPct) {
            reporter.report({ increment: pct - lastPct, message: `${pct}%` });
            lastPct = pct;
          }
        }
      }
    });
    sock.on("error", () => {});
  });
  let statusPort = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    statusPort = addr && typeof addr === "object" ? addr.port : 0;
  } catch (_) {
    statusPort = 0; // ポートが確保できなければ進捗なしで続行
  }

  const simOptions = { ...options, numberOfIntervals, statusPort };
  const script = omc.buildSimulateScript({
    loadTarget,
    className,
    options: simOptions,
  });

  try {
    const res = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Modelica: ${className} をシミュレーション中…`,
        cancellable: false,
      },
      (progress) => {
        reporter = progress;
        return omc.runOmc(cfg.omcPath, script, buildDir, scriptPath);
      }
    );

    const located = omc.parseErrors(res.stdout);
    applyDiagnostics(located);
    const reported = omc.parseResultFile(res.stdout);
    // -r で相対名を指定しているため、omc は相対パスで報告する。buildDir 基準に解決する。
    const resultFile =
      reported && !path.isAbsolute(reported)
        ? path.join(buildDir, reported)
        : reported;

    output.appendLine(
      `# simulate(${className}, startTime=${options.startTime}, stopTime=${options.stopTime}, numberOfIntervals=${numberOfIntervals}, method="${options.method}", tolerance=${options.tolerance}, outputFormat="${options.outputFormat}", lv="${options.logging.join(",")}")`
    );
    output.appendLine(res.stdout.trim());
    output.appendLine("");

    const nErr = located.filter((e) => e.severity === "Error").length;
    // 成否は「今回の実行で結果ファイルが生成されたか」で判定する。
    // omc は非致命的なエラー（例: 一部媒体の redeclare constant）を出しても
    // シミュレーション自体は成功して結果を書くことがあるため、エラー件数では判定しない。
    const produced = fs.existsSync(expectedResult);
    const ok = produced;
    const resultFileFinal =
      resultFile && fs.existsSync(resultFile) ? resultFile : expectedResult;

    if (options.deleteIntermediates) {
      cleanBuildDir(buildDir, resultFileFinal);
    }

    // _total.mo が単体で有効か検証し、無効なら .invalid にリネーム＋注記（非ブロッキング）
    void validateTotalModel(buildDir, className, simpleName, cfg.omcPath);

    if (ok) {
      const openFolder = "フォルダを開く";
      const suffix = nErr > 0 ? "（omc 診断あり・Problems 参照）" : "";
      const choice = await vscode.window.showInformationMessage(
        `Modelica: ${className} シミュレーション成功 → ${path.basename(
          resultFileFinal
        )}${suffix}`,
        openFolder
      );
      if (choice === openFolder) {
        vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(resultFileFinal)
        );
      }
    } else {
      if (nErr > 0) {
        vscode.commands.executeCommand("workbench.actions.view.problems");
      }
      output.show(true);
      vscode.window.showErrorMessage(
        `Modelica: ${className} のシミュレーションに失敗しました（詳細は出力パネル「Modelica」）。`
      );
    }
  } catch (e) {
    vscode.window.showErrorMessage(errorMessage(e));
  } finally {
    try {
      server.close();
    } catch (_) {
      /* ignore */
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function htmlAttr(v: unknown): string {
  return String(v).replace(/"/g, "&quot;");
}

/** OMEdit の Simulation Setup 風の Webview HTML を生成する */
function getSimSetupHtml(
  webview: vscodeTypes.Webview,
  className: string,
  initial: SimOptions
): string {
  const nonce = getNonce();
  const solverOptions = SOLVERS.map(
    (s) =>
      `<option value="${s}"${s === initial.method ? " selected" : ""}>${s}</option>`
  ).join("");
  const formatOptions = OUTPUT_FORMATS.map(
    (f) =>
      `<option value="${f}"${
        f === initial.outputFormat ? " selected" : ""
      }>${f}</option>`
  ).join("");
  const logChecks = LOG_FLAGS.map(
    (f) =>
      `<label class="chk"><input type="checkbox" class="log-chk" value="${f}"${
        initial.logging.includes(f) ? " checked" : ""
      } /> ${f}</label>`
  ).join("");
  const numChecked = initial.intervalMode !== "interval" ? " checked" : "";
  const ivChecked = initial.intervalMode === "interval" ? " checked" : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; font-size: var(--vscode-font-size); }
  h2 { font-size: 1.1em; margin: 0 0 4px; }
  .cls { color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-family: var(--vscode-editor-font-family); }
  fieldset { border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, #8884)); border-radius: 4px; margin: 0 0 14px; padding: 10px 14px; }
  legend { padding: 0 6px; color: var(--vscode-descriptionForeground); }
  .row { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 8px; margin-bottom: 8px; }
  .row:last-child { margin-bottom: 0; }
  label.field { text-align: right; }
  input[type=number], select { width: 100%; box-sizing: border-box; padding: 4px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
  .radioline { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 8px; margin-bottom: 8px; }
  .radioline > label:first-child { text-align: right; }
  .logs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; }
  .chk { display: flex; align-items: center; gap: 6px; }
  .chk input, .radioline input[type=radio] { width: auto; }
  .buttons { margin-top: 6px; display: flex; gap: 8px; justify-content: flex-end; }
  button { padding: 6px 14px; border: none; border-radius: 2px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <h2>Simulation Setup</h2>
  <div class="cls">${className}</div>

  <fieldset>
    <legend>Simulation Interval</legend>
    <div class="row"><label class="field" for="startTime">Start Time [s]</label><input id="startTime" type="number" step="any" value="${htmlAttr(initial.startTime)}" /></div>
    <div class="row"><label class="field" for="stopTime">Stop Time [s]</label><input id="stopTime" type="number" step="any" value="${htmlAttr(initial.stopTime)}" /></div>
    <div class="radioline">
      <label><input type="radio" name="intervalMode" value="numberOfIntervals"${numChecked} /> Number of Intervals</label>
      <input id="numberOfIntervals" type="number" step="1" min="1" value="${htmlAttr(initial.numberOfIntervals)}" />
    </div>
    <div class="radioline">
      <label><input type="radio" name="intervalMode" value="interval"${ivChecked} /> Interval [s]</label>
      <input id="interval" type="number" step="any" min="0" value="${htmlAttr(initial.interval)}" />
    </div>
  </fieldset>

  <fieldset>
    <legend>Integration</legend>
    <div class="row"><label class="field" for="method">Method</label><select id="method">${solverOptions}</select></div>
    <div class="row"><label class="field" for="tolerance">Tolerance</label><input id="tolerance" type="number" step="any" value="${htmlAttr(initial.tolerance)}" /></div>
  </fieldset>

  <fieldset>
    <legend>Output</legend>
    <div class="row"><label class="field" for="outputFormat">Format</label><select id="outputFormat">${formatOptions}</select></div>
    <div class="chk" style="margin-top:6px"><input type="checkbox" id="deleteIntermediates"${
      initial.deleteIntermediates ? " checked" : ""
    } /> <label for="deleteIntermediates">中間コンパイルファイル (.c/.o/.h 等) を削除して結果だけ残す</label></div>
  </fieldset>

  <fieldset>
    <legend>Logging (-lv)</legend>
    <div class="logs">${logChecks}</div>
  </fieldset>

  <div class="buttons">
    <button class="secondary" id="cancel">Cancel</button>
    <button class="secondary" id="saveToModel">モデルに保存</button>
    <button id="simulate">Simulate</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  function collect() {
    return {
      startTime: document.getElementById('startTime').value,
      stopTime: document.getElementById('stopTime').value,
      intervalMode: (document.querySelector('input[name=intervalMode]:checked') || {}).value || 'numberOfIntervals',
      numberOfIntervals: document.getElementById('numberOfIntervals').value,
      interval: document.getElementById('interval').value,
      tolerance: document.getElementById('tolerance').value,
      method: document.getElementById('method').value,
      outputFormat: document.getElementById('outputFormat').value,
      deleteIntermediates: document.getElementById('deleteIntermediates').checked,
      logging: Array.from(document.querySelectorAll('.log-chk:checked')).map((e) => e.value),
    };
  }
  document.getElementById('simulate').addEventListener('click', () => {
    vscode.postMessage({ command: 'simulate', values: collect() });
  });
  document.getElementById('saveToModel').addEventListener('click', () => {
    vscode.postMessage({ command: 'saveToModel', values: collect() });
  });
  document.getElementById('cancel').addEventListener('click', () => {
    vscode.postMessage({ command: 'cancel' });
  });
</script>
</body>
</html>`;
}

/** Simulation Setup の設定をモデルの experiment / simulationFlags annotation に書き戻す */
async function saveSimSetupToModel(
  doc: vscodeTypes.TextDocument,
  className: string,
  rawOptions: unknown
): Promise<void> {
  const o = sanitizeOptions(rawOptions);
  const span = o.stopTime - o.startTime;
  const interval =
    o.intervalMode === "interval" && o.interval > 0
      ? o.interval
      : o.numberOfIntervals > 0
      ? span / o.numberOfIntervals
      : span;
  const expStr = `experiment(StartTime=${o.startTime}, StopTime=${o.stopTime}, Interval=${interval}, Tolerance=${o.tolerance})`;
  const flagsStr = `__OpenModelica_simulationFlags(s="${o.method}", lv="${o.logging.join(
    ","
  )}")`;
  const oldText = doc.getText();
  const newText = annotations.upsertSimulationAnnotation(
    oldText,
    className,
    expStr,
    flagsStr
  );
  if (newText === oldText) {
    vscode.window.setStatusBarMessage(`Modelica: ${className} 変更なし`, 3000);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const full = new vscode.Range(doc.positionAt(0), doc.positionAt(oldText.length));
  edit.replace(doc.uri, full, newText);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    await doc.save();
    vscode.window.setStatusBarMessage(
      `Modelica: ${className} に experiment 設定を保存しました`,
      4000
    );
  } else {
    vscode.window.showErrorMessage(`Modelica: ${className} への保存に失敗しました。`);
  }
}

/** 先に来た「未定義でない値」を返す。最後の値は既定値として必ず定義済みであること。 */
function pick<T>(...vals: (T | undefined | null)[]): T {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return vals[vals.length - 1] as T;
}

/** Simulation Setup ダイアログ（Webview）を開き、実行・保存を仲介する */
async function openSimulationSetup(
  doc: vscodeTypes.TextDocument | undefined
): Promise<void> {
  if (!doc || doc.languageId !== "modelica") {
    vscode.window.showErrorMessage(
      "シミュレーションする Modelica ファイルを開いてください。"
    );
    return;
  }
  const { className } = resolveTarget(doc);
  if (!className) {
    vscode.window.showErrorMessage("実行対象のクラス名を特定できません。");
    return;
  }
  const cfg = getConfig();
  const stateKey = `modelica.simopts.${className}`;
  const saved = extContext.workspaceState.get<Partial<SimOptions>>(stateKey, {});
  const text = doc.getText();
  const expA = annotations.parseExperiment(text) || {};
  const flagsA = annotations.parseSimulationFlags(text) || {};
  // 優先順位: モデルの annotation > 前回設定(workspaceState) > 既定

  let intervalMode: SimOptions["intervalMode"];
  let interval: number;
  let numberOfIntervals: number;
  if (expA.interval !== undefined) {
    intervalMode = "interval";
    interval = expA.interval;
    numberOfIntervals = pick(saved.numberOfIntervals, cfg.intervals);
  } else {
    intervalMode = pick(saved.intervalMode, "numberOfIntervals");
    interval = pick(saved.interval, 0.1);
    numberOfIntervals = pick(saved.numberOfIntervals, cfg.intervals);
  }
  const annLogging = (flagsA.logging || []).filter((f) => LOG_FLAGS.includes(f));

  const initial: SimOptions = {
    startTime: pick(expA.startTime, saved.startTime, 0),
    stopTime: pick(expA.stopTime, saved.stopTime, cfg.stopTime),
    intervalMode,
    interval,
    numberOfIntervals,
    tolerance: pick(expA.tolerance, saved.tolerance, 1e-6),
    method: pick(flagsA.method, saved.method, "dassl"),
    outputFormat: pick(saved.outputFormat, "mat"),
    deleteIntermediates: pick(saved.deleteIntermediates, true),
    logging: annLogging.length ? annLogging : pick(saved.logging, DEFAULT_LOGGING),
  };

  const panel = vscode.window.createWebviewPanel(
    "modelicaSimSetup",
    `Simulation Setup: ${className}`,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = getSimSetupHtml(panel.webview, className, initial);
  panel.webview.onDidReceiveMessage(
    async (msg: { command?: string; values?: unknown } | undefined) => {
      if (!msg) return;
      if (msg.command === "simulate") {
        const opts = sanitizeOptions(msg.values);
        await extContext.workspaceState.update(stateKey, opts);
        panel.dispose();
        runSimulation(doc, opts);
      } else if (msg.command === "saveToModel") {
        const opts = sanitizeOptions(msg.values);
        await extContext.workspaceState.update(stateKey, opts);
        await saveSimSetupToModel(doc, className, opts);
      } else if (msg.command === "cancel") {
        panel.dispose();
      }
    },
    undefined,
    extContext.subscriptions
  );
}

// =====================================================================
// ① 継承もと・変数宣言へのジャンプ（go-to-definition）
// =====================================================================

let rootMapCache: RootMap | null = null;

// 単一ファイルのルートを探す深さ（ワークスペースフォルダから 3 階層まで）。
// 構造化ライブラリ配下は除外するので、これ以上深く掘っても実りが少なく走査だけ重くなる。
const LOOSE_MO_GLOB = "{*.mo,*/*.mo,*/*/*.mo}";

/** dir か その祖先が package.mo を持つディレクトリ（= 構造化ライブラリの一部）か。 */
function isInsidePackageDir(dir: string, pkgDirs: Set<string>): boolean {
  let cur = dir;
  for (;;) {
    if (pkgDirs.has(cur)) return true;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * ワークスペースのライブラリルート {ルートパッケージ名: パス} を構築（キャッシュ）。
 * 値は package.mo を持つディレクトリ、または package.mo に属さない単一ファイル（.mo）。
 * 後者により、ワークスペースのルートに package.mo が無くても（単一ファイルライブラリや
 * ばら置きのモデルでも）ツリーに出る。
 */
async function getRootMap(): Promise<RootMap> {
  if (rootMapCache) return rootMapCache;
  const map: RootMap = {};
  const pkgDirs = new Set<string>();
  try {
    const uris = await vscode.workspace.findFiles(
      "**/package.mo",
      "**/node_modules/**",
      5000
    );
    const files = uris.map((u) => u.fsPath);
    for (const f of files) pkgDirs.add(path.dirname(f));
    for (const f of files) {
      const d = path.dirname(f);
      if (pkgDirs.has(path.dirname(d))) continue; // 親も package → ルートでない
      try {
        const name = symbols.readPrimaryClassName(fs.readFileSync(f, "utf8"));
        if (name && !(name in map)) map[name] = d;
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  }

  // 構造化ライブラリに属さない .mo は、それ自体が最上位クラス（Modelica 的に単一ファイル格納）。
  try {
    const uris = await vscode.workspace.findFiles(
      LOOSE_MO_GLOB,
      "**/node_modules/**",
      2000
    );
    for (const u of uris) {
      const f = u.fsPath;
      if (path.basename(f).toLowerCase() === "package.mo") continue;
      if (isInsidePackageDir(path.dirname(f), pkgDirs)) continue;
      try {
        const name =
          symbols.readPrimaryClassName(fs.readFileSync(f, "utf8")) ||
          path.basename(f, path.extname(f));
        if (util.isValidIdent(name) && !(name in map)) map[name] = f;
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  }

  rootMapCache = map;
  return map;
}

/**
 * コマンド引数から対象ドキュメントを求める。
 * エディタタイトル等の Uri → そのファイル、引数なし → アクティブエディタ。
 * 見つからなければ null（呼び出し側でメッセージを出す）。
 */
async function documentForCommand(
  arg: unknown
): Promise<vscodeTypes.TextDocument | null> {
  if (arg && typeof arg === "object") {
    const uri = arg as vscodeTypes.Uri;
    if (uri.scheme === "file" && uri.fsPath) {
      return await vscode.workspace.openTextDocument(uri);
    }
  }
  const ed = vscode.window.activeTextEditor;
  return ed ? ed.document : null;
}

/** Documentation / Diagram 表示の対象クラス（本文はそのクラスの範囲だけ）。 */
interface ClassTarget {
  /** 表示・型解決に使う完全修飾名。 */
  qname: string;
  kind: symbols.ClassKind;
  /** クラス定義の本文（`model X … end X;` の範囲）。 */
  text: string;
  /** 定義ファイル。 */
  file: string;
}

/**
 * ファイルの修飾名とファイル内のクラス経路から完全修飾名を作る。
 * package.mo の主クラス名はファイル修飾名の末尾と重複するため取り除く。
 */
function qnameOfPath(file: string, classPath: string[]): string {
  const segs = (classNameForFile(file) || "").split(".").filter(Boolean);
  const rest =
    segs.length && classPath.length && segs[segs.length - 1] === classPath[0]
      ? classPath.slice(1)
      : classPath;
  return [...segs, ...rest].join(".");
}

/**
 * コマンド引数から対象クラスを求める。
 *  - Modelica ビューの項目（qname を持つ）… そのクラスの定義だけ
 *  - エディタ / Uri                       … カーソル位置を含む最も内側のクラス定義だけ
 * 1 ファイルに複数クラスを書いた package.mo でも、対象クラスの範囲だけを切り出す。
 */
async function classTargetForCommand(arg: unknown): Promise<ClassTarget | null> {
  if (arg && typeof arg === "object") {
    const node = arg as { qname?: unknown };
    if (typeof node.qname === "string") {
      const src = symbols.readClassSource(node.qname, await getRootMap());
      if (!src) return null;
      return { qname: node.qname, kind: src.kind, text: src.text, file: src.file };
    }
  }
  const doc = await documentForCommand(arg);
  if (!doc || doc.languageId !== "modelica") return null;
  const file = doc.uri.fsPath;
  const text = doc.getText();
  // 同じドキュメントがアクティブならカーソル位置のクラス、そうでなければ先頭のクラス。
  const ed = vscode.window.activeTextEditor;
  const offset =
    ed && ed.document.uri.toString() === doc.uri.toString()
      ? doc.offsetAt(ed.selection.active)
      : 0;
  const src = symbols.classSourceAt(text, offset);
  if (!src) return { qname: classNameForFile(file), kind: "class", text, file };
  return {
    qname: qnameOfPath(file, src.path),
    kind: src.kind,
    text: src.text,
    file,
  };
}

/**
 * 相対的に書かれた型名を解決するときに試す接頭辞（内側スコープ順）。
 * 対象クラスを囲むパッケージ群と、ファイルの所属パッケージ。
 */
function typeScopes(qname: string, file: string): string[] {
  const segs = qname.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = segs.length - 1; i >= 1; i--) out.push(segs.slice(0, i).join("."));
  const dirQ = qualifiedName(path.dirname(file));
  if (dirQ && !out.includes(dirQ)) out.push(dirQ);
  return out;
}

/** 型名（相対名かもしれない）を scopes で補完し、実在するクラスの修飾名にする。 */
function resolveTypeName(
  name: string,
  scopes: string[],
  rootMap: RootMap
): string | null {
  if (symbols.classExists(name, rootMap)) return name;
  for (const s of scopes) {
    const q = s + "." + name;
    if (symbols.classExists(q, rootMap)) return q;
  }
  return null;
}

const definitionProvider: vscodeTypes.DefinitionProvider = {
  async provideDefinition(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const dn = symbols.dottedNameAt(text, offset);
    if (!dn || !dn.name) return null;
    const toLoc = (uri: vscodeTypes.Uri, line: number, character: number) =>
      new vscode.Location(uri, new vscode.Position(line, character));

    const isDotted = dn.name.includes(".");

    // 1) 単純名: まず現在ファイルのローカル宣言（変数/コンポーネント）
    if (!isDotted) {
      const loc = symbols.findLocalDeclaration(text, dn.name);
      if (loc) return toLoc(document.uri, loc.line, loc.character);
    }

    const rootMap = await getRootMap();

    // 2) クラス（修飾名）解決 = 継承もと(extends)や型参照へのジャンプ
    let cls = symbols.resolveClass(dn.name, rootMap);

    // 3) 単純名でクラス未解決 → 同一パッケージのクラスとして解決
    if (!cls && !isDotted) {
      const q = util.qualifiedName(path.dirname(document.uri.fsPath));
      if (q) cls = symbols.resolveClass(q + "." + dn.name, rootMap);
    }
    if (cls) return toLoc(vscode.Uri.file(cls.file), cls.line, cls.character);

    // 4) ドット名でクラス未解決（例: component.field）→ 先頭セグメントのローカル宣言
    if (isDotted) {
      const first = dn.name.split(".")[0]!;
      const loc = symbols.findLocalDeclaration(text, first);
      if (loc) return toLoc(document.uri, loc.line, loc.character);
    }
    return null;
  },
};

// =====================================================================
// ② 入力予測（補完）
// =====================================================================

const MODELICA_KEYWORDS = [
  "model", "class", "record", "block", "connector", "package", "type",
  "function", "operator", "extends", "import", "within", "parameter",
  "constant", "discrete", "flow", "stream", "input", "output", "inner",
  "outer", "replaceable", "redeclare", "final", "partial", "encapsulated",
  "each", "public", "protected", "equation", "algorithm", "initial",
  "annotation", "end", "if", "then", "else", "elseif", "elsewhen", "when",
  "for", "in", "loop", "while", "break", "return", "connect", "and", "or",
  "not", "true", "false", "der", "pre", "time", "enumeration",
];

const BUILTIN_TYPES = ["Real", "Integer", "Boolean", "String"];

/** name→CompletionItem（クラス/パッケージ）。Modelica のクラス種別ごとにアイコンを変える。 */
function classItem(name: string, kind: string): vscodeTypes.CompletionItem {
  const K = vscode.CompletionItemKind;
  const map: Record<string, vscodeTypes.CompletionItemKind> = {
    package: K.Module,
    record: K.Struct,
    connector: K.Interface,
    type: K.TypeParameter,
    function: K.Function,
    operator: K.Operator,
  };
  const it = new vscode.CompletionItem(name, map[kind] ?? K.Class);
  it.detail = kind;
  return it;
}

const completionProvider: vscodeTypes.CompletionItemProvider = {
  async provideCompletionItems(document, position) {
    const linePrefix = document
      .lineAt(position.line)
      .text.slice(0, position.character);
    const m = /([A-Za-z_][\w.]*)$/.exec(linePrefix);
    const token = m ? m[1]! : "";
    const rootMap = await getRootMap();
    const items: vscodeTypes.CompletionItem[] = [];

    if (token.includes(".")) {
      const qualifier = token.slice(0, token.lastIndexOf("."));

      // 1) パッケージ/クラスの子（Modelica.Blocks. → Interfaces, Sources, …）
      const children = symbols.listPackageChildren(qualifier, rootMap);
      if (children.length) {
        for (const c of children) items.push(classItem(c.name, c.kind));
        return items;
      }

      // 2) コンポーネントのメンバー（sun. → bodyName, mu, …）
      if (!qualifier.includes(".")) {
        const comp = symbols
          .parseComponents(document.getText())
          .find((c) => c.name === qualifier);
        if (comp) {
          const dirQ = util.qualifiedName(path.dirname(document.uri.fsPath));
          let cls = symbols.resolveClass(comp.type, rootMap);
          if (!cls && dirQ)
            cls = symbols.resolveClass(dirQ + "." + comp.type, rootMap);
          if (cls && cls.file) {
            const clsName = comp.type.split(".").pop()!;
            for (const mem of symbols.listClassMembers(
              cls.file,
              clsName,
              rootMap,
              4
            )) {
              const it = new vscode.CompletionItem(
                mem.name,
                vscode.CompletionItemKind.Field
              );
              it.detail = mem.type;
              items.push(it);
            }
          }
        }
      }
      return items;
    }

    // 素の単語: キーワード + 組込み型 + ローカル宣言 + ルート + 同一パッケージの兄弟
    for (const k of MODELICA_KEYWORDS)
      items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
    for (const t of BUILTIN_TYPES)
      items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.Class));
    for (const c of symbols.parseComponents(document.getText())) {
      const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Field);
      it.detail = c.type;
      items.push(it);
    }
    for (const rootName of Object.keys(rootMap))
      items.push(
        new vscode.CompletionItem(rootName, vscode.CompletionItemKind.Module)
      );
    const q = util.qualifiedName(path.dirname(document.uri.fsPath));
    if (q)
      for (const c of symbols.listPackageChildren(q, rootMap))
        items.push(classItem(c.name, c.kind));

    return items;
  },
};

// =====================================================================
// ③ 変数・オブジェクト名の一括変換（リネーム）
// =====================================================================

const WORD_RE = /[A-Za-z_]\w*/;

/** 位置のワード情報。 */
interface WordContext {
  range: vscodeTypes.Range;
  name: string;
  isMember: boolean;
  text: string;
}

/** 位置のワード範囲・名前・直前が '.'（メンバー参照）か を返す。 */
function wordContext(
  document: vscodeTypes.TextDocument,
  position: vscodeTypes.Position
): WordContext | null {
  const range = document.getWordRangeAtPosition(position, WORD_RE);
  if (!range) return null;
  const name = document.getText(range);
  const offset = document.offsetAt(range.start);
  const text = document.getText();
  let p = offset - 1;
  while (p >= 0 && /\s/.test(text.charAt(p))) p--;
  const isMember = p >= 0 && text.charAt(p) === ".";
  return { range, name, isMember, text };
}

/** name が現在ファイルのローカル宣言（変数/コンポーネント）か。 */
function isLocalComponent(text: string, name: string): boolean {
  return symbols.parseComponents(text).some((c) => c.name === name);
}

const renameProvider: vscodeTypes.RenameProvider = {
  prepareRename(document, position) {
    const wc = wordContext(document, position);
    if (!wc) throw new Error("リネームできる識別子がありません。");
    if (wc.isMember)
      throw new Error(
        "他オブジェクトのメンバーはリネームできません（そのクラス側で実行してください）。"
      );
    if (!isLocalComponent(wc.text, wc.name))
      throw new Error(
        "リネーム対象は変数・コンポーネント名のみ対応です（クラス名・型・キーワードは未対応）。"
      );
    return wc.range;
  },

  provideRenameEdits(document, position, newName) {
    const wc = wordContext(document, position);
    if (!wc) throw new Error("リネームできる識別子がありません。");
    if (wc.isMember) throw new Error("他オブジェクトのメンバーはリネームできません。");
    if (!util.isValidIdent(newName))
      throw new Error("無効な Modelica 識別子です（英字か _ で始まり、英数字か _ のみ）。");
    if (!isLocalComponent(wc.text, wc.name))
      throw new Error("リネーム対象は変数・コンポーネント名のみ対応です。");
    if (newName === wc.name) return new vscode.WorkspaceEdit();
    if (isLocalComponent(wc.text, newName))
      throw new Error(`"${newName}" は既にこのクラスで使われています。`);

    const text = wc.text;
    const span = symbols.primaryClassSpan(text);
    const lo = span ? span.start : 0;
    const hi = span ? span.end : text.length;
    const edit = new vscode.WorkspaceEdit();
    for (const o of symbols.findIdentifierOccurrences(text, wc.name)) {
      if (o.start < lo || o.end > hi) continue;
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(o.start), document.positionAt(o.end)),
        newName
      );
    }
    return edit;
  },
};

// =====================================================================
// Documentation 表示（Webview）
// =====================================================================

/** Documentation の HTML をテーマ対応の Webview 文書に包む。 */
function getDocHtml(
  webview: vscodeTypes.Webview,
  className: string,
  docHtml: string
): string {
  const inner = docHtml.replace(/^\s*<html>/i, "").replace(/<\/html>\s*$/i, "");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    padding: 12px 20px; line-height: 1.6; max-width: 900px; }
  h1 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border, #8884); padding-bottom: 4px; }
  h4, h3, h2 { margin-top: 1.4em; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background, #8882);
    padding: 1px 4px; border-radius: 3px; }
  pre { background: var(--vscode-textCodeBlock-background, #8882); padding: 10px; border-radius: 4px; overflow-x: auto; }
  a { color: var(--vscode-textLink-foreground); }
  table { border-collapse: collapse; } td, th { border: 1px solid var(--vscode-panel-border, #8884); padding: 4px 8px; }
  img { max-width: 100%; }
  .cls { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="cls">${className}</div>
  ${inner}
</body>
</html>`;
}

async function showDocumentation(target: ClassTarget | null): Promise<void> {
  if (!target) {
    vscode.window.showErrorMessage(
      "Modelica: 対象クラスを特定できません。Modelica ビューでクラスを選ぶか、.mo ファイルを開いてください。"
    );
    return;
  }
  const className = target.qname;
  const html = annotations.extractDocumentation(target.text);
  if (!html) {
    vscode.window.showInformationMessage(
      `Modelica: ${className || "このモデル"} に Documentation はありません。`
    );
    return;
  }
  if (!docPanel) {
    docPanel = vscode.window.createWebviewPanel(
      "modelicaDoc",
      "Modelica Documentation",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false }
    );
    docPanel.onDidDispose(() => {
      docPanel = undefined;
    });
  }
  docPanel.title = `Doc: ${className || ""}`.trim();
  docPanel.webview.html = getDocHtml(docPanel.webview, className || "", html);
  docPanel.reveal(vscode.ViewColumn.Beside, true);
}

// =====================================================================
// Diagram View（Webview・SVG）
// =====================================================================

/**
 * ダイアグラム Webview の HTML。パン/ズームは（CSS 変形ではなく）viewBox の
 * 書き換えで行う。SVG 側の線幅は vector-effect="non-scaling-stroke" なので、
 * こうすると拡大しても線が太らず、目盛りも常に一定の見かけで描ける。
 *
 * 配色は Orbis のダイアグラムビューに合わせる（キャンバスは白・外側は淡い青）。
 * Modelica のアイコンは白背景前提で色が付いているため、VS Code のテーマ色を
 * 敷くと黒い線画が沈む。ヘッダなど枠まわりだけテーマに追従させる。
 */
function getDiagramHtml(
  webview: vscodeTypes.Webview,
  className: string,
  diagram: DiagramSvgResult
): string {
  const nonce = getNonce();
  const view = JSON.stringify(diagram.viewBox);
  const canvas = JSON.stringify(diagram.canvas);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    display: flex; flex-direction: column; background: var(--vscode-editor-background); }
  .cls { padding: 6px 12px; color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    border-bottom: 1px solid var(--vscode-panel-border, #8884);
    background: var(--vscode-editor-background); }
  .canvas { flex: 1; overflow: hidden; position: relative; cursor: grab;
    background: rgb(233,241,251); }
  .canvas.panning { cursor: grabbing; }
  .canvas > svg { position: absolute; inset: 0; width: 100%; height: 100%;
    touch-action: none; user-select: none; }
  .hint { position: absolute; right: 8px; bottom: 6px; font-size: 11px;
    color: rgb(100,116,139); pointer-events: none; }
</style>
</head>
<body>
  <div class="cls">${className} — Diagram</div>
  <div class="canvas" id="canvas">${diagram.svg}<div class="hint">ドラッグ: パン ／ ホイール: ズーム ／ ダブルクリック: リセット</div></div>
<script nonce="${nonce}">
  const base = ${view};
  const canvasRect = ${canvas};
  const host = document.getElementById('canvas');
  const svg = host.querySelector('svg');
  const gridGroup = svg.querySelector('#mg-grid');
  let view = Object.assign({}, base);
  let panning = false, startX = 0, startY = 0, startView = null;

  // 1/2/5×10^n から見やすい目盛り間隔を選ぶ（Orbis の defaultGridStep と同じ）。
  function niceStep(raw) {
    if (!(raw > 0)) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
  }
  const step = niceStep(Math.max(canvasRect.width, canvasRect.height) / 20);
  const major = step * 5;

  function line(x1, y1, x2, y2, stroke, width) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('stroke', stroke); el.setAttribute('stroke-width', width);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    return el;
  }

  // 表示中の範囲だけ目盛りを引く。詰まりすぎる間隔は間引く。
  function drawGrid() {
    while (gridGroup.firstChild) gridGroup.removeChild(gridGroup.firstChild);
    const pxPerUnit = host.clientWidth / view.width;
    const left = view.x, right = view.x + view.width;
    const top = view.y, bottom = view.y + view.height;
    const showMinor = step * pxPerUnit >= 6;
    const showMajor = major * pxPerUnit >= 6;
    const frag = document.createDocumentFragment();
    const MAX = 4000;
    const isMajor = (v) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
    if (showMinor || showMajor) {
      for (let x = Math.ceil(left / step) * step, i = 0; x <= right && i < MAX; x += step, i++) {
        const m = isMajor(x);
        if (m ? showMajor : showMinor) {
          frag.appendChild(line(x, top, x, bottom, m ? 'rgb(168,190,219)' : 'rgb(206,219,238)', 1));
        }
      }
      for (let y = Math.ceil(top / step) * step, i = 0; y <= bottom && i < MAX; y += step, i++) {
        const m = isMajor(y);
        if (m ? showMajor : showMinor) {
          frag.appendChild(line(left, y, right, y, m ? 'rgb(168,190,219)' : 'rgb(206,219,238)', 1));
        }
      }
    }
    // 原点の中心線。
    if (0 >= left && 0 <= right) frag.appendChild(line(0, top, 0, bottom, 'rgb(120,140,170)', 1.4));
    if (0 >= top && 0 <= bottom) frag.appendChild(line(left, 0, right, 0, 'rgb(120,140,170)', 1.4));
    gridGroup.appendChild(frag);
  }

  function apply() {
    svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.width + ' ' + view.height);
    drawGrid();
  }

  // preserveAspectRatio="xMidYMid meet" による余白を考慮して、
  // クライアント座標を viewBox 座標へ変換する。
  function toView(clientX, clientY) {
    const r = host.getBoundingClientRect();
    const scale = Math.min(r.width / view.width, r.height / view.height);
    const offX = (r.width - view.width * scale) / 2;
    const offY = (r.height - view.height * scale) / 2;
    return {
      x: view.x + (clientX - r.left - offX) / scale,
      y: view.y + (clientY - r.top - offY) / scale,
      scale: scale,
    };
  }

  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toView(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1; // viewBox を縮めると拡大
    view = {
      x: p.x - (p.x - view.x) * factor,
      y: p.y - (p.y - view.y) * factor,
      width: view.width * factor,
      height: view.height * factor,
    };
    apply();
  }, { passive: false });

  host.addEventListener('pointerdown', (e) => {
    panning = true; startX = e.clientX; startY = e.clientY; startView = Object.assign({}, view);
    host.classList.add('panning');
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointermove', (e) => {
    if (!panning || !startView) return;
    const r = host.getBoundingClientRect();
    const scale = Math.min(r.width / startView.width, r.height / startView.height);
    view = {
      x: startView.x - (e.clientX - startX) / scale,
      y: startView.y - (e.clientY - startY) / scale,
      width: startView.width,
      height: startView.height,
    };
    apply();
  });
  const endPan = () => { panning = false; startView = null; host.classList.remove('panning'); };
  host.addEventListener('pointerup', endPan);
  host.addEventListener('pointercancel', endPan);
  host.addEventListener('dblclick', () => { view = Object.assign({}, base); apply(); });
  window.addEventListener('resize', drawGrid);
  apply();
</script>
</body>
</html>`;
}

/**
 * 型名を「宣言していたクラス（scope）」から解決し、そのクラス本文を返す resolver。
 * modelicaGraphics の継承解決（buildInheritedIconLayer など）へ渡す。
 * 解決結果はプロセス内でキャッシュする（MSL のような大きなライブラリでも
 * 同じ型を何度も読み直さない）。
 */
function makeClassTextResolver(
  rootMap: RootMap,
  fallbackScopes: string[] = []
): ClassTextResolver {
  const cache = new Map<string, { text: string; className: string } | null>();
  return (token, scopeClassName) => {
    const key = `${scopeClassName}\u0000${token}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    // scope 自身（ネストクラス参照）から外側パッケージへ向かって試し、最後に
    // 呼び出し元のフォールバック（ファイルの所属パッケージ）を見る。
    const segs = scopeClassName.split(".").filter(Boolean);
    const scopes: string[] = [];
    for (let i = segs.length; i >= 1; i--) scopes.push(segs.slice(0, i).join("."));
    for (const s of fallbackScopes) if (!scopes.includes(s)) scopes.push(s);
    const qname = resolveTypeName(token, scopes, rootMap);
    const src = qname ? symbols.readClassSource(qname, rootMap) : null;
    const result =
      src && qname ? { text: src.text, className: qname } : null;
    cache.set(key, result);
    return result;
  };
}

/**
 * コンポーネント型 1 つ分のアイコンを解決する。
 * base は extends を辿って合成した図形、ports はそのクラスの Icon に配置された
 * コネクタ（それぞれ自身のアイコンを解決済み）。どちらも空なら null。
 */
function resolveNodeIcon(
  typeName: string,
  scopeClassName: string,
  resolve: ClassTextResolver
): NodeIcon | null {
  const resolved = resolve(typeName, scopeClassName);
  if (!resolved) return null;
  const base = graphics.buildInheritedIconLayer(
    resolved.text,
    resolved.className,
    resolve
  );
  // input/output などのポート（コネクタ）を継承込みで集めて解決する。
  const ports: NodeIcon["ports"] = [];
  for (const { component, scope } of graphics.collectInheritedIconComponents(
    resolved.text,
    resolved.className,
    resolve
  )) {
    const portType = resolve(component.typeName, scope);
    if (!portType) continue;
    const icon: GraphicsLayer = graphics.buildInheritedIconLayer(
      portType.text,
      portType.className,
      resolve
    );
    if (icon.primitives.length) ports.push({ component, icon });
  }
  return base.primitives.length || ports.length ? { base, ports } : null;
}

async function showDiagram(target: ClassTarget | null): Promise<void> {
  if (!target) {
    vscode.window.showErrorMessage(
      "Modelica: 対象クラスを特定できません。Modelica ビューでモデルを選ぶか、.mo ファイルを開いてください。"
    );
    return;
  }
  const className = target.qname;
  if (target.kind === "package") {
    vscode.window.showInformationMessage(
      `Modelica: ${className} はパッケージです。Modelica ビューで中のモデル/ブロックを選んでください。`
    );
    return;
  }
  const layer = graphics.parseDiagramLayer(target.text);
  if (!layer.components.length && !layer.connections.length && !layer.primitives.length) {
    vscode.window.showInformationMessage(
      `Modelica: ${className || "このモデル"} に図示できるコンポーネント/接続がありません。`
    );
    return;
  }

  // 各コンポーネント型のアイコン（extends 継承・ポート込み）を解決する。
  const resolve = makeClassTextResolver(
    await getRootMap(),
    typeScopes(className, target.file)
  );
  const byType = new Map<string, NodeIcon | null>();
  const icons: IconMap = new Map();
  for (const component of layer.components) {
    const key = component.typeName;
    let node = byType.get(key);
    if (node === undefined) {
      node = resolveNodeIcon(key, className, resolve);
      byType.set(key, node);
    }
    icons.set(component.name, node);
  }

  const diagram = graphics.buildDiagramSvg(layer, icons);

  if (!diagramPanel) {
    diagramPanel = vscode.window.createWebviewPanel(
      "modelicaDiagram",
      "Modelica Diagram",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true }
    );
    diagramPanel.onDidDispose(() => {
      diagramPanel = undefined;
    });
  }
  diagramPanel.title = `Diagram: ${className || ""}`.trim();
  diagramPanel.webview.html = getDiagramHtml(
    diagramPanel.webview,
    className || "",
    diagram
  );
  diagramPanel.reveal(vscode.ViewColumn.Beside, true);
}

// =====================================================================
// annotation 非表示（折りたたみトグル）
// =====================================================================

const foldingRangeProvider: vscodeTypes.FoldingRangeProvider = {
  provideFoldingRanges(document) {
    return annotations
      .findAnnotationRanges(document.getText())
      .map(
        (r) =>
          new vscode.FoldingRange(
            r.startLine,
            r.endLine,
            vscode.FoldingRangeKind.Region
          )
      );
  },
};

async function toggleAnnotations(): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== "modelica") {
    vscode.window.showErrorMessage("Modelica ファイルを開いてください。");
    return;
  }
  const lines = annotations
    .findAnnotationRanges(ed.document.getText())
    .map((r) => r.startLine);
  if (!lines.length) {
    vscode.window.setStatusBarMessage(
      "Modelica: 折りたためる annotation がありません",
      3000
    );
    return;
  }
  const key = ed.document.uri.toString();
  if (annotationsHidden.has(key)) {
    annotationsHidden.delete(key);
    await vscode.commands.executeCommand("editor.unfold", {
      selectionLines: lines,
    });
    vscode.window.setStatusBarMessage("Modelica: annotation を表示", 3000);
  } else {
    annotationsHidden.add(key);
    await vscode.commands.executeCommand("editor.fold", {
      levels: 1,
      selectionLines: lines,
    });
    vscode.window.setStatusBarMessage("Modelica: annotation を非表示", 3000);
  }
}

// =====================================================================
// activate / deactivate
// =====================================================================

export function activate(context: vscodeTypes.ExtensionContext): void {
  extContext = context;
  const createCommands: Record<string, EntityKind> = {
    "modelica.newModel": "model",
    "modelica.newBlock": "block",
    "modelica.newRecord": "record",
    "modelica.newConnector": "connector",
    "modelica.newFunction": "function",
    "modelica.newType": "type",
    "modelica.newPackage": "package",
  };
  for (const [command, kind] of Object.entries(createCommands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (arg?: unknown) =>
        createEntity(kind, arg)
      )
    );
  }

  diagnostics = vscode.languages.createDiagnosticCollection("modelica");
  output = vscode.window.createOutputChannel("Modelica");
  context.subscriptions.push(diagnostics, output);

  // ① go-to-definition
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: "modelica" },
      definitionProvider
    )
  );
  // ② 補完
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "modelica" },
      completionProvider,
      "."
    )
  );
  // ③ リネーム
  context.subscriptions.push(
    vscode.languages.registerRenameProvider({ language: "modelica" }, renameProvider)
  );
  // Documentation 表示 / annotation 折りたたみ
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: "modelica" },
      foldingRangeProvider
    ),
    vscode.commands.registerCommand("modelica.showDocumentation", async (arg) =>
      showDocumentation(await classTargetForCommand(arg))
    ),
    vscode.commands.registerCommand("modelica.toggleAnnotations", () =>
      toggleAnnotations()
    ),
    vscode.commands.registerCommand("modelica.showDiagram", async (arg) =>
      showDiagram(await classTargetForCommand(arg))
    )
  );

  // Modelica Packages ツリー（Activity Bar）
  const treeProvider = new modelicaTree.ModelicaTreeProvider(getRootMap);
  packageTreeView = vscode.window.createTreeView<modelicaTree.ModelicaTreeNode>(
    "modelica.packageTree",
    { treeDataProvider: treeProvider, showCollapseAll: true }
  );
  context.subscriptions.push(
    treeProvider,
    packageTreeView,
    vscode.commands.registerCommand("modelica.packageTree.copyModelicaPath", (arg) =>
      copyModelicaPath(arg)
    ),
    vscode.commands.registerCommand("modelica.packageTree.copyFilePath", (arg) =>
      copyFilePath(arg)
    ),
    vscode.commands.registerCommand("modelica.packageTree.refresh", () => {
      rootMapCache = null;
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "modelica.packageTree.open",
      async (node: modelicaTree.ModelicaTreeNode) =>
        modelicaTree.openNode(node, await getRootMap())
    ),
    vscode.commands.registerCommand("modelica.packageTree.clearFocus", () =>
      modelicaTree.clearFocus()
    )
  );

  // package.mo の増減でライブラリルート表を無効化（ツリーの refresh とは別物）
  const pkgWatcher = vscode.workspace.createFileSystemWatcher("**/package.mo");
  const invalidateRootMap = () => {
    rootMapCache = null;
    treeProvider.refreshSoon();
  };
  pkgWatcher.onDidCreate(invalidateRootMap);
  pkgWatcher.onDidDelete(invalidateRootMap);
  context.subscriptions.push(pkgWatcher);

  // .mo の増減・編集（ファイル内ネストクラスの増減）でツリーを更新。
  // 増減は単一ファイルのルートも変えるためルート表ごと無効化する。
  const moWatcher = vscode.workspace.createFileSystemWatcher("**/*.mo");
  moWatcher.onDidCreate(invalidateRootMap);
  moWatcher.onDidDelete(invalidateRootMap);
  moWatcher.onDidChange(() => treeProvider.refreshSoon());
  context.subscriptions.push(moWatcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(invalidateRootMap)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("modelica.check", () =>
      runCheck(vscode.window.activeTextEditor?.document)
    ),
    vscode.commands.registerCommand("modelica.simulate", () =>
      openSimulationSetup(vscode.window.activeTextEditor?.document)
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "modelica" && getConfig().checkOnSave) {
        runCheck(doc);
      }
    })
  );
}

export function deactivate(): void {}

// 単体検証用に内部の純粋関数を公開
export const _internal = {
  isValidIdent,
  qualifiedName,
  renderTemplate,
  addToPackageOrder,
  updateParentOrder,
  classNameForFile,
  findLibraryRoot,
  sanitizeOptions,
  effectiveIntervals,
  cleanBuildDir,
};
