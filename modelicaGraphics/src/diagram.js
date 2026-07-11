// モデルの構成（コンポーネント配置・接続・座標系）を解析し、模式ダイアグラム SVG を生成する。
// vscode 非依存・純粋関数。コンポーネントの Icon 図形描画は icon.js を使う（未指定時は名前付きボックス）。

const { matchParen, parseNumberArray, extractBraceValue } = require("./parse");

const DECL_PREFIX =
  "final|inner|outer|replaceable|redeclare|parameter|constant|discrete|flow|stream|input|output|each";

/** 宣言セクションでの name（コンポーネント名）宣言の開始オフセット。無ければ -1。 */
function declOffset(text, name) {
  const re = new RegExp(
    "(?:^|\\n)\\s*(?:(?:" +
      DECL_PREFIX +
      ")\\s+)*[A-Za-z_][\\w.]*(?:\\s*\\[[^\\]]*\\])?\\s+" +
      name +
      "\\b"
  );
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** Diagram(coordinateSystem(extent=…)) の座標系。無ければ既定 {{-100,-100},{100,100}}。 */
function parseDiagramExtent(text) {
  const dm = /Diagram\s*\(/.exec(text);
  let region = text;
  if (dm) {
    const open = dm.index + dm[0].length - 1;
    const close = matchParen(text, open);
    if (close > 0) region = text.slice(open + 1, close);
  }
  const es = extractBraceValue(region, "extent");
  const a = es
    ? parseNumberArray(es)
    : [
        [-100, -100],
        [100, 100],
      ];
  const xs = [a[0][0], a[1][0]];
  const ys = [a[0][1], a[1][1]];
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

/** コンポーネント（[{name,type}]）から配置情報 [{name,type,origin,extent,rotation}] を得る。 */
function parseComponentPlacements(text, components) {
  const eqIdx = (/\bequation\b/.exec(text) || { index: text.length }).index;
  const offs = components
    .map((c) => ({ c, off: declOffset(text.slice(0, eqIdx), c.name) }))
    .filter((o) => o.off >= 0)
    .sort((a, b) => a.off - b.off);
  const out = [];
  for (let i = 0; i < offs.length; i++) {
    const start = offs[i].off;
    const end = i + 1 < offs.length ? offs[i + 1].off : eqIdx;
    const seg = text.slice(start, end);
    const tm = /transformation\s*\(/.exec(seg);
    if (!tm) continue;
    const topen = start + tm.index + tm[0].length - 1;
    const tclose = matchParen(text, topen);
    if (tclose < 0) continue;
    const tc = text.slice(topen + 1, tclose);
    const es = extractBraceValue(tc, "extent");
    if (!es) continue;
    const extent = parseNumberArray(es);
    const os = extractBraceValue(tc, "origin");
    const origin = os ? parseNumberArray(os) : [0, 0];
    const rm = /rotation\s*=\s*([-+0-9.eE]+)/.exec(tc);
    const rotation = rm ? parseFloat(rm[1]) : 0;
    out.push({
      name: offs[i].c.name,
      type: offs[i].c.type,
      origin,
      extent,
      rotation,
    });
  }
  return out;
}

/** connect(…) annotation(Line(points=…, color=…)) を解析する。 */
function parseConnections(text) {
  const out = [];
  const re = /\bconnect\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const argsClose = matchParen(text, m.index + m[0].length - 1);
    if (argsClose < 0) continue;
    const semi = text.indexOf(";", argsClose);
    const seg = text.slice(argsClose, semi < 0 ? undefined : semi);
    const lm = /Line\s*\(/.exec(seg);
    if (!lm) continue;
    const lopen = argsClose + lm.index + lm[0].length - 1;
    const lclose = matchParen(text, lopen);
    if (lclose < 0) continue;
    const content = text.slice(lopen + 1, lclose);
    const ptsStr = extractBraceValue(content, "points");
    if (!ptsStr) continue;
    const points = parseNumberArray(ptsStr);
    const colStr = extractBraceValue(content, "color");
    const color = colStr ? parseNumberArray(colStr) : [0, 0, 0];
    out.push({ points, color });
  }
  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rgb(c) {
  const r = (c && c[0]) || 0;
  const g = (c && c[1]) || 0;
  const b = (c && c[2]) || 0;
  return `rgb(${r},${g},${b})`;
}

/** コンポーネント配置から、名前付きボックスの SVG 断片を返す（Icon 未指定時の既定描画）。 */
function boxSvg(c, opts) {
  const [[e1x, e1y], [e2x, e2y]] = c.extent;
  const x1 = c.origin[0] + e1x;
  const y1 = c.origin[1] + e1y;
  const x2 = c.origin[0] + e2x;
  const y2 = c.origin[1] + e2y;
  const xlo = Math.min(x1, x2);
  const xhi = Math.max(x1, x2);
  const ylo = Math.min(y1, y2);
  const yhi = Math.max(y1, y2);
  const cx = c.origin[0];
  const cy = c.origin[1];
  const rot =
    c.rotation && c.rotation !== 0
      ? ` transform="rotate(${-c.rotation} ${cx} ${-cy})"`
      : "";
  const shortType = String(c.type).split(".").pop();
  return (
    `<g${rot}>` +
    `<rect x="${xlo}" y="${-yhi}" width="${xhi - xlo}" height="${
      yhi - ylo
    }" rx="1" class="comp" />` +
    `<text x="${cx}" y="${-cy}" class="cname" text-anchor="middle" dominant-baseline="middle">${esc(
      c.name
    )}</text>` +
    `<title>${esc(c.name)} : ${esc(shortType)}</title>` +
    `</g>`
  );
}

/**
 * 解析済みのコンポーネント配置・接続・座標系から SVG を生成する。
 * opts.renderComponent(c) を渡すと各コンポーネントの描画 SVG 断片を差し替えできる
 * （Icon 描画などに利用）。返り値が falsy なら既定のボックス描画にフォールバックする。
 */
function buildDiagramSvg(placements, connections, extent, opts) {
  opts = opts || {};
  const margin = 10;
  const vbX = extent.xmin - margin;
  const vbY = -extent.ymax - margin;
  const vbW = extent.xmax - extent.xmin + 2 * margin;
  const vbH = extent.ymax - extent.ymin + 2 * margin;

  const parts = [];
  for (const cn of connections) {
    if (!cn.points || cn.points.length < 2) continue;
    const pts = cn.points.map((p) => `${p[0]},${-p[1]}`).join(" ");
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${rgb(
        cn.color
      )}" stroke-width="0.5" />`
    );
  }
  for (const c of placements) {
    let frag = null;
    if (typeof opts.renderComponent === "function") {
      try {
        frag = opts.renderComponent(c);
      } catch (_) {
        frag = null;
      }
    }
    parts.push(frag || boxSvg(c, opts));
  }

  const body = parts.join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" style="max-height:100%">
<style>
  .comp { fill: ${opts.compFill || "rgba(120,160,220,0.15)"}; stroke: ${
    opts.compStroke || "#5a8fd6"
  }; stroke-width: 0.5; }
  .cname { font-size: 5px; fill: ${
    opts.textColor || "#ccc"
  }; font-family: sans-serif; }
</style>
${body}
</svg>`;
}

module.exports = {
  parseDiagramExtent,
  parseComponentPlacements,
  parseConnections,
  buildDiagramSvg,
  esc,
  rgb,
};
