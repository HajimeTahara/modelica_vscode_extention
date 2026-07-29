// Modelica シンボル解決（自前・軽量・vscode 非依存）。
// go-to-definition（① 継承もと/変数宣言へのジャンプ）の中核。将来 ②補完/③リネームでも再利用する。
//
// 方針:
//  - クラス参照（ドット付き修飾名 A.B.C）は「ルートパッケージ名 → ディレクトリ」対応表をもとに
//    ディレクトリ/ファイルを辿って定義ファイルと行を求める。
//  - 変数/コンポーネント参照は現在ファイル内の宣言行を正規表現で探す。
//
// 注意: MSL はディレクトリ名 ModelicaStandardLibrary でも中のパッケージ名は Modelica。
//       ルート名はディレクトリ名でなく package.mo の宣言から読む。

import * as fs from "fs";
import * as path from "path";
import * as util from "./util";

/** ツリー/補完で区別する種別（Modelica のクラスキーワードそのもの）。 */
export type ClassKind =
  | "package"
  | "model"
  | "class"
  | "record"
  | "block"
  | "connector"
  | "type"
  | "function"
  | "operator";

/** ルートパッケージ名 → ディレクトリ（構造化ライブラリ）または .mo ファイル（単一ファイル）。 */
export type RootMap = Record<string, string>;

/** ファイル内の定義位置。 */
export interface SymbolLocation {
  file: string;
  line: number;
  character: number;
  /** 定義の最終行（クラスツリーから求まった場合のみ）。 */
  endLine?: number;
}

/** テキスト内の位置（0 始まり）。 */
export interface TextPosition {
  line: number;
  character: number;
}

/** クラス定義の見出し。 */
export interface PrimaryClass {
  kind: string;
  name: string;
}

/** コンポーネント/パラメータ宣言。 */
export interface Component {
  name: string;
  type: string;
}

/** 修飾名が指すコンテナ。 */
export interface Container {
  type: "dir" | "file";
  path: string;
  /** type==="file" のとき: そのファイルの主クラス名。 */
  own?: string;
  /** type==="file" のとき: 主クラスから下のネスト経路（空なら主クラス自身）。 */
  nested?: string[];
}

/** ファイル内のクラス定義ツリー（ネスト構造を保つ）。 */
export interface ClassNode {
  name: string;
  kind: ClassKind;
  /** クラスキーワードの開始オフセット。 */
  offset: number;
  /** 定義の終端オフセット（`end Name;` の直後、短縮形は `;` の直後）。 */
  endOffset: number;
  children: ClassNode[];
}

/** パッケージ/クラスの子。 */
export interface ChildItem {
  name: string;
  kind: ClassKind;
}

/** 識別子の出現範囲。 */
export interface Occurrence {
  start: number;
  end: number;
}

/** 主クラスの本体範囲。 */
export interface ClassSpan {
  start: number;
  end: number;
  name: string;
}

/** クラス定義の本文（1 ファイルに複数クラスがある場合の切り出し結果）。 */
export interface ClassSource {
  /** クラス単純名。 */
  name: string;
  kind: ClassKind;
  /** 定義本文（`model X … end X;` の範囲）。 */
  text: string;
}

/** ドット付き識別子とその範囲。 */
export interface DottedName {
  name: string;
  start: number;
  end: number;
}

const CLASS_KW =
  "model|class|record|block|connector|package|type|function|operator";

// クラス定義の見出し。`operator record Complex` / `operator function f` のように
// クラスキーワードが 2 語になる形を、名前として "record" を拾わずに扱う。
// group1 = 種別キーワード、group2 = クラス名。
const CLASS_HEAD = "\\b(?:operator\\s+)?(" + CLASS_KW + ")\\s+([A-Za-z_]\\w*)";

// 名前の位置にクラスキーワードが来た場合（`operator function '-'` 等、名前が引用符付き識別子）は
// クラス定義として拾わない。
const CLASS_KW_SET = new Set(CLASS_KW.split("|"));

const DECL_PREFIX =
  "final|inner|outer|replaceable|redeclare|parameter|constant|discrete|flow|stream|input|output|each";

