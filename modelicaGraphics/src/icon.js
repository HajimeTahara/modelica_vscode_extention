// Modelica の Icon 図形（graphics）の解析と SVG 描画。vscode/omc/Node 非依存。
// 対応プリミティブ: Line / Rectangle / Ellipse / Polygon / Text（EAST/MSL で使う 5 種）。
// 継承（extends）の収集は I/O が要るため呼び出し側が行い、各クラスの Icon を merge して渡す。

const { matchParen } = require("./parse");

// =====================================================================
// アノテーション値パーサ（records / 配列 / 文字列 / 真偽 / enum / 数値）
// =====================================================================

function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function parseString(s, i) {
  // s[i] === '"'
  i++;
  let out = "";
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const nx = s[i + 1];
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

function parseNumber(s, i) {
  let j = i;
  if (s[j] === "+" || s[j] === "-") j++;
  while (j < s.length && /[0-9.eE]/.test(s[j])) {
    // 指数の符号
    if ((s[j] === "e" || s[j] === "E") && (s[j + 1] === "+" || s[j + 1] === "-")) j++;
    j++;
  }
  return [parseFloat(s.slice(i, j)), j];
}

function parseIdent(s, i) {
  let j = i;
  while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
  return [s.slice(i, j), j];
}

function parseArray(s, i) {
  // s[i] === '{'
  i++;
  const arr = [];
  i = skipWs(s, i);
  if (s[i] === "}") return [arr, i + 1];
  while (i < s.length) {
    const [v, j] = parseValue(s, i);
    arr.push(v);
    i = skipWs(s, j);
    if (s[i] === ",") {
      i = skipWs(s, i + 1);
      continue;
    }
    if (s[i] === "}") {
      i++;
      break;
    }
    break;
  }
  return [arr, i];
}

function parseArgs(s, i) {
  // s[i] === '('
  i++;
  const args = {};
  const pos = [];
  i = skipWs(s, i);
  if (s[i] === ")") return [{ args, pos }, i + 1];
  while (i < s.length) {
    i = skipWs(s, i);
    // 名前付き引数の先読み: ident '='
    const save = i;
    const [id, j] = parseIdent(s, i);
    const k = skipWs(s, j);
    if (id && s[k] === "=" && s[k + 1] !== "=") {
      const [v, m] = parseValue(s, k + 1);
      args[id] = v;
      i = m;
    } else {
      const [v, m] = parseValue(s, save);
      pos.push(v);
      i = m;
    }
    i = skipWs(s, i);
    if (s[i] === ",") {
      i++;
      continue;
    }
    if (s[i] === ")") {
      i++;
      break;
    }
    break;
  }
  return [{ args, pos }, i];
}

function parseValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === undefined) return [null, i];
  if (c === "{") return parseArray(s, i);
  if (c === '"') return parseString(s, i);
  if (c === "-" || c === "+" || (c >= "0" && c <= "9") || c === ".") {
    return parseNumber(s, i);
  }
  if (/[A-Za-z_]/.test(c)) {
    const [name, j] = parseIdent(s, i);
    const k = skipWs(s, j);
    if (s[k] === "(") {
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
function extractIconBody(classText) {
  const m = /\bIcon\s*\(/.exec(classText);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchParen(classText, open);
  if (close < 0) return null;
  return classText.slice(open + 1, close);
}

/** coordinateSystem(extent=…) の座標範囲。無ければ既定 {-100,-100}-{100,100}。 */
function iconCoordSystem(iconBody) {
  const def = { xmin: -100, ymin: -100, xmax: 100, ymax: 100 };
  const m = /coordinateSystem\s*\(/.exec(iconBody);
  if (!m) return def;
  const open = m.index + m[0].length - 1;
  const close = matchParen(iconBody, open);
  if (close < 0) return def;
  const body = iconBody.slice(open + 1, close);
  const em = /\bextent\s*=\s*/.exec(body);
  if (!em) return def;
  const [ext] = parseValue(body, em.index + em[0].length);
  if (!Array.isArray(ext) || ext.length !== 2) return def;
  const xs = [ext[0][0], ext[1][0]];
  const ys = [ext[0][1], ext[1][1]];
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

/** Icon の graphics プリミティブ配列 [{record, args}] を返す。 */
function iconGraphics(iconBody) {
  const m = /\bgraphics\s*=\s*/.exec(iconBody);
  if (!m) return [];
  const [arr] = parseValue(iconBody, m.index + m[0].length);
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => x && x.record);
}

/** classText の Icon を {coord, graphics} で返す。Icon 無しなら null。 */
function parseIcon(classText) {
  const body = extractIconBody(classText);
  if (body == null) return null;
  return { coord: iconCoordSystem(body), graphics: iconGraphics(body) };
}

/** extends の基底クラス名（ドット付き）一覧。 */
function parseExtends(classText) {
  const out = [];
  const re = /\bextends\s+([A-Za-z_][\w.]*)/g;
  let m;
  while ((m = re.exec(classText)) !== null) out.push(m[1]);
  return out;
}

// =====================================================================
// SVG 描画
// =====================================================================

function num(v, def) {
  return typeof v === "number" && isFinite(v) ? v : def;
}
function colorOf(v, def) {
  if (Array.isArray(v) && v.length >= 3) return `rgb(${v[0] | 0},${v[1] | 0},${v[2] | 0})`;
  return def;
}
function isEnum(v, name) {
  return v && v.enum && String(v.enum).split(".").pop() === name;
}
function esc(s) {
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
function renderIcon(icon, box, tf, ctx) {
  if (!icon || !icon.graphics || !icon.graphics.length) return null;
  const { coord } = icon;
  const iw = coord.xmax - coord.xmin || 1;
  const ih = coord.ymax - coord.ymin || 1;
  const bw = box.xhi - box.xlo;
  const bh = box.yhi - box.ylo;
  // icon 座標 (x,y) → 図面 Modelica 座標
  const mapX = (x) => box.xlo + ((x - coord.xmin) / iw) * bw;
  const mapY = (y) => box.ylo + ((y - coord.ymin) / ih) * bh;
  const P = (x, y) => tf(mapX(x), mapY(y));
  const parts = [];

  for (const g of icon.graphics) {
    const a = g.args || {};
    // プリミティブ固有の origin / rotation（ローカル座標 → icon 座標）
    const o = Array.isArray(a.origin) ? a.origin : [0, 0];
    const rot = num(a.rotation, 0) * (Math.PI / 180);
    const cosr = Math.cos(rot);
    const sinr = Math.sin(rot);
    // AP: プリミティブのローカル点 (px,py) → SVG 座標
    const AP = (px, py) =>
      P(o[0] + px * cosr - py * sinr, o[1] + px * sinr + py * cosr);
    const line = colorOf(a.lineColor, "rgb(0,0,0)");
    const filled = isEnum(a.fillPattern, "Solid");
    const fill = filled ? colorOf(a.fillColor, "none") : "none";
    const sw = num(a.lineThickness, 0.25);
    switch (g.record) {
      case "Rectangle": {
        if (!Array.isArray(a.extent)) break;
        const [p1, p2] = a.extent;
        const c1 = AP(p1[0], p1[1]);
        const c2 = AP(p2[0], p2[1]);
        const x = Math.min(c1[0], c2[0]);
        const y = Math.min(c1[1], c2[1]);
        const w = Math.abs(c2[0] - c1[0]);
        const h = Math.abs(c2[1] - c1[1]);
        const r = num(a.radius, 0);
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}"${
            r ? ` rx="${r}"` : ""
          } fill="${fill}" stroke="${line}" stroke-width="${sw}" />`
        );
        break;
      }
      case "Ellipse": {
        if (!Array.isArray(a.extent)) break;
        const [p1, p2] = a.extent;
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
        if (!Array.isArray(a.points)) break;
        const pts = a.points.map((p) => AP(p[0], p[1]).join(",")).join(" ");
        parts.push(
          `<polygon points="${pts}" fill="${fill}" stroke="${line}" stroke-width="${sw}" />`
        );
        break;
      }
      case "Line": {
        if (!Array.isArray(a.points)) break;
        const pts = a.points.map((p) => AP(p[0], p[1]).join(",")).join(" ");
        const lc = colorOf(a.color, "rgb(0,0,0)");
        const lt = num(a.thickness, 0.25);
        parts.push(
          `<polyline points="${pts}" fill="none" stroke="${lc}" stroke-width="${lt}" />`
        );
        break;
      }
      case "Text": {
        if (!Array.isArray(a.extent)) break;
        let str = typeof a.textString === "string" ? a.textString : "";
        str = str.replace(/%name/g, (ctx && ctx.name) || "");
        if (!str) break;
        const [p1, p2] = a.extent;
        const c1 = AP(p1[0], p1[1]);
        const c2 = AP(p2[0], p2[1]);
        const cx = (c1[0] + c2[0]) / 2;
        const cy = (c1[1] + c2[1]) / 2;
        let fs = num(a.fontSize, 0);
        if (!fs) fs = Math.min(Math.abs(c2[1] - c1[1]) * 0.9, 8) || 4;
        const tc = colorOf(a.textColor, colorOf(a.lineColor, "rgb(0,0,255)"));
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

module.exports = {
  parseValue,
  parseIcon,
  parseExtends,
  extractIconBody,
  iconCoordSystem,
  iconGraphics,
  renderIcon,
};
