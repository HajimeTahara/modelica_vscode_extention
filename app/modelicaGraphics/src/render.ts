// GraphicPrimitive / DiagramLayer を SVG 文字列へ描画する。React 非依存・DOM 非依存。
//
// 参照実装: Orbis app/src/features/modelica-browser/components/graphics-primitives.tsx
//           および同 ModelicaGraphicsView.tsx の DiagramSvg。
//
// 座標系は Modelica のワールド座標（Y 上向き正）で扱い、最外の <g transform="scale(1 -1)">
// で SVG 座標（Y 下向き）へ落とす。テキストだけは反転を打ち消して常に正立させる。

import { DEFAULT_EXTENT } from "./types";
import type {
  DiagramComponent,
  DiagramLayer,
  Extent,
  FillPattern,
  GraphicPrimitive,
  GraphicsLayer,
  LinePattern,
  Vec2,
} from "./types";

/** 選択・ラベル等のアクセント色（Orbis と同じ）。 */
export const SELECT_COLOR = "rgb(24,124,137)";

/** コンポーネント名 → 解決済みアイコン（base = 継承込みの図形、ports = 配置コネクタ）。 */
export interface NodeIcon {
  base: GraphicsLayer;
  ports: { component: DiagramComponent; icon: GraphicsLayer }[];
}

/** コンポーネント名 → NodeIcon（null = アイコン無し／未解決）。 */
export type IconMap = Map<string, NodeIcon | null>;

/** buildDiagramSvg の描画オプション。 */
export interface DiagramSvgOptions {
  /** キャンバス（座標系 extent）の外に出た要素まで表示範囲を広げる。既定 true。 */
  expandToContent?: boolean;
  /** キャンバス矩形の塗り。 */
  canvasFill?: string;
  /** キャンバス矩形の枠線。 */
  canvasStroke?: string;
}

// ---------------------------------------------------------------------------
// 汎用ヘルパ
// ---------------------------------------------------------------------------