// 宣言に見えても型ではないキーワード（誤検出除外用）
const NON_TYPE = new Set([
  "extends",
  "end",
  "connect",
  "annotation",
  "import",
  "within",
  "if",
  "for",
  "while",
  "when",
  "elseif",
  "else",
  "then",
  "loop",
  "equation",
  "algorithm",
  "public",
  "protected",
  "return",
  "break",
  // クラス定義キーワード（クラスヘッダ行を宣言と誤認しないため）
  "model",
  "class",
  "record",
  "block",
  "connector",
  "package",
  "type",
  "function",
  "operator",
  "partial",
  "expandable",
  "encapsulated",
  "pure",
  "impure",
  // 修飾子キーワードが型の位置に来るのは `final useHeatPort=true` のような
  // 修飾リストの継続行。宣言ではないので拾わない（本物の宣言から Placement を
  // 横取りしてしまう）。
  ...DECL_PREFIX.split("|"),
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * コメントと文字列リテラルを同じ長さの空白に置き換える（オフセットは保たれる）。
 * Documentation の英文（"… a package that …" 等）をクラス定義と誤検出しないため。
 */
function blankCommentsAndStrings(text: string): string {
  const n = text.length;
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = text.charAt(i);
    if (c === "/" && text.charAt(i + 1) === "/") {
      let j = i;
      while (j < n && text.charAt(j) !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && text.charAt(i + 1) === "*") {
      let j = i + 2;
      while (j < n && !(text.charAt(j) === "*" && text.charAt(j + 1) === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text.charAt(j) === "\\") {
          j += 2;
          continue;
        }
        if (text.charAt(j) === '"') {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join("");
}

function firstClassHead(text: string): PrimaryClass | null {
  const re = new RegExp(CLASS_HEAD, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!CLASS_KW_SET.has(m[2]!)) return { kind: m[1]!, name: m[2]! };
  }
  return null;
}

/** ファイル内の主クラス（最初のクラス定義）の {kind, name} を返す。無ければ null。 */
export function readPrimaryClass(text: string): PrimaryClass | null {
  // クラス定義はファイル先頭付近（within とヘッダコメントの直後）にあるため、
  // 大きなライブラリファイル全体を空白化せず頭だけ見る。見つからなければ全体で再試行。
  const head = blankCommentsAndStrings(text.slice(0, 20000));
  return firstClassHead(head) || firstClassHead(text);
}

/** ファイル内の主クラス名（最初のクラス定義の名前）を返す。無ければ null。 */
export function readPrimaryClassName(text: string): string | null {
  const c = readPrimaryClass(text);
  return c ? c.name : null;
}

// =====================================================================
// ファイル内クラスツリー（1 ファイルに階層をまるごと書く形式への対応）
//
// Modelica.Units のように package/class が 1 ファイルに入れ子で書かれる形式では、
// ファイル = クラス 1 個ではなく「ファイルの中に階層がある」。ここではクラス見出しと
// `end Name;` を対応付けてネスト構造を復元し、ツリー表示・定義ジャンプの土台にする。
// =====================================================================

// クラス見出し または `end Name;`。group1 = end の名前、group2/3 = 種別/クラス名。
const CLASS_TOKEN = "\\bend\\s+([A-Za-z_]\\w*)\\s*;|" + CLASS_HEAD;

/** クラスキーワード文字列を ClassKind に落とす（未知は "class"）。 */
export function normalizeKind(kw: string | undefined): ClassKind {
  return kw && CLASS_KW_SET.has(kw) ? (kw as ClassKind) : "class";
}

/**
 * pos 以降が短縮クラス定義（`type Angle = Real(...)` 等）かどうか。
 * 短縮形は `end Name;` を持たないため、ネストの入れ物として扱ってはいけない。
 */
function isShortClassDefinition(text: string, pos: number): boolean {
  let i = pos;
  const n = text.length;
  for (;;) {
    while (i < n && /\s/.test(text.charAt(i))) i++;
    // 配列添字 `type T[3] = ...` は読み飛ばして次を見る。
    if (text.charAt(i) === "[") {
      const close = text.indexOf("]", i);
      if (close < 0) return false;
      i = close + 1;
      continue;
    }
    return text.charAt(i) === "=";
  }
}

/** pos 以降で、括弧の外に出てくる最初の `;` の直後の位置（短縮クラス定義の終端）。 */
function statementEnd(text: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) return i + 1;
  }
  return text.length;
}

/**
 * text 内のクラス定義をネスト構造のまま返す（トップレベルの配列）。
 * コメント・文字列は空白化してから走査するため、Documentation 中の英文は拾わない。
 */
export function parseClassTree(text: string): ClassNode[] {
  const blanked = blankCommentsAndStrings(text);
  const re = new RegExp(CLASS_TOKEN, "g");
  const roots: ClassNode[] = [];
  const stack: ClassNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked)) !== null) {
    if (m[1]) {
      // `end Name;`: 対応する見出しまで閉じる（取りこぼしがあっても復帰できる）。
      // `end if;` 等はスタックに同名が無いため何も閉じない。
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === m[1]) {
          const endOffset = m.index + m[0].length;
          for (let k = i; k < stack.length; k++) stack[k]!.endOffset = endOffset;
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const kw = normalizeKind(m[2]!);
    let name = m[3]!;
    let bodyStart = m.index + m[0].length;
    if (CLASS_KW_SET.has(name)) continue;
    if (name === "extends") {
      // `redeclare function extends f(...) ... end f;` は extends の次が名前。
      const nm = /^\s*([A-Za-z_]\w*)/.exec(blanked.slice(bodyStart, bodyStart + 64));
      if (!nm) continue;
      name = nm[1]!;
      bodyStart += nm[0].length;
    }
    const node: ClassNode = {
      name,
      kind: kw,
      offset: m.index,
      endOffset: bodyStart,
      children: [],
    };
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    if (isShortClassDefinition(blanked, bodyStart)) {
      // 短縮形は `;` まで（複数行にまたがる `type X = Real(\n …);` も 1 定義として扱う）。
      node.endOffset = statementEnd(blanked, bodyStart);
    } else {
      // 終端は対応する `end Name;` を見つけた時点で埋める。
      stack.push(node);
    }
  }
  return roots;
}

/** parseClassTree の結果を mtime/size で使い回す（大きなライブラリファイル対策）。 */
interface TreeCacheEntry {
  mtimeMs: number;
  size: number;
  roots: ClassNode[];
}
const treeCache = new Map<string, TreeCacheEntry>();

/** file のクラスツリー。読めなければ空配列。 */
export function readClassTree(file: string): ClassNode[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (_) {
    return [];
  }
  const hit = treeCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.roots;
  let roots: ClassNode[];
  try {
    roots = parseClassTree(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return [];
  }
  treeCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, roots });
  return roots;
}

