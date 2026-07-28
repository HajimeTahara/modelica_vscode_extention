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

const fs = require("fs");
const path = require("path");
const util = require("./util");

const CLASS_KW =
  "model|class|record|block|connector|package|type|function|operator";

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ファイル内の主クラス名（最初のクラス定義の名前）を返す。無ければ null。 */
function readPrimaryClassName(text) {
  const m = new RegExp("\\b(?:" + CLASS_KW + ")\\s+([A-Za-z_]\\w*)").exec(text);
  return m ? m[1] : null;
}

/** offset 位置にあるドット付き識別子 {name, start, end} を返す。無ければ null。 */
function dottedNameAt(text, offset) {
  if (offset < 0 || offset > text.length) return null;
  const isCh = (c) => c !== undefined && /[A-Za-z0-9_.]/.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isCh(text[start - 1])) start--;
  while (end < text.length && isCh(text[end])) end++;
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
function offsetToPosition(text, offset) {
  const pre = text.slice(0, offset);
  const line = (pre.match(/\n/g) || []).length;
  const character = offset - (pre.lastIndexOf("\n") + 1);
  return { line, character };
}

/** 現在ファイル内で name のコンポーネント/変数/パラメータ宣言行を探す。無ければ null。 */
function findLocalDeclaration(text, name) {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(
    "^(\\s*(?:(?:" +
      DECL_PREFIX +
      ")\\s+)*)([A-Za-z_][\\w.]*)((?:\\s*\\[[^\\]]*\\])?)\\s+(" +
      escapeRegExp(name) +
      ")\\b"
  );
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    if (NON_TYPE.has(m[2])) continue;
    const character = m[0].length - name.length;
    return { line: i, character };
  }
  return null;
}

/** file 内の name のクラス定義位置 {file, line, character} を返す。定義が見つからなくても
 *  ファイルがあれば先頭を返す。ファイルが無ければ null。 */
function declInFile(file, name) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return null;
  }
  const re = new RegExp(
    "\\b(?:" + CLASS_KW + ")\\s+" + escapeRegExp(name) + "\\b"
  );
  const idx = text.search(re);
  if (idx < 0) return { file, line: 0, character: 0 };
  const pos = offsetToPosition(text, idx);
  return { file, line: pos.line, character: pos.character };
}

/**
 * 修飾クラス名 qname を rootMap（{ルートパッケージ名: ディレクトリ}）で解決し
 * {file, line, character} を返す。無ければ null。
 */
function resolveClass(qname, rootMap) {
  const segs = String(qname).split(".").filter(Boolean);
  if (!segs.length) return null;
  const rootDir = rootMap[segs[0]];
  if (!rootDir) return null;
  if (segs.length === 1) {
    return declInFile(path.join(rootDir, "package.mo"), segs[0]);
  }
  const lastName = segs[segs.length - 1];
  let cur = rootDir;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
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
function parseComponents(text) {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(
    "^(\\s*(?:(?:" +
      DECL_PREFIX +
      ")\\s+)*)([A-Za-z_][\\w.]*)((?:\\s*\\[[^\\]]*\\])?)\\s+([A-Za-z_]\\w*)\\b"
  );
  const out = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    if (NON_TYPE.has(m[2])) continue;
    out.push({ name: m[4], type: m[2] });
  }
  return out;
}

/** text から className のクラス本体（<kw> Name … end Name;）だけを取り出す。
 *  複数クラスを含むファイル（MSL の Icons.mo 等）で無関係クラスを混入させないため。 */
function extractClassBody(text, className) {
  const start = text.search(
    new RegExp("\\b(?:" + CLASS_KW + ")\\s+" + escapeRegExp(className) + "\\b")
  );
  if (start < 0) return text;
  const rest = text.slice(start);
  const m = new RegExp("\\bend\\s+" + escapeRegExp(className) + "\\s*;").exec(
    rest
  );
  return m ? rest.slice(0, m.index) : rest;
}

/** extends のベースクラス名（ドット付き）一覧。 */
function parseExtends(text) {
  const out = [];
  const re = /\bextends\s+([A-Za-z_][\w.]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** file 内で宣言されるクラス名一覧（外側クラス excludeName は除く）。 */
function listNestedClasses(text, excludeName) {
  const re = new RegExp("\\b(?:" + CLASS_KW + ")\\s+([A-Za-z_]\\w*)", "g");
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== excludeName) out.push(m[1]);
  }
  return out;
}

/**
 * クラス className（file 内）のメンバー（コンポーネント/パラメータ）を extends を辿って集める。
 * [{name, type}]。depth は継承をたどる深さ。対象クラス本体のみを走査する。
 */
function listClassMembers(file, className, rootMap, depth, seen) {
  seen = seen || new Set();
  const key = file + "::" + className;
  if (seen.has(key)) return [];
  seen.add(key);
  let text;
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
        const baseName = base.split(".").pop();
        for (const m of listClassMembers(
          bi.file,
          baseName,
          rootMap,
          depth - 1,
          seen
        )) {
          members.push(m);
        }
      }
    }
  }
  const map = new Map();
  for (const m of members) if (!map.has(m.name)) map.set(m.name, m);
  return [...map.values()];
}

/** 修飾名が指すコンテナ（ディレクトリ=パッケージ / ファイル=クラス）を返す。無ければ null。 */
function resolveContainer(qname, rootMap) {
  const segs = String(qname).split(".").filter(Boolean);
  if (!segs.length) return null;
  const rootDir = rootMap[segs[0]];
  if (!rootDir) return null;
  let cur = rootDir;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
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
function listPackageChildren(qname, rootMap) {
  const c = resolveContainer(qname, rootMap);
  if (!c) return [];
  const items = [];
  if (c.type === "dir") {
    let entries;
    try {
      entries = fs.readdirSync(c.path, { withFileTypes: true });
    } catch (_) {
      return [];
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (fs.existsSync(path.join(c.path, e.name, "package.mo")))
          items.push({ name: e.name, kind: "package" });
      } else if (
        e.isFile() &&
        e.name.endsWith(".mo") &&
        e.name !== "package.mo"
      ) {
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
  const map = new Map();
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
function findIdentifierOccurrences(text, name) {
  const occ = [];
  const n = text.length;
  const isIdStart = (c) => /[A-Za-z_]/.test(c);
  const isId = (c) => /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
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
      while (i < n && isId(text[i])) i++;
      if (text.slice(start, i) === name) {
        let p = start - 1;
        while (p >= 0 && /\s/.test(text[p])) p--;
        if (!(p >= 0 && text[p] === ".")) occ.push({ start, end: i });
      }
      continue;
    }
    i++;
  }
  return occ;
}

/** 主クラスの本体範囲 {start, end, name}（クラス定義〜 end Name;）。無ければ null。 */
function primaryClassSpan(text) {
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

module.exports = {
  readPrimaryClassName,
  dottedNameAt,
  offsetToPosition,
  findLocalDeclaration,
  declInFile,
  resolveClass,
  parseComponents,
  parseExtends,
  listClassMembers,
  resolveContainer,
  listPackageChildren,
  findIdentifierOccurrences,
  primaryClassSpan,
  extractClassBody,
};
