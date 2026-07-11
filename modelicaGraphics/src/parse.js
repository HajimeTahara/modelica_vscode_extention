// Modelica アノテーション式の低レベル解析ヘルパー（依存なし・自己完結）。
// 数値配列・中括弧値の抽出、文字列アウェアなカッコ対応など、上位（icon/diagram）から使う。

/** openIdx の '(' に対応する ')' の位置を返す（文字列リテラルを無視）。無ければ -1。 */
function matchParen(text, openIdx) {
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

/** open で開く括弧（'(' か '{'）に対応する閉じ括弧位置を返す（文字列無視）。無ければ -1。 */
function matchBracket(text, openIdx) {
  const open = text[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
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
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** "{{1,2},{3,4}}" のような Modelica 数値配列（ネスト可）をパースする。 */
function parseNumberArray(s) {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  function val() {
    ws();
    if (s[i] === "{") {
      i++;
      const arr = [];
      ws();
      if (s[i] === "}") {
        i++;
        return arr;
      }
      while (i < s.length) {
        arr.push(val());
        ws();
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "}") {
          i++;
          break;
        }
        break;
      }
      return arr;
    }
    let j = i;
    while (j < s.length && /[-+0-9.eE]/.test(s[j])) j++;
    const n = parseFloat(s.slice(i, j));
    i = j;
    return n;
  }
  return val();
}

/** str の "key = { … }" の中括弧値を（ネスト対応で）そのまま返す。無ければ null。 */
function extractBraceValue(str, key) {
  const m = new RegExp("\\b" + key + "\\s*=\\s*").exec(str);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (str[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

module.exports = {
  matchParen,
  matchBracket,
  parseNumberArray,
  extractBraceValue,
};