/** ファイルの主クラス（own 名に一致するもの、無ければ唯一のトップ）。 */
function topNode(roots: ClassNode[], own: string): ClassNode {
  const named = roots.find((n) => n.name === own);
  if (named) return named;
  if (roots.length === 1) return roots[0]!;
  // 主クラスが特定できないファイルは、トップレベル全部を own の子として扱う。
  return { name: own, kind: "package", offset: 0, endOffset: 0, children: roots };
}

/** nodes から名前経路をたどる。 */
function findNode(nodes: ClassNode[], segs: string[]): ClassNode | null {
  let list = nodes;
  let node: ClassNode | null = null;
  for (const s of segs) {
    const found = list.find((n) => n.name === s);
    if (!found) return null;
    node = found;
    list = found.children;
  }
  return node;
}

/** file 内の own（主クラス）から nested をたどったノード。 */
function nodeInFile(
  file: string,
  own: string,
  nested: string[]
): ClassNode | null {
  const roots = readClassTree(file);
  if (!roots.length) return null;
  const top = topNode(roots, own);
  return nested.length ? findNode(top.children, nested) : top;
}

/** file 内の own → nested のクラス定義位置。見つからなければ末尾名で緩く探す。 */
function declInFileNested(
  file: string,
  own: string,
  nested: string[]
): SymbolLocation | null {
  const node = nodeInFile(file, own, nested);
  if (!node) {
    const last = nested.length ? nested[nested.length - 1]! : own;
    return declInFile(file, last);
  }
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return null;
  }
  const pos = offsetToPosition(text, node.offset);
  const end = offsetToPosition(text, Math.max(node.offset, node.endOffset - 1));
  return {
    file,
    line: pos.line,
    character: pos.character,
    endLine: Math.max(pos.line, end.line),
  };
}

