// モデルファイルの experiment / __OpenModelica_simulationFlags annotation の
// 読み取り・書き戻し（vscode 非依存）。
//
// 書き戻しはユーザのモデルを直接編集するため、文字列アウェアなカッコ対応で
// クラスレベル annotation を安全に特定し、既存を置換 or 無ければ挿入する。

/** experiment(...) の読み取り結果。 */
export interface ExperimentAnnotation {
  startTime?: number;
  stopTime?: number;
  interval?: number;
  tolerance?: number;
}

/** __OpenModelica_simulationFlags(...) の読み取り結果。 */
export interface SimulationFlagsAnnotation {
  method?: string;
  logging?: string[];
}

/** annotation の '(' と ')' のオフセット。 */
export interface AnnotationRange {
  open: number;
  close: number;
}

/** 折りたたみ対象の行範囲（0 始まり）。 */
export interface AnnotationLineRange {
  startLine: number;
  endLine: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 修飾クラス名の最後のセグメント（単純クラス名）。 */
function simpleClassName(className: string): string {
  return className.split(".").pop() || className;
}

/** openIdx の '(' に対応する ')' の位置を返す（文字列リテラルを無視）。無ければ -1。 */
export function matchParenForward(text: string, openIdx: number): number {
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

/** experiment(...) を読み取る。無ければ null。 */
export function parseExperiment(text: string): ExperimentAnnotation | null {
  const m = /experiment\s*\(([^)]*)\)/.exec(text);
  if (!m) return null;
  const body = m[1]!;
  const out: ExperimentAnnotation = {};
  const num = (key: string): number | undefined => {
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
export function parseSimulationFlags(
  text: string
): SimulationFlagsAnnotation | null {
  const m = /__OpenModelica_simulationFlags\s*\(([^)]*)\)/.exec(text);
  if (!m) return null;
  const body = m[1]!;
  const out: SimulationFlagsAnnotation = {};
  const s = /(?:^|[,\s])s\s*=\s*"([^"]*)"/.exec(body);
  if (s) out.method = s[1]!;
  const lv = /(?:^|[,\s])lv\s*=\s*"([^"]*)"/.exec(body);
  if (lv)
    out.logging = lv[1]!
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
export function findClassAnnotationRange(
  text: string,
  className: string
): AnnotationRange | null {
  const simple = simpleClassName(className);
  const endRe = new RegExp("end\\s+" + escapeRegExp(simple) + "\\s*;", "g");
  let endMatch: RegExpExecArray | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = endRe.exec(text)) !== null) endMatch = mm; // 最後の end
  if (!endMatch) return null;
  const endIdx = endMatch.index;

  const annRe = /\bannotation\b/g;
  let a: RegExpExecArray | null;
  let best: AnnotationRange | null = null;
  while ((a = annRe.exec(text)) !== null) {
    if (a.index >= endIdx) break;
    let i = a.index + "annotation".length;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    if (text.charAt(i) !== "(") continue;
    const open = i;
    const close = matchParenForward(text, open);
    if (close < 0) continue;
    let j = close + 1;
    while (j < text.length && /\s/.test(text.charAt(j))) j++;
    if (text.charAt(j) !== ";") continue;
    j++;
    while (j < text.length && /\s/.test(text.charAt(j))) j++;
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
export function upsertSimulationAnnotation(
  text: string,
  className: string,
  experimentStr: string,
  flagsStr: string
): string {
  const simple = simpleClassName(className);
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
  const body = flagsStr ? `${experimentStr},\n    ${flagsStr}` : `${experimentStr}`;
  const ann = `  annotation (\n    ${body});\n`;
  const endRe = new RegExp(
    "(^|\\n)([ \\t]*)(end\\s+" + escapeRegExp(simple) + "\\s*;)"
  );
  const m = endRe.exec(text);
  if (m) {
    const idx = m.index + m[1]!.length;
    return text.slice(0, idx) + ann + text.slice(idx);
  }
  return text.replace(/\s*$/, "") + "\n" + ann;
}

/** オフセットの 0 始まり行番号。 */
export function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charAt(i) === "\n") line++;
  }
  return line;
}

/**
 * Documentation(info="<html>…") の HTML 文字列を取り出す（エスケープ解除済み）。無ければ null。
 */
export function extractDocumentation(text: string): string | null {
  const dm = /Documentation\s*\(/.exec(text);
  if (!dm) return null;
  const im = /info\s*=\s*"/.exec(text.slice(dm.index));
  if (!im) return null;
  let i = dm.index + im.index + im[0].length;
  let s = "";
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "\\") {
      const nx = text.charAt(i + 1);
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
export function findAnnotationRanges(text: string): AnnotationLineRange[] {
  const out: AnnotationLineRange[] = [];
  const re = /\bannotation\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + "annotation".length;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    if (text.charAt(i) !== "(") continue;
    const close = matchParenForward(text, i);
    if (close < 0) continue;
    const startLine = lineOf(text, m.index);
    const endLine = lineOf(text, close);
    if (endLine > startLine) out.push({ startLine, endLine });
    re.lastIndex = close + 1;
  }
  return out;
}