/** SVG のテキスト/属性へ埋め込むためのエスケープ。 */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 数値を SVG 属性向けに丸める（冗長な桁を落とす）。 */
function n(value: number): string {
  if (!isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

/** extent を左下原点の矩形（x, y, w, h）と中心へ正規化する。 */
export function normalizeExtent(extent: Extent): {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  const [[ax, ay], [bx, by]] = extent;
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  const w = Math.abs(bx - ax);
  const h = Math.abs(by - ay);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export function pointsToPath(points: Vec2[]): string {
  return points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
}

/**
 * smooth=Smooth.Bezier の線/多角形を Catmull-Rom スプラインで滑らかに描く
 * SVG パス（三次ベジェ列）を生成する。closed=true は多角形（端点を巡回）。
 */
export function smoothPath(points: Vec2[], closed: boolean): string {
  const len = points.length;
  if (len < 3) {
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n(x)},${n(y)}`).join(" ");
    return closed && len >= 2 ? `${d} Z` : d;
  }
  const at = (i: number): Vec2 => {
    const idx = closed ? ((i % len) + len) % len : Math.max(0, Math.min(len - 1, i));
    return points[idx] ?? [0, 0];
  };
  const first = points[0] ?? [0, 0];
  let d = `M${n(first[0])},${n(first[1])}`;
  const segments = closed ? len : len - 1;
  for (let i = 0; i < segments; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(p2[0])},${n(p2[1])}`;
  }
  if (closed) d += " Z";
  return d;
}

/** 線の太さ（Modelica 単位）を見かけの px 幅へ。0.25 が既定＝1px。 */
export function strokeWidthPx(thickness: number): number {
  return Math.max(thickness / 0.25, 1);
}

function lineStroke(color: string | null, pattern: LinePattern): string {
  return pattern === "None" || !color ? "none" : color;
}

function lineDashArray(pattern: LinePattern): string | null {
  switch (pattern) {
    case "Dash":
      return "8 5";
    case "Dot":
      return "1 4";
    case "DashDot":
      return "8 4 1 4";
    case "DashDotDot":
      return "8 4 1 4 1 4";
    default:
      return null;
  }
}

function dashAttr(pattern: LinePattern): string {
  const dash = lineDashArray(pattern);
  return dash ? ` stroke-dasharray="${dash}"` : "";
}

/** "rgb(r, g, b)" を成分へ分解する（解釈できなければ null）。 */
function rgbParts(color: string | null): [number, number, number] | null {
  if (!color) return null;
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(color);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 色を白方向（amt>0）／黒方向（amt<0）へ寄せる。 */
function shade(color: string, amt: number): string {
  const p = rgbParts(color);
  if (!p) return color;
  const mix = (c: number) =>
    amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt));
  return `rgb(${mix(p[0])}, ${mix(p[1])}, ${mix(p[2])})`;
}

// ---------------------------------------------------------------------------
// 塗り（FillPattern）と矢印マーカー
// ---------------------------------------------------------------------------

/**
 * FillPattern を SVG の塗り（paint）と、それに必要な <defs> 断片へ変換する。
 * gid はドキュメント内で一意な識別子（gradient / pattern の id 接頭辞）。
 */
function fillPaint(
  fillColor: string | null,
  fillPattern: FillPattern,
  gid: string
): { paint: string; defs: string } {
  if (!fillColor || fillPattern === "None") return { paint: "none", defs: "" };
  if (fillPattern === "Solid") return { paint: fillColor, defs: "" };

  // グラデーション系（円柱・球）。中央を明るく、縁を fillColor にして立体感を出す。
  if (
    fillPattern === "HorizontalCylinder" ||
    fillPattern === "VerticalCylinder" ||
    fillPattern === "Sphere"
  ) {
    const id = `${gid}-grad`;
    const light = shade(fillColor, 0.55);
    if (fillPattern === "Sphere") {
      return {
        paint: `url(#${id})`,
        defs:
          `<radialGradient id="${id}" cx="0.35" cy="0.35" r="0.75">` +
          `<stop offset="0%" stop-color="${esc(light)}" />` +
          `<stop offset="100%" stop-color="${esc(fillColor)}" />` +
          `</radialGradient>`,
      };
    }
    // HorizontalCylinder は軸が水平＝陰影は縦方向、Vertical はその逆。
    const vertical = fillPattern === "HorizontalCylinder";
    return {
      paint: `url(#${id})`,
      defs:
        `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${
          vertical ? 1 : 0
        }">` +
        `<stop offset="0%" stop-color="${esc(fillColor)}" />` +
        `<stop offset="50%" stop-color="${esc(light)}" />` +
        `<stop offset="100%" stop-color="${esc(fillColor)}" />` +
        `</linearGradient>`,
    };
  }

  // ハッチング系。fillColor の線を並べたタイルパターンで塗る。
  const id = `${gid}-hatch`;
  const tile = 8; // タイル一辺（ワールド単位）
  const sw = 0.9;
  const lines: string[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${esc(
      fillColor
    )}" stroke-width="${sw}" />`;
  if (fillPattern === "Horizontal" || fillPattern === "Cross") {
    lines.push(seg(0, tile / 2, tile, tile / 2));
  }
  if (fillPattern === "Vertical" || fillPattern === "Cross") {
    lines.push(seg(tile / 2, 0, tile / 2, tile));
  }
  if (fillPattern === "Forward" || fillPattern === "CrossDiag") {
    lines.push(seg(0, tile, tile, 0));
  }
  if (fillPattern === "Backward" || fillPattern === "CrossDiag") {
    lines.push(seg(0, 0, tile, tile));
  }
  return {
    paint: `url(#${id})`,
    defs:
      `<pattern id="${id}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse">` +
      lines.join("") +
      `</pattern>`,
  };
}

/** Arrow 端の三角形マーカー。kind は Modelica の Arrow 名（末尾）。無し／None なら null。 */
function arrowMarker(kind: string, size: number, color: string, id: string): string | null {
  const k = kind.split(".").at(-1) ?? kind;
  if (!k || k === "None") return null;
  const L = Math.max(size, 1) * 1.4; // マーカー長（ワールド単位）
  const W = Math.max(size, 1) * 1.2; // マーカー幅
  let shape: string;
  if (k === "Open") {
    shape =
      `<path d="M0,0 L${n(L)},${n(W / 2)} L0,${n(W)}" fill="none" stroke="${esc(color)}"` +
      ` stroke-width="${n(Math.max(size * 0.25, 0.6))}" stroke-linejoin="round" />`;
  } else if (k === "Half") {
    shape = `<path d="M0,${n(W / 2)} L${n(L)},${n(W / 2)} L0,${n(W)} Z" fill="${esc(color)}" />`;
  } else {
    // Filled（既定）
    shape = `<path d="M0,0 L${n(L)},${n(W / 2)} L0,${n(W)} Z" fill="${esc(color)}" />`;
  }
  return (
    `<marker id="${id}" markerWidth="${n(L)}" markerHeight="${n(W)}" refX="${n(L)}"` +
    ` refY="${n(W / 2)}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${shape}</marker>`
  );
}

// ---------------------------------------------------------------------------
// プリミティブ描画
// ---------------------------------------------------------------------------

/**
 * 配置による反転（extent の符号反転＝ミラー）の累積符号。
 * テキストは反転しても正立させたいので、写像のネストごとに符号を掛け合わせて持ち回る。
 */
export interface FlipSigns {
  signX: number;
  signY: number;
}

const NO_FLIP: FlipSigns = { signX: 1, signY: 1 };

/** id の重複を避けるための連番発行器。 */
function makeIdGen(prefix: string): () => string {
  let seq = 0;
  return () => `${prefix}${(seq += 1)}`;
}

function autoTextFontSize(text: string, width: number, height: number): number {
  const lines = text.split(/\r?\n/);
  const lineCount = Math.max(1, lines.length);
  const maxChars = Math.max(1, ...lines.map((line) => Array.from(line).length));
  const byHeight = height / (lineCount * 1.18);
  const byWidth = width / (maxChars * 0.62);
  return Math.max(1, Math.min(byHeight, byWidth) * 0.92);
}

/**
 * 図形 1 個を SVG 断片へ。className は `%name` の置換に使う（コンポーネント名）。
 * flip は写像の累積反転符号、nextId は defs 用 id の発行器。
 */
export function renderPrimitive(
  primitive: GraphicPrimitive,
  className: string,
  flip: FlipSigns,
  nextId: () => string
): string {
  if (!primitive.visible) return "";
  const { origin, rotation } = primitive;
  const transform =
    origin[0] !== 0 || origin[1] !== 0 || rotation !== 0
      ? ` transform="translate(${n(origin[0])} ${n(origin[1])}) rotate(${n(rotation)})"`
      : "";

  let element = "";

  switch (primitive.type) {
    case "line": {
      if (primitive.points.length < 2) break;
      const color = primitive.color ?? "rgb(0,0,0)";
      const stroke = lineStroke(primitive.color, primitive.pattern);
      const gid = nextId();
      const startId = `${gid}-as`;
      const endId = `${gid}-ae`;
      const startMarker =
        stroke === "none"
          ? null
          : arrowMarker(primitive.arrow[0], primitive.arrowSize, color, startId);
      const endMarker =
        stroke === "none"
          ? null
          : arrowMarker(primitive.arrow[1], primitive.arrowSize, color, endId);
      const defs =
        startMarker || endMarker
          ? `<defs>${startMarker ?? ""}${endMarker ?? ""}</defs>`
          : "";
      const markers =
        (startMarker ? ` marker-start="url(#${startId})"` : "") +
        (endMarker ? ` marker-end="url(#${endId})"` : "");
      const common =
        ` fill="none" stroke="${esc(stroke)}" stroke-width="${n(
          strokeWidthPx(primitive.thickness)
        )}"${dashAttr(
          primitive.pattern
        )} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"${markers}`;
      element =
        defs +
        (primitive.smooth && primitive.points.length >= 3
          ? `<path d="${smoothPath(primitive.points, false)}"${common} />`
          : `<polyline points="${pointsToPath(primitive.points)}"${common} />`);
      break;
    }
    case "polygon": {
      const gid = nextId();
      const { paint, defs } = fillPaint(primitive.fillColor, primitive.fillPattern, gid);
      const stroke = lineStroke(primitive.lineColor, primitive.linePattern);
      const common =
        ` fill="${esc(paint)}" stroke="${esc(stroke)}" stroke-width="${n(
          strokeWidthPx(primitive.lineThickness)
        )}"${dashAttr(
          primitive.linePattern
        )} stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
      element =
        (defs ? `<defs>${defs}</defs>` : "") +
        (primitive.smooth && primitive.points.length >= 3
          ? `<path d="${smoothPath(primitive.points, true)}"${common} />`
          : `<polygon points="${pointsToPath(primitive.points)}"${common} />`);
      break;
    }
    case "rectangle": {
      const r = normalizeExtent(primitive.extent);
      const gid = nextId();
      const { paint, defs } = fillPaint(primitive.fillColor, primitive.fillPattern, gid);
      const stroke = lineStroke(primitive.lineColor, primitive.linePattern);
      const radius = primitive.radius
        ? ` rx="${n(primitive.radius)}" ry="${n(primitive.radius)}"`
        : "";
      element =
        (defs ? `<defs>${defs}</defs>` : "") +
        `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(
          r.h
        )}"${radius} fill="${esc(paint)}" stroke="${esc(stroke)}" stroke-width="${n(
          strokeWidthPx(primitive.lineThickness)
        )}"${dashAttr(primitive.linePattern)} vector-effect="non-scaling-stroke" />`;
      break;
    }
    case "ellipse": {
      const r = normalizeExtent(primitive.extent);
      const gid = nextId();
      const { paint, defs } = fillPaint(primitive.fillColor, primitive.fillPattern, gid);
      const stroke = lineStroke(primitive.lineColor, primitive.linePattern);
      element =
        (defs ? `<defs>${defs}</defs>` : "") +
        `<ellipse cx="${n(r.cx)}" cy="${n(r.cy)}" rx="${n(r.w / 2)}" ry="${n(
          r.h / 2
        )}" fill="${esc(paint)}" stroke="${esc(stroke)}" stroke-width="${n(
          strokeWidthPx(primitive.lineThickness)
        )}"${dashAttr(primitive.linePattern)} vector-effect="non-scaling-stroke" />`;
      break;
    }
    case "text": {
      const r = normalizeExtent(primitive.extent);
      const text = primitive.textString.replace(/%name/g, className).replace(/%%/g, "%");
      if (!text.trim()) break;
      const lines = text.split(/\r?\n/);
      const size =
        primitive.fontSize > 0 ? primitive.fontSize : autoTextFontSize(text, r.w, r.h);
      const lineHeight = size * 1.18;
      const firstY = -((lines.length - 1) * lineHeight) / 2;
      const anchor =
        primitive.horizontalAlignment === "left"
          ? "start"
          : primitive.horizontalAlignment === "right"
            ? "end"
            : "middle";
      const tx =
        primitive.horizontalAlignment === "left"
          ? r.x
          : primitive.horizontalAlignment === "right"
            ? r.x + r.w
            : r.cx;
      const tspans = lines
        .map((line, index) =>
          index === 0
            ? `<tspan x="0" y="${n(firstY)}">${esc(line)}</tspan>`
            : `<tspan x="0" dy="${n(lineHeight)}">${esc(line)}</tspan>`
        )
        .join("");
      // テキストは配置による上下・左右反転（ミラー）と、ワールドの Y 反転を
      // 打ち消して常に正立させる。位置（origin）だけは反転に追従する。
      element =
        `<g transform="translate(${n(tx)} ${n(r.cy)}) scale(${flip.signX} ${-flip.signY})">` +
        `<text x="0" y="0" font-size="${n(size)}" fill="${esc(
          primitive.color ?? "rgb(0,0,0)"
        )}" font-weight="${primitive.bold ? "bold" : "normal"}" font-style="${
          primitive.italic ? "italic" : "normal"
        }" font-family="${esc(primitive.fontName || "sans-serif")}"${
          primitive.underline ? ' text-decoration="underline"' : ""
        } text-anchor="${anchor}" dominant-baseline="middle">${tspans}</text></g>`;
      break;
    }
  }

  if (!element) return "";
  return transform ? `<g${transform}>${element}</g>` : element;
}

// ---------------------------------------------------------------------------
// アイコンの写像
// ---------------------------------------------------------------------------

/** ソース extent（アイコン座標系）を配置先 extent へ写す SVG transform。 */
export function iconMapTransform(source: Extent, target: Extent): string {
  const [[ix1, iy1], [ix2, iy2]] = source;
  const [[cx1, cy1], [cx2, cy2]] = target;
  const sx = (cx2 - cx1) / (ix2 - ix1 || 1);
  const sy = (cy2 - cy1) / (iy2 - iy1 || 1);
  const icx = (ix1 + ix2) / 2;
  const icy = (iy1 + iy2) / 2;
  const ccx = (cx1 + cx2) / 2;
  const ccy = (cy1 + cy2) / 2;
  return `translate(${n(ccx)} ${n(ccy)}) scale(${n(sx)} ${n(sy)}) translate(${n(-icx)} ${n(
    -icy
  )})`;
}

function extentFlipSigns(source: Extent, target: Extent): FlipSigns {
  const [[ix1, iy1], [ix2, iy2]] = source;
  const [[cx1, cy1], [cx2, cy2]] = target;
  const sx = (cx2 - cx1) / (ix2 - ix1 || 1);
  const sy = (cy2 - cy1) / (iy2 - iy1 || 1);
  return { signX: sx < 0 ? -1 : 1, signY: sy < 0 ? -1 : 1 };
}

function composeFlip(parent: FlipSigns, local: FlipSigns): FlipSigns {
  return { signX: parent.signX * local.signX, signY: parent.signY * local.signY };
}

/** アイコン座標系（source）で描いた inner を、配置先 extent（target）へ写して描く。 */
function mappedIconGroup(source: Extent, target: Extent, inner: string): string {
  if (!inner) return "";
  return `<g transform="${iconMapTransform(source, target)}">${inner}</g>`;
}

/** GraphicsLayer 1 枚を target extent へ写して描く。 */
export function renderComponentIcon(
  layer: GraphicsLayer,
  target: Extent,
  name: string,
  flip: FlipSigns,
  nextId: () => string
): string {
  const local = composeFlip(flip, extentFlipSigns(layer.extent, target));
  const inner = layer.primitives
    .map((primitive) => renderPrimitive(primitive, name, local, nextId))
    .join("");
  return mappedIconGroup(layer.extent, target, inner);
}

/** 配置済みコンポーネント 1 個（origin / rotation 反映）を描く。 */
function renderPlacedComponent(
  component: DiagramComponent,
  layer: GraphicsLayer,
  flip: FlipSigns,
  nextId: () => string
): string {
  const origin = component.origin;
  const ox = origin ? origin[0] : 0;
  const oy = origin ? origin[1] : 0;
  const transform =
    ox !== 0 || oy !== 0 || component.rotation !== 0
      ? ` transform="translate(${n(ox)} ${n(oy)}) rotate(${n(component.rotation)})"`
      : "";
  const inner = renderComponentIcon(layer, component.extent, component.name, flip, nextId);
  if (!inner) return "";
  return transform ? `<g${transform}>${inner}</g>` : inner;
}

// ---------------------------------------------------------------------------
// ダイアグラム全体
// ---------------------------------------------------------------------------

/** アイコンが解決できないコンポーネントの代替表示（名前と型名を書いた矩形）。 */
function fallbackNode(component: DiagramComponent, labelSize: number): string {
  const r = normalizeExtent(component.extent);
  const shortType = component.typeName.split(".").at(-1) ?? component.typeName;
  return (
    `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="${n(
      labelSize
    )}" ry="${n(
      labelSize
    )}" fill="rgba(59,130,246,0.08)" stroke="${SELECT_COLOR}" stroke-width="1" vector-effect="non-scaling-stroke" />` +
    `<g transform="translate(${n(r.cx)} ${n(r.cy)}) scale(1 -1)">` +
    `<text x="0" y="0" font-size="${n(
      labelSize
    )}" fill="rgb(30,58,138)" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${esc(
      component.name
    )}</text>` +
    `<text x="0" y="${n(labelSize * 1.3)}" font-size="${n(
      labelSize * 0.75
    )}" fill="rgb(100,116,139)" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${esc(
      shortType
    )}</text>` +
    `</g>`
  );
}

/** 実際に描画される要素（配置・接続線・自前図形）の広がり。要素が無ければ null。 */
function contentExtent(layer: DiagramLayer): Extent | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  for (const c of layer.components) {
    const o = c.origin ?? [0, 0];
    for (const p of c.extent) push(o[0] + p[0], o[1] + p[1]);
  }
  for (const cn of layer.connections) for (const p of cn.points) push(p[0], p[1]);
  for (const p of layer.primitives) {
    const o = p.origin;
    if (p.type === "line" || p.type === "polygon") {
      for (const pt of p.points) push(o[0] + pt[0], o[1] + pt[1]);
    } else {
      for (const pt of p.extent) push(o[0] + pt[0], o[1] + pt[1]);
    }
  }
  if (!xs.length) return null;
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

function unionExtent(a: Extent, b: Extent | null): Extent {
  if (!b) return a;
  const an = normalizeExtent(a);
  const bn = normalizeExtent(b);
  return [
    [Math.min(an.x, bn.x), Math.min(an.y, bn.y)],
    [Math.max(an.x + an.w, bn.x + bn.w), Math.max(an.y + an.h, bn.y + bn.h)],
  ];
}

/** buildDiagramSvg の戻り値。webview 側でグリッド描画やズームに使う情報を含む。 */
export interface DiagramSvgResult {
  /** <svg> 要素まで含んだ SVG 文字列。 */
  svg: string;
  /** 初期 viewBox（SVG 座標。Y は反転後）。 */
  viewBox: { x: number; y: number; width: number; height: number };
  /** キャンバス矩形（座標系 extent、ワールド座標）。 */
  canvas: { x: number; y: number; width: number; height: number };
}

/**
 * DiagramLayer と解決済みアイコンから SVG を組み立てる。
 * 描画順は Orbis と同じく「自前の graphics → 接続線 → コンポーネント」。
 */
export function buildDiagramSvg(
  layer: DiagramLayer,
  icons: IconMap,
  options: DiagramSvgOptions = {}
): DiagramSvgResult {
  const nextId = makeIdGen("mg");
  const canvasRect = normalizeExtent(layer.extent.length ? layer.extent : DEFAULT_EXTENT);
  const view =
    options.expandToContent === false
      ? layer.extent
      : unionExtent(layer.extent, contentExtent(layer));
  const v = normalizeExtent(view);
  const pad = Math.max(v.w, v.h) * 0.08 + 4;
  const labelSize = Math.max(canvasRect.w, canvasRect.h) * 0.02;

  // キャンバス（座標系 extent）の下地。グリッドより下に敷く。
  const canvasSvg =
    `<rect x="${n(canvasRect.x)}" y="${n(canvasRect.y)}" width="${n(
      canvasRect.w
    )}" height="${n(canvasRect.h)}" fill="${esc(
      options.canvasFill ?? "rgb(255,255,255)"
    )}" stroke="${esc(
      options.canvasStroke ?? "rgb(148,163,184)"
    )}" stroke-width="1.2" vector-effect="non-scaling-stroke" />`;

  const parts: string[] = [];

  // Diagram 自身の graphics。
  for (const primitive of layer.primitives) {
    parts.push(renderPrimitive(primitive, "", NO_FLIP, nextId));
  }

  // 接続線。
  for (const connection of layer.connections) {
    if (connection.points.length < 2) continue;
    parts.push(
      `<polyline points="${pointsToPath(connection.points)}" fill="none" stroke="${esc(
        connection.color ?? "rgb(0,0,0)"
      )}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke">` +
        `<title>${esc(connection.from)} — ${esc(connection.to)}</title></polyline>`
    );
  }

  // コンポーネント（解決できればアイコン、無ければ代替の矩形）。
  for (const component of layer.components) {
    const node = icons.get(component.name) ?? null;
    const hasIcon =
      node !== null && (node.base.primitives.length > 0 || node.ports.length > 0);
    const ox = component.origin ? component.origin[0] : 0;
    const oy = component.origin ? component.origin[1] : 0;
    const transform =
      ox !== 0 || oy !== 0 || component.rotation !== 0
        ? ` transform="translate(${n(ox)} ${n(oy)}) rotate(${n(component.rotation)})"`
        : "";
    const inactive = component.conditionDefault === false;

    let inner: string;
    if (hasIcon && node) {
      const flip = extentFlipSigns(node.base.extent, component.extent);
      const body =
        node.base.primitives
          .map((primitive) => renderPrimitive(primitive, component.name, flip, nextId))
          .join("") +
        // input/output などのポート（コネクタ）アイコンは型のアイコン座標系に置かれる。
        node.ports
          .map((port) => renderPlacedComponent(port.component, port.icon, flip, nextId))
          .join("");
      inner = mappedIconGroup(node.base.extent, component.extent, body);
    } else {
      inner = fallbackNode(component, labelSize);
    }

    const title =
      `<title>${esc(component.name)} : ${esc(component.typeName)}` +
      (component.condition
        ? ` if ${esc(component.condition)}${inactive ? " (default: false)" : ""}`
        : "") +
      `</title>`;
    parts.push(
      `<g${transform}${inactive ? ' opacity="0.35"' : ""}>${title}${inner}</g>`
    );
  }

  // ワールド（Y 上向き）→ SVG（Y 下向き）。viewBox は反転後の座標で指定する。
  const viewBox = {
    x: v.x - pad,
    y: -(v.y + v.h) - pad,
    width: v.w + pad * 2,
    height: v.h + pad * 2,
  };

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(viewBox.x)} ${n(
      viewBox.y
    )} ${n(viewBox.width)} ${n(viewBox.height)}" preserveAspectRatio="xMidYMid meet">` +
    `<g transform="scale(1 -1)">${canvasSvg}</g>` +
    // グリッドは webview 側が viewBox に合わせて描き足す（SVG 座標のまま）。
    `<g id="mg-grid"></g>` +
    `<g transform="scale(1 -1)">${parts.join("")}</g>` +
    `</svg>`;

  return {
    svg,
    viewBox,
    canvas: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.w, height: canvasRect.h },
  };
}