/** ファイル先頭 bytes バイトだけ読む（種別判定にファイル全体を読まないため）。 */
function readHead(file: string, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString("utf8", 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

const kindCache = new Map<string, { mtimeMs: number; kind: ClassKind }>();

/** .mo ファイルの主クラスの種別（package / model / type …）。読めなければ "class"。 */
export function fileClassKind(file: string): ClassKind {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch (_) {
    return "class";
  }
  const hit = kindCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.kind;
  let kind: ClassKind = "class";
  try {
    const c = readPrimaryClass(readHead(file, 16384));
    if (c) kind = normalizeKind(c.kind);
  } catch (_) {
    /* 読めなければ既定の "class" */
  }
  kindCache.set(file, { mtimeMs: st.mtimeMs, kind });
  return kind;
}

/**
 * rootMap の値がディレクトリ（package.mo を持つ構造化ライブラリ）でなく
 * 単一ファイルのルート（package.mo に属さない最上位の .mo）を指すか。
 */
export function isFileRoot(rootPath: string | undefined): boolean {
  return /\.mo$/i.test(String(rootPath));
}

/** ルートパッケージ名の種別。 */
export function rootKind(rootMap: RootMap, rootName: string): ClassKind {
  const p = rootMap[rootName];
  if (!p) return "package";
  return isFileRoot(p) ? fileClassKind(p) : "package";
}

/** offset 位置にあるドット付き識別子 {name, start, end} を返す。無ければ null。 */
export function dottedNameAt(text: string, offset: number): DottedName | null {
  if (offset < 0 || offset > text.length) return null;
  const isCh = (c: string) => c !== "" && /[A-Za-z0-9_.]/.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isCh(text.charAt(start - 1))) start--;
  while (end < text.length && isCh(text.charAt(end))) end++;
  let s = text.slice(start, end);
  while (s.startsWith(".")) {
    s = s.slice(1);
    start++;
  }
  while (s.endsWith(".")) {
    s = s.slice(0, -1);
    end--;
  }
  if (!s || !/^[A-Za-z_]/.test(s)) return null;
  return { name: s, start, end };
}

/** offset を {line, character}（0 始まり）に変換する。 */
export function offsetToPosition(text: string, offset: number): TextPosition {
  const pre = text.slice(0, offset);
  const line = (pre.match(/\n/g) || []).length;
  const character = offset - (pre.lastIndexOf("\n") + 1);
  return { line, character };
}

/** 現在ファイル内で name のコンポーネント/変数/パラメータ宣言行を探す。無ければ null。 */
export function findLocalDeclaration(
  text: string,
  name: string
): TextPosition | null {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(
    "^(\\s*(?:(?:" +
      DECL_PREFIX +
      ")\\s+)*)([A-Za-z_][\\w.]*)((?:\\s*\\[[^\\]]*\\])?)\\s+(" +
      escapeRegExp(name) +
      ")\\b"
  );
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    if (NON_TYPE.has(m[2]!)) continue;
    const character = m[0].length - name.length;
    return { line: i, character };
  }
  return null;
}

/** file 内の name のクラス定義位置 {file, line, character} を返す。定義が見つからなくても
 *  ファイルがあれば先頭を返す。ファイルが無ければ null。 */
export function declInFile(file: string, name: string): SymbolLocation | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return null;
  }
  const re = new RegExp("\\b(?:" + CLASS_KW + ")\\s+" + escapeRegExp(name) + "\\b");
  const idx = text.search(re);
  if (idx < 0) return { file, line: 0, character: 0 };
  const pos = offsetToPosition(text, idx);
  return { file, line: pos.line, character: pos.character };
}

/**
 * 修飾クラス名 qname を rootMap（{ルートパッケージ名: ディレクトリ}）で解決し
 * {file, line, character} を返す。無ければ null。
 */
