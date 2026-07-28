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

/** ツリー/補完で区別する種別。 */
export type ClassKind = "package" | "class";

/** ルートパッケージ名 → ディレクトリ（構造化ライブラリ）または .mo ファイル（単一ファイル）。 */
export type RootMap = Record<string, string>;

/** ファイル内の定義位置。 */
export interface SymbolLocation {
  file: string;
  line: number;
  character: number;
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

/**
 * rootMap の値がディレクトリ（package.mo を持つ構造化ライブラリ）でなく
 * 単一ファイルのルート（package.mo に属さない最上位の .mo）を指すか。
 */
export function isFileRoot(rootPath: string | undefined): boolean {
  return /\.mo$/i.test(String(rootPath));
}

/** ルートパッケージ名の種別 "package" | "class"。 */
export function rootKind(rootMap: RootMap, rootName: string): ClassKind {
  const p = rootMap[rootName];
  if (!p || !isFileRoot(p)) return "package";
  try {
    const c = readPrimaryClass(fs.readFileSync(p, "utf8"));
    return c && c.kind === "package" ? "package" : "class";
  } catch (_) {
    return "class";
  }
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
  // 単一ファイルのルート: 以降のセグメントはすべてそのファイル内のネストクラス。
  if (isFileRoot(rootDir)) return declInFile(rootDir, segs[segs.length - 1]!);
  if (segs.length === 1) {
    return declInFile(path.join(rootDir, "package.mo"), segs[0]!);
  }
  const lastName = segs[segs.length - 1]!;
  let cur = rootDir;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    const asDir = path.join(cur, seg);
    const asFile = path.join(cur, seg + ".mo");
    if (last) {
      if (fs.existsSync(asFile)) return declInFile(asFile, seg);
      if (fs.existsSync(path.join(asDir, "package.mo")))
        return declInFile(path.join(asDir, "package.mo"), seg);
      return declInFile(path.join(cur, "package.mo"), seg);
    }
    if (fs.existsSync(path.join(asDir, "package.mo"))) {
      cur = asDir;
      continue;
    }
    if (fs.existsSync(asFile)) {
      // 残りセグメントは asFile 内のネストクラス。最終名で探す。
      return declInFile(asFile, lastName);
    }
    // 途中が解決できない → cur の package.mo 内のネストクラスとして最終名を探す
    return declInFile(path.join(cur, "package.mo"), lastName);
  }
  return null;
}

// =====================================================================
// 補完（② 入力予測）用の列挙・メンバー解決
// =====================================================================

/** クラス本体のコンポーネント/パラメータ宣言 [{name, type}] を集める。 */
export function parseComponents(text: string): Component[] {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(
    "^(\\s*(?:(?:" +
      DECL_PREFIX +
      ")\\s+)*)([A-Za-z_][\\w.]*)((?:\\s*\\[[^\\]]*\\])?)\\s+([A-Za-z_]\\w*)\\b"
  );
  const out: Component[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    if (NON_TYPE.has(m[2]!)) continue;
    out.push({ name: m[4]!, type: m[2]! });
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

/** extends のベースクラス名（ドット付き）一覧。 */
export function parseExtends(text: string): string[] {
  const out: string[] = [];
  const re = /\bextends\s+([A-Za-z_][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!);
  return out;
}

/** file 内で宣言されるクラス名一覧（外側クラス excludeName は除く）。 */
function listNestedClasses(text: string, excludeName: string): string[] {
  const blanked = blankCommentsAndStrings(text);
  const re = new RegExp(CLASS_HEAD, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked)) !== null) {
    if (m[2] !== excludeName && !CLASS_KW_SET.has(m[2]!)) out.push(m[2]!);
  }
  return out;
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
    // ルート自体がファイル。その中のネストクラスは更に辿れないため null。
    return segs.length === 1 ? { type: "file", path: rootDir } : null;
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
      // 残りセグメントがある = ファイル内ネストクラス。その下は辿れないので null。
      // （ここで file を返すと A.B.Nested がファイル A.B の中身を指してしまう）
      return i === segs.length - 1 ? { type: "file", path: asFile } : null;
    }
    return null;
  }
  return { type: "dir", path: cur };
}

/**
 * パッケージ/クラス修飾名の子（サブパッケージ・クラス）一覧 [{name, kind}] を返す。
 * kind: "package" | "class"。
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
        items.push({ name: e.name.slice(0, -3), kind: "class" });
      }
    }
    const pkgmo = path.join(c.path, "package.mo");
    if (fs.existsSync(pkgmo)) {
      const own = path.basename(c.path);
      for (const n of listNestedClasses(fs.readFileSync(pkgmo, "utf8"), own))
        items.push({ name: n, kind: "class" });
    }
  } else {
    const own = path.basename(c.path, ".mo");
    for (const n of listNestedClasses(fs.readFileSync(c.path, "utf8"), own))
      items.push({ name: n, kind: "class" });
  }
  const map = new Map<string, ChildItem>();
  for (const it of items) if (!map.has(it.name)) map.set(it.name, it);
  return [...map.values()];
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
