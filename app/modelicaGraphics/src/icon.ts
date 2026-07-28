// Modelica の Icon 図形（graphics）の解析と SVG 描画。vscode/omc/Node 非依存。
// 対応プリミティブ: Line / Rectangle / Ellipse / Polygon / Text（EAST/MSL で使う 5 種）。
// 継承（extends）の収集は I/O が要るため呼び出し側が行い、各クラスの Icon を merge して渡す。

import { matchParen } from "./parse";
import type { CoordExtent, Point } from "./parse";

// =====================================================================
// アノテーション値の型
// =====================================================================

/** Modelica.Blocks.Types.Foo のような enum 参照。 */
export interface AnnEnum {
  enum: string;
}

/** Rectangle(...) のような record 呼び出し。 */
export interface AnnRecord {
  record: string;
  args: Record<string, AnnValue>;
  pos: AnnValue[];
}

/** アノテーション式の値。 */
export type AnnValue =
  | number
  | string
  | boolean
  | null
  | AnnEnum
  | AnnRecord
  | AnnValue[];

/** 解析済みの Icon。coord が null なら座標系の指定なし。 */
export interface IconDef {
  coord: CoordExtent | null;
  graphics: AnnRecord[];
}

/** ダイアグラム上でアイコンを写像する先の矩形（Modelica 図面座標）。 */
export interface IconBox {
  xlo: number;
  xhi: number;
  ylo: number;
  yhi: number;
}

/** Modelica 図面座標 → SVG 座標（Y 反転）への変換。 */
export type IconTransform = (x: number, y: number) => Point;

/** 描画時のコンテキスト（%name の展開に使う）。 */
export interface IconContext {
  name?: string;
}

const DEFAULT_COORD: CoordExtent = { xmin: -100, ymin: -100, xmax: 100, ymax: 100 };

// =====================================================================
// アノテーション値パーサ（records / 配列 / 文字列 / 真偽 / enum / 数値）
// =====================================================================

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s.charAt(i))) i++;
  return i;
}

function parseString(s: string, i: number): [string, number] {
  // s.charAt(i) === '"'
  i++;
  let out = "";
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === "\\") {
      const nx = s.charAt(i + 1);
      out += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
      i += 2;
      continue;
    }
    if (c === '"') {
      i++;
      break;
    }
    out += c;
    i++;
  }
  return [out, i];
}

function parseNumber(s: string, i: number): [number, number] {
  let j = i;
  if (s.charAt(j) === "+" || s.charAt(j) === "-") j++;
  while (j < s.length && /[0-9.eE]/.test(s.charAt(j))) {
    // 指数の符号
    const c = s.charAt(j);
    const nx = s.charAt(j + 1);
    if ((c === "e" || c === "E") && (nx === "+" || nx === "-")) j++;
    j++;
  }
  return [parseFloat(s.slice(i, j)), j];
}

function parseIdent(s: string, i: number): [string, number] {
  let j = i;
  while (j < s.length && /[A-Za-z0-9_.]/.test(s.charAt(j))) j++;
  return [s.slice(i, j), j];
}

function parseArray(s: string, i: number): [AnnValue[], number] {
  // s.charAt(i) === '{'
  i++;
  const arr: AnnValue[] = [];
  i = skipWs(s, i);
  if (s.charAt(i) === "}") return [arr, i + 1];
  while (i < s.length) {
    const [v, j] = parseValue(s, i);
    arr.push(v);
    i = skipWs(s, j);
    if (s.charAt(i) === ",") {
      i = skipWs(s, i + 1);
      continue;
    }
    if (s.charAt(i) === "}") {
      i++;
      break;
    }
    break;
  }
  return [arr, i];
}

interface ArgList {
  args: Record<string, AnnValue>;
  pos: AnnValue[];
}

function parseArgs(s: string, i: number): [ArgList, number] {
  // s.charAt(i) === '('
  i++;
  const args: Record<string, AnnValue> = {};
  const pos: AnnValue[] = [];
  i = skipWs(s, i);
  if (s.charAt(i) === ")") return [{ args, pos }, i + 1];
  while (i < s.length) {
    i = skipWs(s, i);
    // 名前付き引数の先読み: ident '='
    const save = i;
    const [id, j] = parseIdent(s, i);
    const k = skipWs(s, j);
    if (id && s.charAt(k) === "=" && s.charAt(k + 1) !== "=") {
      const [v, m] = parseValue(s, k + 1);
      args[id] = v;
      i = m;
    } else {
      const [v, m] = parseValue(s, save);
      pos.push(v);
      i = m;
    }
    i = skipWs(s, i);
    if (s.charAt(i) === ",") {
      i++;
      continue;
    }
    if (s.charAt(i) === ")") {
      i++;
      break;
    }
    break;
  }
  return [{ args, pos }, i];
}