export function resolveClass(
  qname: string,
  rootMap: RootMap
): SymbolLocation | null {
  const segs = String(qname).split(".").filter(Boolean);
  if (!segs.length) return null;
  const rootDir = rootMap[segs[0]!];
  if (!rootDir) return null;
  // 単一ファイルのルート: 以降のセグメントはすべてそのファイル内のネスト経路。
  if (isFileRoot(rootDir))
    return declInFileNested(rootDir, segs[0]!, segs.slice(1));
  if (segs.length === 1) {
    return declInFileNested(path.join(rootDir, "package.mo"), segs[0]!, []);
  }
  let cur = rootDir;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    const asDir = path.join(cur, seg);
    const asFile = path.join(cur, seg + ".mo");
    if (last) {
      if (fs.existsSync(asFile)) return declInFileNested(asFile, seg, []);
      if (fs.existsSync(path.join(asDir, "package.mo")))
        return declInFileNested(path.join(asDir, "package.mo"), seg, []);
      // cur/package.mo の中に書かれたネストクラス。
      return declInFileNested(
        path.join(cur, "package.mo"),
        path.basename(cur),
        [seg]
      );
    }
    if (fs.existsSync(path.join(asDir, "package.mo"))) {
      cur = asDir;
      continue;
    }
    if (fs.existsSync(asFile)) {
      // 残りセグメントは asFile 内のネスト経路。
      return declInFileNested(asFile, seg, segs.slice(i + 1));
    }
    // 途中が解決できない → cur の package.mo 内のネスト経路として辿る。
    return declInFileNested(
      path.join(cur, "package.mo"),
      path.basename(cur),
      segs.slice(i)
    );
  }
  return null;
}

// =====================================================================
// 補完（② 入力予測）用の列挙・メンバー解決
// =====================================================================

/** 括弧の外の `;` で文に分ける（コメント・文字列は空白化済みであること）。 */
function splitStatements(blanked: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < blanked.length; i++) {
    const c = blanked.charAt(i);
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) {
      out.push(blanked.slice(start, i));
      start = i + 1;
    }
  }
  if (start < blanked.length) out.push(blanked.slice(start));
  return out;
}

// 文の先頭に付きうる見出し（`;` で終わらないためひとつ前の文にくっつく）。
// クラス見出し `model Foo` / セクション `equation`,`protected` / `end Foo`。
const STATEMENT_HEAD = new RegExp(
  "^\\s*(?:(?:partial|encapsulated|operator|expandable|pure|impure)\\s+)*(?:" +
    CLASS_KW +
    ")\\s+[A-Za-z_]\\w*" +
    "|^\\s*(?:public|protected|initial\\s+equation|initial\\s+algorithm|equation|algorithm)\\b" +
    "|^\\s*end\\s+[A-Za-z_]\\w*"
);

// 文の先頭にある宣言 `<修飾子>* 型 [配列] 名前`。group1 = 型、group2 = 名前。
const DECLARATION = new RegExp(
  "^\\s*(?:(?:" +
    DECL_PREFIX +
    ")\\s+)*([A-Za-z_][\\w.]*)(?:\\s*\\[[^\\]]*\\])?\\s+([A-Za-z_]\\w*)\\b"
);

/**
 * クラス本体のコンポーネント/パラメータ宣言 [{name, type}] を集める。
 *
 * 行単位ではなく**文単位**（括弧の外の `;` 区切り）で見る。MSL には
 * `Modelica.Blocks.Interfaces.RealInput` ↵ `u annotation(…)` のように型と名前が
 * 別行の宣言があり、行単位ではこれを取りこぼす。また修飾子リストの継続行
 * （`final useHeatPort=true`）は文の先頭に来ないため誤検出しなくなる。
 * Documentation の英文を拾わないよう、コメント・文字列は空白化してから走査する。
 */
export function parseComponents(text: string): Component[] {
  const out: Component[] = [];
  for (const raw of splitStatements(blankCommentsAndStrings(text))) {
    // 直前の文にくっついた見出しを剥がしてから、文の先頭を宣言として読む。
    let st = raw;
    for (;;) {
      const h = STATEMENT_HEAD.exec(st);
      if (!h || !h[0].length) break;
      st = st.slice(h[0].length);
    }
    const m = DECLARATION.exec(st);
    if (!m) continue;
    if (NON_TYPE.has(m[1]!)) continue;
    out.push({ name: m[2]!, type: m[1]! });
  }
  return out;
}

