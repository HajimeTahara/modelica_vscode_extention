// モデルファイルの experiment / __OpenModelica_simulationFlags annotation の
// 読み取り・書き戻し（vscode 非依存）。
//
// 書き戻しはユーザのモデルを直接編集するため、文字列アウェアなカッコ対応で
// クラスレベル annotation を安全に特定し、既存を置換 or 無ければ挿入する。

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** openIdx の '(' に対応する ')' の位置を返す（文字列リテラルを無視）。無ければ -1。 */
function matchParenForward(text, openIdx) {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
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

/** experiment(...) を読み取る。無ければ null。 */
function parseExperiment(text) {
  const m = /experiment\s*\(([^)]*)\)/.exec(text);
  if (!m) return null;
  const body = m[1];
  const out = {};
  const num = (key) => {
    const r = new RegExp("\\b" + key + "\\s*=\\s*([-+0-9.eE]+)").exec(body);
    return r ? Number(r[1]) : undefined;
  };
  const st = num("StartTime");
  if (st !== undefined) out.startTime = st;
  const sp = num("StopTime");
  if (sp !== undefined) out.stopTime = sp;
  const iv = num("Interval");
  if (iv !== undefined) out.interval = iv;
  const tol = num("Tolerance");
  if (tol !== undefined) out.tolerance = tol;
  return out;
}

/** __OpenModelica_simulationFlags(...) を読み取る。無ければ null。 */
function parseSimulationFlags(text) {
  const m = /__OpenModelica_simulationFlags\s*\(([^)]*)\)/.exec(text);
  if (!m) return null;
  const body = m[1];
  const out = {};
  const s = /(?:^|[,\s])s\s*=\s*"([^"]*)"/.exec(body);
  if (s) out.method = s[1];
  const lv = /(?:^|[,\s])lv\s*=\s*"([^"]*)"/.exec(body);
  if (lv)
    out.logging = lv[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return out;
}

/**
 * クラスレベル annotation の範囲 {open, close}（'(' と ')' のインデックス）を返す。
 * 「) ; の直後に end <単純クラス名> が来る annotation」をクラス annotation とみなす。
 * 無ければ null。
 */
function findClassAnnotationRange(text, className) {
  const simple = className.split(".").pop();
  const endRe = new RegExp("end\\s+" + escapeRegExp(simple) + "\\s*;", "g");
  let endMatch = null;
  let mm;
  while ((mm = endRe.exec(text)) !== null) endMatch = mm; // 最後の end
  if (!endMatch) return null;
  const endIdx = endMatch.index;

  const annRe = /\bannotation\b/g;
  let a;
  let best = null;
  while ((a = annRe.exec(text)) !== null) {
    if (a.index >= endIdx) break;
    let i = a.index + "annotation".length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "(") continue;
    const open = i;
    const close = matchParenForward(text, open);
    if (close < 0) continue;
    let j = close + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== ";") continue;
    j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (j === endIdx) best = { open, close };
  }
  return best;
}

/**
 * experiment / __OpenModelica_simulationFlags をモデルに反映した新テキストを返す。
 * - クラス annotation があり experiment あり → その experiment を置換
 * - クラス annotation があり experiment なし → 先頭へ挿入
 * - クラス annotation 無し → end の直前に annotation を新規挿入
 * flagsStr は空文字なら書き込まない。
 */
function upsertSimulationAnnotation(text, className, experimentStr, flagsStr) {
  const simple = className.split(".").pop();
  const expRe = /experiment\s*\([^)]*\)/;
  const flagRe = /__OpenModelica_simulationFlags\s*\([^)]*\)/;
  const range = findClassAnnotationRange(text, className);

  if (range) {
    const before = text.slice(0, range.open + 1);
    let inner = text.slice(range.open + 1, range.close);
    const after = text.slice(range.close);

    if (expRe.test(inner)) {
      inner = inner.replace(expRe, experimentStr);
    } else {
      inner = "\n    " + experimentStr + "," + inner;
    }

    if (flagsStr) {
      if (flagRe.test(inner)) {
        inner = inner.replace(flagRe, flagsStr);
      } else {
        inner = inner.replace(expRe, (m) => m + ",\n    " + flagsStr);
      }
    }
    return before + inner + after;
  }

  // クラス annotation 無し → end の直前に新規挿入
  const body = flagsStr
    ? `${experimentStr},\n    ${flagsStr}`
    : `${experimentStr}`;
  const ann = `  annotation (\n    ${body});\n`;
  const endRe = new RegExp(
    "(^|\\n)([ \\t]*)(end\\s+" + escapeRegExp(simple) + "\\s*;)"
  );
  const m = endRe.exec(text);
  if (m) {
    const idx = m.index + m[1].length;
    return text.slice(0, idx) + ann + text.slice(idx);
  }
  return text.replace(/\s*$/, "") + "\n" + ann;
}

/** オフセットの 0 始まり行番号。 */
function lineOf(text, offset) {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Documentation(info="<html>…") の HTML 文字列を取り出す（エスケープ解除済み）。無ければ null。
 */
function extractDocumentation(text) {
  const dm = /Documentation\s*\(/.exec(text);
  if (!dm) return null;
  const im = /info\s*=\s*"/.exec(text.slice(dm.index));
  if (!im) return null;
  let i = dm.index + im.index + im[0].length;
  let s = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      const nx = text[i + 1];
      s += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
      i += 2;
      continue;
    }
    if (c === '"') break;
    s += c;
    i++;
  }
  return s;
}

/**
 * ファイル内の複数行 annotation ブロックの行範囲 [{startLine, endLine}] を返す。
 * 折りたたみ（annotation 非表示）に使う。
 */
function findAnnotationRanges(text) {
  const out = [];
  const re = /\bannotation\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + "annotation".length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "(") continue;
    const close = matchParenForward(text, i);
    if (close < 0) continue;
    const startLine = lineOf(text, m.index);
    const endLine = lineOf(text, close);
    if (endLine > startLine) out.push({ startLine, endLine });
    re.lastIndex = close + 1;
  }
  return out;
}

module.exports = {
  parseExperiment,
  parseSimulationFlags,
  findClassAnnotationRange,
  matchParenForward,
  upsertSimulationAnnotation,
  lineOf,
  extractDocumentation,
  findAnnotationRanges,
};
