// Modelica アノテーション式の低レベル解析ヘルパー（依存なし・自己完結）。
// 数値配列・中括弧値の抽出、文字列アウェアなカッコ対応など、上位（icon/diagram）から使う。
//
// 文字取り出しに text[i] ではなく text.charAt(i) を使うのは、範囲外で undefined ではなく
// "" が返り、以降の比較・正規表現がそのまま成り立つため（noUncheckedIndexedAccess 対応）。

/** parseNumberArray の戻り値。数値か、その（ネスト可能な）配列。 */
export type NumArray = number | NumArray[];

/** Modelica の 2 次元点 {x, y}。 */
export type Point = [number, number];

/** Modelica の extent {{x1,y1},{x2,y2}}。 */
export type Extent = [Point, Point];

/** 色 {r,g,b}。 */
export type Rgb = [number, number, number];

/** 図面/アイコンの座標系（Modelica 座標）。 */
export interface CoordExtent {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** openIdx の '(' に対応する ')' の位置を返す（文字列リテラルを無視）。無ければ -1。 */
export function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text.charAt(i);
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** open で開く括弧（'(' か '{'）に対応する閉じ括弧位置を返す（文字列無視）。無ければ -1。 */
export function matchBracket(text: string, openIdx: number): number {
  const open = text.charAt(openIdx);
  const close =
    open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text.charAt(i);
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** "{{1,2},{3,4}}" のような Modelica 数値配列（ネスト可）をパースする。 */
export function parseNumberArray(s: string): NumArray {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
  };
  function val(): NumArray {
    ws();
    if (s.charAt(i) === "{") {
      i++;
      const arr: NumArray[] = [];
      ws();
      if (s.charAt(i) === "}") {
        i++;
        return arr;
      }
      while (i < s.length) {
        arr.push(val());
        ws();
        if (s.charAt(i) === ",") {
          i++;
          continue;
        }
        if (s.charAt(i) === "}") {
          i++;
          break;
        }
        break;
      }
      return arr;
    }
    let j = i;
    while (j < s.length && /[-+0-9.eE]/.test(s.charAt(j))) j++;
    const n = parseFloat(s.slice(i, j));
    i = j;
    return n;
  }
  return val();
}

/** str の "key = { … }" の中括弧値を（ネスト対応で）そのまま返す。無ければ null。 */
export function extractBraceValue(str: string, key: string): string | null {
  const m = new RegExp("\\b" + key + "\\s*=\\s*").exec(str);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (str.charAt(i) !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < str.length; i++) {
    if (str.charAt(i) === "{") depth++;
    else if (str.charAt(i) === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// =====================================================================
// NumArray から具体的な形への変換
// 上位（icon/diagram）で毎回 Array.isArray と要素の型を確かめずに済むようにする。
// =====================================================================

/** v が [number, number] なら Point として返す。違えば null。 */
export function toPoint(v: NumArray | undefined): Point | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return [x, y];
}

/** v が点の配列なら Point[] として返す（点でない要素は捨てる）。 */
export function toPoints(v: NumArray | undefined): Point[] {
  if (!Array.isArray(v)) return [];
  const out: Point[] = [];
  for (const e of v) {
    const p = toPoint(e);
    if (p) out.push(p);
  }
  return out;
}

/** v が {{x1,y1},{x2,y2}} なら Extent として返す。違えば null。 */
export function toExtent(v: NumArray | undefined): Extent | null {
  const pts = toPoints(v);
  if (pts.length < 2) return null;
  return [pts[0]!, pts[1]!];
}

/** v が {r,g,b} なら Rgb として返す。違えば def。 */
export function toRgb(v: NumArray | undefined, def: Rgb): Rgb {
  if (!Array.isArray(v) || v.length < 3) return def;
  const [r, g, b] = v;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return def;
  }
  return [r, g, b];
}