/** text から className のクラス本体（<kw> Name … end Name;）だけを取り出す。
 *  複数クラスを含むファイル（MSL の Icons.mo 等）で無関係クラスを混入させないため。 */
export function extractClassBody(text: string, className: string): string {
  const start = text.search(
    new RegExp("\\b(?:" + CLASS_KW + ")\\s+" + escapeRegExp(className) + "\\b")
  );
  if (start < 0) return text;
  const rest = text.slice(start);
  const m = new RegExp("\\bend\\s+" + escapeRegExp(className) + "\\s*;").exec(rest);
  return m ? rest.slice(0, m.index) : rest;
}

/** クラスツリーから name のクラスを幅優先で探す（トップレベル優先）。 */
function findNodeByName(roots: ClassNode[], name: string): ClassNode | null {
  const queue = [...roots];
  while (queue.length) {
    const n = queue.shift()!;
    if (n.name === name) return n;
    queue.push(...n.children);
  }
  return null;
}

/** ClassNode をそのクラスの定義本文つきで返す。endOffset 未確定なら全文扱い。 */
function sourceOfNode(text: string, node: ClassNode): ClassSource {
  return {
    name: node.name,
    kind: node.kind,
    text:
      node.endOffset > node.offset
        ? text.slice(node.offset, node.endOffset)
        : text,
  };
}

/**
 * text 内で offset を含む最も内側のクラス定義を返す。
 * どのクラスにも入っていない位置（within 行など）なら最初のトップレベルクラス。
 * クラスが 1 つも無ければ null。
 */
export function classSourceAt(
  text: string,
  offset: number
): (ClassSource & { path: string[] }) | null {
  const roots = parseClassTree(text);
  if (!roots.length) return null;
  const path_: string[] = [];
  let node: ClassNode | null = null;
  let list = roots;
  for (;;) {
    const hit = list.find((n) => offset >= n.offset && offset < n.endOffset);
    if (!hit) break;
    node = hit;
    path_.push(hit.name);
    list = hit.children;
  }
  if (!node) {
    node = roots[0]!;
    path_.push(node.name);
  }
  return { ...sourceOfNode(text, node), path: path_ };
}

/** file 内のクラス name（ネスト含む）の定義本文。無ければ null。 */
export function readClassSourceInFile(
  file: string,
  name: string
): ClassSource | null {
  const node = findNodeByName(readClassTree(file), name);
  if (!node) return null;
  try {
    return sourceOfNode(fs.readFileSync(file, "utf8"), node);
  } catch (_) {
    return null;
  }
}

/** extends のベースクラス名（ドット付き）一覧。 */
export function parseExtends(text: string): string[] {
  const out: string[] = [];
  const re = /\bextends\s+([A-Za-z_][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!);
  return out;
}

/**
 * file の own（主クラス）から nested をたどった位置の「直下の」クラス一覧。
 * ネスト構造を保つので、Units.mo のように 1 ファイルに階層をまるごと書いた形式でも
 * 孫クラスが同じ階層に並んでしまうことがない。
 */
function childrenInFile(
  file: string,
  own: string,
  nested: string[]
): ChildItem[] {
  const node = nodeInFile(file, own, nested);
  if (!node) return [];
  return node.children.map((n) => ({ name: n.name, kind: n.kind }));
}

/**
 * クラス className（file 内）のメンバー（コンポーネント/パラメータ）を extends を辿って集める。
 * [{name, type}]。depth は継承をたどる深さ。対象クラス本体のみを走査する。
 */
export function listClassMembers(
  file: string,
  className: string,
  rootMap: RootMap,
  depth: number,
  seen?: Set<string>
): Component[] {
  const visited = seen || new Set<string>();
  const key = file + "::" + className;
  if (visited.has(key)) return [];
  visited.add(key);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return [];
  }
  const body = extractClassBody(text, className);
  const members = parseComponents(body);
  if (depth > 0) {
    const dir = path.dirname(file);
    for (const base of parseExtends(body)) {
      let bi = resolveClass(base, rootMap);
      if (!bi) {
        const q = util.qualifiedName(dir);
        if (q) bi = resolveClass(q + "." + base, rootMap);
      }
      if (bi && bi.file) {
        const baseName = base.split(".").pop()!;
        for (const m of listClassMembers(
          bi.file,
          baseName,
          rootMap,
          depth - 1,
          visited
        )) {
          members.push(m);
        }
      }
    }
  }
  const map = new Map<string, Component>();
  for (const m of members) if (!map.has(m.name)) map.set(m.name, m);
  return [...map.values()];
}