export function parseValue(s: string, i: number): [AnnValue, number] {
  i = skipWs(s, i);
  if (i >= s.length) return [null, i];
  const c = s.charAt(i);
  if (c === "{") return parseArray(s, i);
  if (c === '"') return parseString(s, i);
  if (c === "-" || c === "+" || (c >= "0" && c <= "9") || c === ".") {
    return parseNumber(s, i);
  }
  if (/[A-Za-z_]/.test(c)) {
    const [name, j] = parseIdent(s, i);
    const k = skipWs(s, j);
    if (s.charAt(k) === "(") {
      const [{ args, pos }, m] = parseArgs(s, k);
      return [{ record: name, args, pos }, m];
    }
    if (name === "true") return [true, j];
    if (name === "false") return [false, j];
    return [{ enum: name }, j];
  }
  return [null, i + 1];
}

// =====================================================================
// Icon 抽出
// =====================================================================

/** classText からクラスレベルの Icon(...) の中身文字列を返す。無ければ null。 */
export function extractIconBody(classText: string): string | null {
  const m = /\bIcon\s*\(/.exec(classText);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchParen(classText, open);
  if (close < 0) return null;
  return classText.slice(open + 1, close);
}

/** AnnValue が [number, number] なら Point として返す。違えば null。 */
function pointOf(v: AnnValue | undefined): Point | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return [x, y];
}

/** AnnValue が点の配列なら Point[] として返す（点でない要素は捨てる）。 */
function pointsOf(v: AnnValue | undefined): Point[] {
  if (!Array.isArray(v)) return [];
  const out: Point[] = [];
  for (const e of v) {
    const p = pointOf(e);
    if (p) out.push(p);
  }
  return out;
}

/** coordinateSystem(extent=…) の座標範囲。無ければ既定 {-100,-100}-{100,100}。 */
export function iconCoordSystem(iconBody: string): CoordExtent {
  const m = /coordinateSystem\s*\(/.exec(iconBody);
  if (!m) return DEFAULT_COORD;
  const open = m.index + m[0].length - 1;
  const close = matchParen(iconBody, open);
  if (close < 0) return DEFAULT_COORD;
  const body = iconBody.slice(open + 1, close);
  const em = /\bextent\s*=\s*/.exec(body);
  if (!em) return DEFAULT_COORD;
  const [ext] = parseValue(body, em.index + em[0].length);
  const pts = pointsOf(ext);
  if (pts.length < 2) return DEFAULT_COORD;
  const [p1, p2] = pts as [Point, Point];
  const xs = [p1[0], p2[0]];
  const ys = [p1[1], p2[1]];
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

/** AnnValue が record 呼び出しか。 */
function isRecord(v: AnnValue): v is AnnRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "record" in v;
}

/** Icon の graphics プリミティブ配列を返す。 */
export function iconGraphics(iconBody: string): AnnRecord[] {
  const m = /\bgraphics\s*=\s*/.exec(iconBody);
  if (!m) return [];
  const [arr] = parseValue(iconBody, m.index + m[0].length);
  if (!Array.isArray(arr)) return [];
  return arr.filter(isRecord);
}

/** classText の Icon を {coord, graphics} で返す。Icon 無しなら null。 */
export function parseIcon(classText: string): IconDef | null {
  const body = extractIconBody(classText);
  if (body == null) return null;
  return { coord: iconCoordSystem(body), graphics: iconGraphics(body) };
}

/** extends の基底クラス名（ドット付き）一覧。 */
export function parseExtends(classText: string): string[] {
  const out: string[] = [];
  const re = /\bextends\s+([A-Za-z_][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(classText)) !== null) out.push(m[1]!);
  return out;
}

// =====================================================================
// SVG 描画
// =====================================================================

function num(v: AnnValue | undefined, def: number): number {
  return typeof v === "number" && isFinite(v) ? v : def;
}

function colorOf(v: AnnValue | undefined, def: string): string {
  if (Array.isArray(v) && v.length >= 3) {
    const [r, g, b] = v;
    if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    }
  }
  return def;
}

function isEnum(v: AnnValue | undefined, name: string): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  if (!("enum" in v)) return false;
  return String(v.enum).split(".").pop() === name;
}

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * merged icon（{coord, graphics}）を、ダイアグラム上のボックス box（Modelica 座標
 * {xlo,xhi,ylo,yhi}）へ写像して SVG 断片を返す。tf(x,y) は Modelica 図面座標→SVG 座標
 * （Y 反転）を行う関数。graphics が空なら null。
 */