/** 修飾名が指すコンテナ（ディレクトリ=パッケージ / ファイル=クラス）を返す。無ければ null。 */
export function resolveContainer(
  qname: string,
  rootMap: RootMap
): Container | null {
  const segs = String(qname).split(".").filter(Boolean);
  if (!segs.length) return null;
  const rootDir = rootMap[segs[0]!];
  if (!rootDir) return null;
  if (isFileRoot(rootDir)) {
    // ルート自体がファイル。以降のセグメントはファイル内のネスト経路。
    return {
      type: "file",
      path: rootDir,
      own: segs[0]!,
      nested: segs.slice(1),
    };
  }
  let cur = rootDir;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]!;
    const asDir = path.join(cur, seg);
    const asFile = path.join(cur, seg + ".mo");
    if (fs.existsSync(path.join(asDir, "package.mo"))) {
      cur = asDir;
      continue;
    }
    if (fs.existsSync(asFile)) {
      // 残りセグメントは asFile 内のネスト経路（Units.mo 形式）。
      return {
        type: "file",
        path: asFile,
        own: seg,
        nested: segs.slice(i + 1),
      };
    }
    // ディレクトリにもファイルにも無い → cur/package.mo 内に書かれたネストクラス。
    const pkgmo = path.join(cur, "package.mo");
    if (!fs.existsSync(pkgmo)) return null;
    return {
      type: "file",
      path: pkgmo,
      own: path.basename(cur),
      nested: segs.slice(i),
    };
  }
  return { type: "dir", path: cur };
}

/** 修飾名 → 定義ファイルとファイル内経路（クラスが実在するかは見ない）。 */
function fileRefOf(
  qname: string,
  rootMap: RootMap
): { file: string; own: string; nested: string[] } | null {
  const c = resolveContainer(qname, rootMap);
  if (!c) return null;
  // ディレクトリパッケージの実体は package.mo の主クラス。
  if (c.type === "dir")
    return {
      file: path.join(c.path, "package.mo"),
      own: path.basename(c.path),
      nested: [],
    };
  return { file: c.path, own: c.own || "", nested: c.nested || [] };
}

/** qname のクラスが実在するか（本文は読まない＝クラスツリーのキャッシュだけで判定）。 */
export function classExists(qname: string, rootMap: RootMap): boolean {
  const ref = fileRefOf(qname, rootMap);
  return !!ref && !!nodeInFile(ref.file, ref.own, ref.nested);
}

/**
 * qname のクラス定義本文だけを切り出して返す。実在しなければ null。
 * package.mo のように 1 ファイルへ複数クラスを書いた形式でも、対象クラスの範囲だけを返す。
 */
export function readClassSource(
  qname: string,
  rootMap: RootMap
): (ClassSource & { file: string }) | null {
  const ref = fileRefOf(qname, rootMap);
  if (!ref) return null;
  const node = nodeInFile(ref.file, ref.own, ref.nested);
  if (!node) return null;
  try {
    const text = fs.readFileSync(ref.file, "utf8");
    return { file: ref.file, ...sourceOfNode(text, node) };
  } catch (_) {
    return null;
  }
}

/** dir/package.order に書かれた並び順。無ければ null。 */
export function readPackageOrder(dir: string): string[] | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, "package.order"), "utf8");
  } catch (_) {
    return null;
  }
  const names = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return names.length ? names : null;
}

/** package.order の順に並べる。載っていないものは後ろへ名前順で置く。 */
function applyPackageOrder(items: ChildItem[], order: string[]): ChildItem[] {
  const rank = new Map<string, number>();
  order.forEach((n, i) => {
    if (!rank.has(n)) rank.set(n, i);
  });
  const listed: ChildItem[] = [];
  const rest: ChildItem[] = [];
  for (const it of items) (rank.has(it.name) ? listed : rest).push(it);
  listed.sort((a, b) => rank.get(a.name)! - rank.get(b.name)!);
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [...listed, ...rest];
}