export function renderIcon(
  icon: IconDef | null,
  box: IconBox,
  tf: IconTransform,
  ctx?: IconContext
): string | null {
  if (!icon || !icon.graphics || !icon.graphics.length) return null;
  const coord = icon.coord || DEFAULT_COORD;
  const iw = coord.xmax - coord.xmin || 1;
  const ih = coord.ymax - coord.ymin || 1;
  const bw = box.xhi - box.xlo;
  const bh = box.yhi - box.ylo;
  // icon 座標 (x,y) → 図面 Modelica 座標
  const mapX = (x: number) => box.xlo + ((x - coord.xmin) / iw) * bw;
  const mapY = (y: number) => box.ylo + ((y - coord.ymin) / ih) * bh;
  const P = (x: number, y: number) => tf(mapX(x), mapY(y));
  const parts: string[] = [];

  for (const g of icon.graphics) {
    const a: Record<string, AnnValue> = g.args || {};
    // プリミティブ固有の origin / rotation（ローカル座標 → icon 座標）
    const o = pointOf(a["origin"]) || [0, 0];
    const rot = num(a["rotation"], 0) * (Math.PI / 180);
    const cosr = Math.cos(rot);
    const sinr = Math.sin(rot);
    // AP: プリミティブのローカル点 (px,py) → SVG 座標
    const AP = (px: number, py: number) =>
      P(o[0] + px * cosr - py * sinr, o[1] + px * sinr + py * cosr);
    const line = colorOf(a["lineColor"], "rgb(0,0,0)");
    const filled = isEnum(a["fillPattern"], "Solid");
    const fill = filled ? colorOf(a["fillColor"], "none") : "none";
    const sw = num(a["lineThickness"], 0.25);
    switch (g.record) {
      case "Rectangle": {
        const ext = pointsOf(a["extent"]);
        if (ext.length < 2) break;
        const [p1, p2] = ext as [Point, Point];
        const c1 = AP(p1[0], p1[1]);
        const c2 = AP(p2[0], p2[1]);
        const x = Math.min(c1[0], c2[0]);
        const y = Math.min(c1[1], c2[1]);
        const w = Math.abs(c2[0] - c1[0]);
        const h = Math.abs(c2[1] - c1[1]);
        const r = num(a["radius"], 0);
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}"${
            r ? ` rx="${r}"` : ""
          } fill="${fill}" stroke="${line}" stroke-width="${sw}" />`
        );
        break;
      }
      case "Ellipse": {
        const ext = pointsOf(a["extent"]);
        if (ext.length < 2) break;
        const [p1, p2] = ext as [Point, Point];
        const c1 = AP(p1[0], p1[1]);
        const c2 = AP(p2[0], p2[1]);
        const cx = (c1[0] + c2[0]) / 2;
        const cy = (c1[1] + c2[1]) / 2;
        const rx = Math.abs(c2[0] - c1[0]) / 2;
        const ry = Math.abs(c2[1] - c1[1]) / 2;
        parts.push(
          `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${line}" stroke-width="${sw}" />`
        );
        break;
      }
      case "Polygon": {
        const points = pointsOf(a["points"]);
        if (!points.length) break;
        const pts = points.map((p) => AP(p[0], p[1]).join(",")).join(" ");
        parts.push(
          `<polygon points="${pts}" fill="${fill}" stroke="${line}" stroke-width="${sw}" />`
        );
        break;
      }
      case "Line": {
        const points = pointsOf(a["points"]);
        if (!points.length) break;
        const pts = points.map((p) => AP(p[0], p[1]).join(",")).join(" ");
        const lc = colorOf(a["color"], "rgb(0,0,0)");
        const lt = num(a["thickness"], 0.25);
        parts.push(
          `<polyline points="${pts}" fill="none" stroke="${lc}" stroke-width="${lt}" />`
        );
        break;
      }
      case "Text": {
        const ext = pointsOf(a["extent"]);
        if (ext.length < 2) break;
        const raw = a["textString"];
        let str = typeof raw === "string" ? raw : "";
        str = str.replace(/%name/g, (ctx && ctx.name) || "");
        if (!str) break;
        const [p1, p2] = ext as [Point, Point];
        const c1 = AP(p1[0], p1[1]);
        const c2 = AP(p2[0], p2[1]);
        const cx = (c1[0] + c2[0]) / 2;
        const cy = (c1[1] + c2[1]) / 2;
        let fs = num(a["fontSize"], 0);
        if (!fs) fs = Math.min(Math.abs(c2[1] - c1[1]) * 0.9, 8) || 4;
        const tc = colorOf(a["textColor"], colorOf(a["lineColor"], "rgb(0,0,255)"));
        parts.push(
          `<text x="${cx}" y="${cy}" font-size="${fs}" fill="${tc}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${esc(
            str
          )}</text>`
        );
        break;
      }
      default:
        break;
    }
  }
  return parts.length ? parts.join("") : null;
}