/**
 * パッケージ/クラス修飾名の子（サブパッケージ・クラス）一覧 [{name, kind}] を返す。
 *
 * 並び順:
 *  - ディレクトリパッケージ … `package.order` の順。載っていないものは後ろに名前順。
 *    `package.order` が無ければ名前順。
 *  - 1 ファイル内のクラス   … そのファイルで**定義されている順**。
 */
export function listPackageChildren(
  qname: string,
  rootMap: RootMap
): ChildItem[] {
  const c = resolveContainer(qname, rootMap);
  if (!c) return [];
  const items: ChildItem[] = [];
  if (c.type === "dir") {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(c.path, { withFileTypes: true });
    } catch (_) {
      return [];
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (fs.existsSync(path.join(c.path, e.name, "package.mo")))
          items.push({ name: e.name, kind: "package" });
      } else if (e.isFile() && e.name.endsWith(".mo") && e.name !== "package.mo") {
        const file = path.join(c.path, e.name);
        items.push({ name: e.name.slice(0, -3), kind: fileClassKind(file) });
      }
    }
    const pkgmo = path.join(c.path, "package.mo");
    if (fs.existsSync(pkgmo))
      for (const it of childrenInFile(pkgmo, path.basename(c.path), []))
        items.push(it);
  } else {
    const own = c.own || path.basename(c.path, ".mo");
    for (const it of childrenInFile(c.path, own, c.nested || [])) items.push(it);
  }
  const map = new Map<string, ChildItem>();
  for (const it of items) if (!map.has(it.name)) map.set(it.name, it);
  const uniq = [...map.values()];
  // ファイル内のクラスは定義順（parseClassTree の順）をそのまま活かす。
  if (c.type !== "dir") return uniq;
  const order = readPackageOrder(c.path);
  return order
    ? applyPackageOrder(uniq, order)
    : uniq.sort((a, b) => a.name.localeCompare(b.name));
}

// =====================================================================
// リネーム（③ 一括変換）用
// =====================================================================

/**
 * text 内の識別子 name の出現箇所 [{start, end}] を返す。
 * 文字列・行/ブロックコメントは除外。直前が '.' の参照（他オブジェクトのメンバー）も除外。
 */
export function findIdentifierOccurrences(
  text: string,
  name: string
): Occurrence[] {
  const occ: Occurrence[] = [];
  const n = text.length;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < n) {
    const c = text.charAt(i);
    if (c === "/" && text.charAt(i + 1) === "/") {
      i += 2;
      while (i < n && text.charAt(i) !== "\n") i++;
      continue;
    }
    if (c === "/" && text.charAt(i + 1) === "*") {
      i += 2;
      while (i < n && !(text.charAt(i) === "*" && text.charAt(i + 1) === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (text.charAt(i) === "\\") {
          i += 2;
          continue;
        }
        if (text.charAt(i) === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (isIdStart(c)) {
      const start = i;
      i++;
      while (i < n && isId(text.charAt(i))) i++;
      if (text.slice(start, i) === name) {
        let p = start - 1;
        while (p >= 0 && /\s/.test(text.charAt(p))) p--;
        if (!(p >= 0 && text.charAt(p) === ".")) occ.push({ start, end: i });
      }
      continue;
    }
    i++;
  }
  return occ;
}

/** 主クラスの本体範囲 {start, end, name}（クラス定義〜 end Name;）。無ければ null。 */
export function primaryClassSpan(text: string): ClassSpan | null {
  const name = readPrimaryClassName(text);
  if (!name) return null;
  const start = text.search(
    new RegExp("\\b(?:" + CLASS_KW + ")\\s+" + escapeRegExp(name) + "\\b")
  );
  if (start < 0) return null;
  const m = new RegExp("\\bend\\s+" + escapeRegExp(name) + "\\s*;").exec(
    text.slice(start)
  );
  const end = m ? start + m.index + m[0].length : text.length;
  return { start, end, name };
}
