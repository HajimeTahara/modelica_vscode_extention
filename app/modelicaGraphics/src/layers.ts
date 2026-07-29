// Modelica ソースからクラス本体（宣言部 / equation 部）を走査し、
// Icon / Diagram レイヤ・コンポーネント配置・接続線を抽出する。表示専用。
//
// 参照実装: Orbis app/src/features/modelica-browser/modelica-graphics.ts
//
// 文字取り出しに source[i] ではなく source.charAt(i) を使うのは、範囲外で
// undefined ではなく "" が返り、以降の比較・正規表現がそのまま成り立つため。

import {
  ValueParser,
  asColor,
  asExtent,
  asNum,
  asPoint,
  asPoints,
  toPrimitive,
  type Node,
} from "./annotation";
import { DEFAULT_EXTENT } from "./types";
import type {
  DiagramComponent,
  DiagramConnection,
  DiagramLayer,
  Extent,
  GraphicPrimitive,
  Vec2,
} from "./types";

/** クラス見出しに使われるキーワード（`|` 区切り。正規表現へ直接埋める）。 */
const CLASS_KEYWORDS =
  "model|block|class|connector|record|package|type|function|operator|expandable";

const CLASS_KEYWORD_LIST = CLASS_KEYWORDS.split("|");

// ---------------------------------------------------------------------------
// 低レベル走査（コメント・文字列を無視したブラケット対応など）
// ---------------------------------------------------------------------------

function isIdentChar(ch: string): boolean {
  return ch !== "" && /[A-Za-z0-9_.]/.test(ch);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** index の `"` から始まる文字列リテラルの直後位置を返す。 */
function skipQuotedString(source: string, index: number): number {
  let i = index + 1;
  while (i < source.length) {
    if (source.charAt(i) === "\\") {
      i += 2;
      continue;
    }
    if (source.charAt(i) === '"') return i + 1;
    i += 1;
  }
  return i;
}

/** index がコメント / 文字列リテラルの開始ならその直後位置、そうでなければ index。 */
function skipModelicaTrivia(source: string, index: number): number {
  const c = source.charAt(index);
  const next = source.charAt(index + 1);
  if (c === "/" && next === "/") {
    let i = index + 2;
    while (i < source.length && source.charAt(i) !== "\n") i += 1;
    return i;
  }
  if (c === "/" && next === "*") {
    let i = index + 2;
    while (i + 1 < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
      i += 1;
    }
    return Math.min(i + 2, source.length);
  }
  if (c === '"') return skipQuotedString(source, index);
  return index;
}

/** openIndex の開き括弧に対応する閉じ括弧位置（コメント・文字列は無視）。無ければ -1。 */
function matchBracket(source: string, openIndex: number, end = source.length): number {
  let depth = 0;
  let i = openIndex;
  while (i < end) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function readIdentifier(source: string, index: number): { text: string; end: number } | null {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
  if (!match) return null;
  return { text: match[0], end: index + match[0].length };
}

function findTopLevelSemicolon(source: string, start: number, end = source.length): number {
  let depth = 0;
  let i = start;
  while (i < end) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === ";" && depth === 0) return i;
    i += 1;
  }
  return -1;
}

interface ClassRange {
  start: number;
  headerEnd: number;
  endKeyword: number;
  classEnd: number;
  shortDefinition: boolean;
}

/**
 * index がコメント / 文字列リテラルの内側でないこと（＝コードとして有効な位置）を判定する。
 * クラス見出しを正規表現で探すと `// model Foo` のようなコメント内の記述にも当たるため、
 * 当たった位置がコードかどうかをここで確かめる。
 */
function isCodePosition(source: string, index: number): boolean {
  let i = 0;
  while (i < index) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped === i) {
      i += 1;
      continue;
    }
    // index を跨いで読み飛ばされた = index はコメント / 文字列の内側。
    if (skipped > index) return false;
    i = skipped;
  }
  return true;
}

function findClassRange(source: string, simpleName?: string): ClassRange | null {
  const name = simpleName ? escapeRegExp(simpleName) : "[A-Za-z_][A-Za-z0-9_]*";
  const headRe = new RegExp(`\\b(?:${CLASS_KEYWORDS})\\s+(${name})\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = headRe.exec(source)) !== null) {
    const className = match[1] ?? "";
    if (!className) continue;
    if (simpleName && className !== simpleName) continue;
    if (!isCodePosition(source, match.index)) continue;
    const headerEnd = match.index + match[0].length;
    const endRe = new RegExp(`\\bend\\s+${escapeRegExp(className)}\\s*;`);
    const endMatch = endRe.exec(source.slice(headerEnd));
    if (endMatch) {
      const endKeyword = headerEnd + endMatch.index;
      return {
        start: match.index,
        headerEnd,
        endKeyword,
        classEnd: endKeyword + endMatch[0].length,
        shortDefinition: false,
      };
    }

    const semicolon = findTopLevelSemicolon(source, headerEnd);
    if (semicolon >= 0) {
      return {
        start: match.index,
        headerEnd,
        endKeyword: semicolon,
        classEnd: semicolon + 1,
        shortDefinition: true,
      };
    }
  }
  return null;
}

function startsWithKeyword(source: string, index: number, keyword: string): boolean {
  return (
    source.startsWith(keyword, index) &&
    !isIdentChar(index > 0 ? source.charAt(index - 1) : "") &&
    !isIdentChar(source.charAt(index + keyword.length))
  );
}

function startsWithClassKeyword(source: string, index: number): boolean {
  return CLASS_KEYWORD_LIST.some((keyword) => startsWithKeyword(source, index, keyword));
}

/** index のネストしたクラス定義を読み飛ばした位置を返す（クラスでなければ index）。 */
function skipNestedClass(source: string, index: number, end: number): number {
  const keyword = readIdentifier(source, index);
  if (!keyword || !CLASS_KEYWORD_LIST.includes(keyword.text)) return index;
  let nameStart = keyword.end;
  while (nameStart < end && /\s/.test(source.charAt(nameStart))) nameStart += 1;
  const name = readIdentifier(source, nameStart);
  if (!name) return index;

  const classRange = findClassRange(source.slice(index, end), name.text);
  if (classRange) return index + classRange.classEnd;

  const semicolon = findTopLevelSemicolon(source, name.end, end);
  return semicolon >= 0 ? semicolon + 1 : index;
}

function previousNonWhitespace(source: string, index: number, min: number): number {
  let i = index - 1;
  while (i >= min && /\s/.test(source.charAt(i))) i -= 1;
  return i;
}

// ---------------------------------------------------------------------------
// annotation からレイヤ（Icon / Diagram）を取り出す
// ---------------------------------------------------------------------------

function parseCallAt(source: string, index: number): Node | null {
  const parser = new ValueParser(source.slice(index));
  const node = parser.parseValue();
  return node && node.kind === "call" ? node : null;
}

function findCallInRange(source: string, start: number, end: number, name: string): Node | null {
  let i = start;
  while (i < end) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (
      source.startsWith(name, i) &&
      !isIdentChar(i > 0 ? source.charAt(i - 1) : "") &&
      !isIdentChar(source.charAt(i + name.length))
    ) {
      let open = i + name.length;
      while (open < end && /\s/.test(source.charAt(open))) open += 1;
      if (source.charAt(open) === "(") return parseCallAt(source, i);
    }
    i += 1;
  }
  return null;
}

/**
 * 選択クラス直下の class-level annotation から Icon / Diagram call を探す。
 * package.mo など 1 ファイルに複数クラスが入る場合、子クラスの annotation は除外する。
 */
function findLayerCall(source: string, name: string): Node | null {
  const range = findClassRange(source);
  if (!range) return findCallInRange(source, 0, source.length, name);

  // クラス宣言直後の説明文字列（class description）の閉じ引用符の位置。
  // `block Foo "desc" annotation(...)` のように、本体を持たず説明文の直後に
  // クラスレベル annotation が来る場合、prev がこの閉じ引用符を指す。これを
  // クラスレベルの目印として許可する（コンポーネント宣言の説明文とは位置で区別）。
  let classDescClose = -1;
  {
    let p = range.headerEnd;
    while (p < range.endKeyword && /\s/.test(source.charAt(p))) p += 1;
    if (source.charAt(p) === '"') classDescClose = skipQuotedString(source, p) - 1;
  }

  let depth = 0;
  let i = range.headerEnd;
  while (i < range.endKeyword) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (depth === 0 && startsWithClassKeyword(source, i)) {
      const next = skipNestedClass(source, i, range.endKeyword);
      if (next !== i) {
        i = next;
        continue;
      }
    }

    if (depth === 0 && startsWithKeyword(source, i, "annotation")) {
      let open = i + "annotation".length;
      while (open < range.endKeyword && /\s/.test(source.charAt(open))) open += 1;
      if (source.charAt(open) === "(") {
        const prev = previousNonWhitespace(source, i, range.headerEnd);
        const classLevel =
          range.shortDefinition ||
          prev < range.headerEnd ||
          prev === classDescClose ||
          source.charAt(prev) === ";";
        const close = matchBracket(source, open, range.endKeyword);
        if (classLevel && close >= 0) {
          const layer = findCallInRange(source, open + 1, close, name);
          if (layer) return layer;
        }
        if (close >= 0) {
          i = close + 1;
          continue;
        }
      }
    }

    const ch = source.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    i += 1;
  }
  return null;
}

/** coordinateSystem(extent=...) を取り出す。未指定なら null。 */
function nullableExtentFromCoordinateSystem(call: Node): Extent | null {
  if (call.kind !== "call") return null;
  // `coordinateSystem(extent=...)` は名前付き引数ではなく、記録修飾
  // （位置引数扱いの call）として現れることがあるため両方を探す。
  const cs =
    call.named.get("coordinateSystem") ??
    call.positional.find(
      (node) => node.kind === "call" && node.name.endsWith("coordinateSystem")
    );
  if (cs && cs.kind === "call") return asExtent(cs.named.get("extent"));
  return null;
}

function primitivesFromGraphics(call: Node): GraphicPrimitive[] {
  if (call.kind !== "call") return [];
  const graphics = call.named.get("graphics");
  if (!graphics || graphics.kind !== "array") return [];
  const primitives: GraphicPrimitive[] = [];
  for (const item of graphics.items) {
    const primitive = toPrimitive(item);
    if (primitive && primitive.visible) primitives.push(primitive);
  }
  return primitives;
}

/**
 * Icon の図形と coordinateSystem を、そのクラス自身の宣言分だけ抽出する。
 * extent は未指定なら null（継承側で基底の extent を使えるようにする）。
 */
export function parseOwnIconGraphics(source: string): {
  extent: Extent | null;
  primitives: GraphicPrimitive[];
} {
  const call = findLayerCall(source, "Icon");
  if (!call) return { extent: null, primitives: [] };
  return {
    extent: nullableExtentFromCoordinateSystem(call),
    primitives: primitivesFromGraphics(call),
  };
}

/** Diagram の図形と coordinateSystem を、そのクラス自身の宣言分だけ抽出する。 */
export function parseOwnDiagramGraphics(source: string): {
  extent: Extent | null;
  primitives: GraphicPrimitive[];
} {
  const call = findLayerCall(source, "Diagram");
  if (!call) return { extent: null, primitives: [] };
  return {
    extent: nullableExtentFromCoordinateSystem(call),
    primitives: primitivesFromGraphics(call),
  };
}

/** Diagram レイヤ（自前の graphics ＋ コンポーネント配置 ＋ 接続線）を抽出する。 */
export function parseDiagramLayer(source: string): DiagramLayer {
  const call = findLayerCall(source, "Diagram");
  const extent =
    (call ? nullableExtentFromCoordinateSystem(call) : null) ?? DEFAULT_EXTENT;
  return {
    extent,
    primitives: call ? primitivesFromGraphics(call) : [],
    components: extractComponents(source),
    connections: extractConnections(source),
  };
}

/**
 * 複数クラスを含み得るファイル本文から、単純名 simpleName のクラス定義本体を
 * 切り出す（`end <simpleName>;` まで）。見つからなければ null。
 */
export function sliceNamedClass(source: string, simpleName: string): string | null {
  if (!simpleName) return null;
  const range = findClassRange(source, simpleName);
  return range ? source.slice(range.start, range.classEnd) : null;
}

/**
 * クラス本体の `extends <型名> ... ;` から基底クラスの型名を列挙する。
 * 条件付き extends の細部までは解釈しない。
 */
export function extractExtendsTypeNames(source: string): string[] {
  const names: string[] = [];
  for (const statement of splitStatements(sliceClassBody(source).declarations)) {
    const match = /(^|\s)extends\s+([A-Za-z_][A-Za-z0-9_.]*)/.exec(statement);
    if (match && match[2]) names.push(match[2]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// クラス本体の分割
// ---------------------------------------------------------------------------

/** トップレベル `;` で文を分割（括弧・波括弧・文字列内の `;` は無視）。 */
function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i);
    if (inString) {
      current += ch;
      if (ch === "\\") {
        current += body.charAt(i + 1);
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === ";" && depth === 0) {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

/** ネストしたクラス定義を同じ長さの空白へ置き換える（位置を保ったまま除外する）。 */
function stripNestedClasses(body: string): string {
  let result = "";
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < body.length) {
    const skipped = skipModelicaTrivia(body, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (depth === 0 && startsWithClassKeyword(body, i)) {
      const next = skipNestedClass(body, i, body.length);
      if (next !== i) {
        result += body.slice(last, i);
        result += " ".repeat(next - i);
        i = next;
        last = next;
        continue;
      }
    }
    const ch = body.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    i += 1;
  }
  return result + body.slice(last);
}

/**
 * クラス見出し直後の説明文字列（`model Foo "説明"`）とコメントを読み飛ばし、
 * composition（宣言部）の開始位置を返す。
 *
 * 読み飛ばさないと説明文字列が先頭の宣言と同じ「文」に含まれてしまい、
 * componentDeclaration が先頭の文字列以降を捨てる結果、先頭コンポーネントが
 * Diagram / Icon から丸ごと欠落する。
 */
function skipClassDescription(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    // コメントと説明文字列（`"a" + "b"` の連結も含む）だけを読み飛ばす。
    if (ch === "/" && (source.charAt(i + 1) === "/" || source.charAt(i + 1) === "*")) {
      i = skipModelicaTrivia(source, i);
      continue;
    }
    if (ch === '"') {
      i = skipQuotedString(source, i);
      continue;
    }
    if (ch === "+") {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

/** クラス本体（宣言部）と equation 部をおおまかに切り出す。 */
function sliceClassBody(source: string): { declarations: string; equations: string } {
  const range = findClassRange(source);
  const start = range ? skipClassDescription(source, range.headerEnd) : 0;
  const end = range ? range.endKeyword : source.length;
  const rest = stripNestedClasses(source.slice(start, end));
  const eqMatch = /\n\s*(equation|algorithm)\b/.exec(rest);
  if (eqMatch) {
    return {
      declarations: rest.slice(0, eqMatch.index),
      equations: rest.slice(eqMatch.index + eqMatch[0].length),
    };
  }
  return { declarations: rest, equations: "" };
}

// ---------------------------------------------------------------------------
// コンポーネント宣言
// ---------------------------------------------------------------------------

const KEYWORD_PREFIXES: ReadonlySet<string> = new Set([
  "parameter",
  "constant",
  "input",
  "output",
  "flow",
  "stream",
  "discrete",
  "final",
  "inner",
  "outer",
  "replaceable",
  "redeclare",
  "each",
  "protected",
  "public",
]);

/** 配置を読むレイヤ。icon は iconTransformation を優先する。 */
export type PlacementLayer = "diagram" | "icon";

/** 型名がコネクタらしい（ポートとして扱ってよい）か。 */
export function isConnectorLikeType(typeName: string): boolean {
  const leaf = typeName.split(".").at(-1) ?? typeName;
  return /(Input|Output|Port|Pin|Plug|Socket|Flange|Frame|Support|Axis)$/i.test(leaf);
}

function findTopLevelKeyword(source: string, keyword: string): number {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (depth === 0 && startsWithKeyword(source, i, keyword)) return i;
    i += 1;
  }
  return -1;
}

function findTopLevelString(source: string): number {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '"') {
      if (depth === 0) return i;
      i = skipQuotedString(source, i);
      continue;
    }
    if (ch === "/" && (source.charAt(i + 1) === "/" || source.charAt(i + 1) === "*")) {
      i = skipModelicaTrivia(source, i);
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    i += 1;
  }
  return -1;
}

function stripDeclarationComment(source: string): string {
  const stringStart = findTopLevelString(source);
  return stringStart >= 0 ? source.slice(0, stringStart) : source;
}

function componentDeclaration(statement: string): {
  name: string;
  typeName: string;
  condition: string | null;
} | null {
  const head = statement.split(/\bannotation\b/)[0] ?? "";
  const withoutComment = stripDeclarationComment(head);
  const ifIndex = findTopLevelKeyword(withoutComment, "if");
  const declaration = (ifIndex >= 0 ? withoutComment.slice(0, ifIndex) : withoutComment)
    .replace(/\[[^\]]*\]/g, " ")
    .trim();
  const condition =
    ifIndex >= 0 ? withoutComment.slice(ifIndex + "if".length).trim() || null : null;
  const beforeModifier = declaration.split("(")[0] ?? declaration;
  const tokens = beforeModifier
    .replace(/\bextends\b[\s\S]*/, "")
    .split(/[^A-Za-z0-9_.]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !KEYWORD_PREFIXES.has(token) && token !== "package");
  if (tokens.length < 2) return null;
  const name = tokens[tokens.length - 1] ?? "";
  const typeName = tokens[tokens.length - 2] ?? "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return { name, typeName, condition };
}

// ---------------------------------------------------------------------------
// 条件付きコンポーネント（`Foo x if cond`）の Boolean 評価
// ---------------------------------------------------------------------------

function findTopLevelEquals(source: string): number {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const skipped = skipModelicaTrivia(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source.charAt(i);
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "=" && depth === 0) {
      const prev = i > 0 ? source.charAt(i - 1) : "";
      const next = source.charAt(i + 1);
      if (prev !== "=" && prev !== "<" && prev !== ">" && prev !== "!" && next !== "=") {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

function parseBooleanParameter(
  statement: string
): { name: string; value: boolean | null } | null {
  const head = stripDeclarationComment(statement.split(/\bannotation\b/)[0] ?? "");
  if (!/\bparameter\b/.test(head) || !/\bBoolean\b/.test(head)) return null;
  const match =
    /(?:^|[\s;])(?:final\s+)?parameter\s+Boolean\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[[^\]]*\])?/.exec(
      head
    );
  if (!match || !match[1]) return null;
  const name = match[1];
  const afterName = head.slice(match.index + match[0].length);
  const eqIndex = findTopLevelEquals(afterName);
  if (eqIndex < 0) return { name, value: null };
  const raw = afterName.slice(eqIndex + 1).trim();
  return { name, value: evaluateBooleanExpression(raw, new Map()) };
}

function booleanParameterDefaults(declarations: string): Map<string, boolean | null> {
  const defaults = new Map<string, boolean | null>();
  for (const statement of splitStatements(declarations)) {
    const def = parseBooleanParameter(statement);
    if (def) defaults.set(def.name, def.value);
  }
  return defaults;
}

type BoolToken =
  | { kind: "id"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "op"; value: "and" | "or" | "not" }
  | { kind: "paren"; value: "(" | ")" };

function tokenizeBooleanExpression(source: string): BoolToken[] | null {
  const tokens: BoolToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i += 1;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i));
    if (!match) return null;
    const word = match[0];
    if (word === "true" || word === "false") {
      tokens.push({ kind: "bool", value: word === "true" });
    } else if (word === "and" || word === "or" || word === "not") {
      tokens.push({ kind: "op", value: word });
    } else {
      tokens.push({ kind: "id", value: word });
    }
    i += word.length;
  }
  return tokens;
}

/**
 * `cond` を Boolean パラメータの既定値で評価する。true/false が確定できなければ null
 * （不明な条件のコンポーネントは薄く表示せず、通常どおり描く）。
 */
function evaluateBooleanExpression(
  expression: string,
  defaults: Map<string, boolean | null>
): boolean | null {
  const tokens = tokenizeBooleanExpression(expression);
  if (!tokens || tokens.length === 0) return null;
  let index = 0;

  const peekOp = (value: "and" | "or"): boolean => {
    const token = tokens[index];
    return token !== undefined && token.kind === "op" && token.value === value;
  };

  const parsePrimary = (): boolean | null => {
    const token = tokens[index];
    if (!token) return null;
    if (token.kind === "bool") {
      index += 1;
      return token.value;
    }
    if (token.kind === "id") {
      index += 1;
      const leaf = token.value.split(".").at(-1) ?? token.value;
      if (defaults.has(token.value)) return defaults.get(token.value) ?? null;
      return defaults.get(leaf) ?? null;
    }
    if (token.kind === "op" && token.value === "not") {
      index += 1;
      const value = parsePrimary();
      return value == null ? null : !value;
    }
    if (token.kind === "paren" && token.value === "(") {
      index += 1;
      const value = parseOr();
      const close = tokens[index];
      if (close && close.kind === "paren" && close.value === ")") index += 1;
      return value;
    }
    return null;
  };

  const parseAnd = (): boolean | null => {
    let left = parsePrimary();
    while (peekOp("and")) {
      index += 1;
      const right = parsePrimary();
      if (left === false || right === false) left = false;
      else if (left === true && right === true) left = true;
      else left = null;
    }
    return left;
  };

  function parseOr(): boolean | null {
    let left = parseAnd();
    while (peekOp("or")) {
      index += 1;
      const right = parseAnd();
      if (left === true || right === true) left = true;
      else if (left === false && right === false) left = false;
      else left = null;
    }
    return left;
  }

  const result = parseOr();
  return index === tokens.length ? result : null;
}

// ---------------------------------------------------------------------------
// 配置・接続の抽出
// ---------------------------------------------------------------------------

function parseTransformation(
  statement: string,
  layer: PlacementLayer
): { extent: Extent; origin: Vec2 | null; rotation: number } | null {
  const idx = statement.search(/Placement\s*\(/);
  if (idx < 0) return null;
  const parser = new ValueParser(statement.slice(idx));
  const placement = parser.parseValue();
  if (!placement || placement.kind !== "call") return null;
  const pick = (key: string): Node | undefined =>
    placement.named.get(key) ??
    placement.positional.find((p) => p.kind === "call" && p.name.endsWith(key));
  // アイコンレイヤは iconTransformation 優先（無ければ transformation）。
  const transformation =
    layer === "icon"
      ? pick("iconTransformation") ?? pick("transformation")
      : pick("transformation") ?? pick("iconTransformation");
  if (!transformation || transformation.kind !== "call") return null;
  const extent = asExtent(transformation.named.get("extent"));
  if (!extent) return null;
  return {
    extent,
    origin: asPoint(transformation.named.get("origin")),
    rotation: asNum(transformation.named.get("rotation")),
  };
}

function extractComponents(
  source: string,
  layer: PlacementLayer = "diagram"
): DiagramComponent[] {
  const { declarations } = sliceClassBody(source);
  const defaults = booleanParameterDefaults(declarations);
  const components: DiagramComponent[] = [];

  for (const statement of splitStatements(declarations)) {
    if (!/Placement\s*\(/.test(statement)) continue;

    const declaration = componentDeclaration(statement);
    if (!declaration) continue;
    // アイコンレイヤでは iconTransformation を優先するが、MSL には conditional
    // connector で transformation だけを持つ宣言もある。コネクタらしい型、または
    // `if ...` 付き配置は transformation を icon 表示のフォールバックとして使う。
    if (
      layer === "icon" &&
      !/\biconTransformation\b/.test(statement) &&
      !declaration.condition &&
      !isConnectorLikeType(declaration.typeName)
    ) {
      continue;
    }

    const transform = parseTransformation(statement, layer);
    if (!transform) continue;
    components.push({
      name: declaration.name,
      typeName: declaration.typeName,
      condition: declaration.condition,
      conditionDefault: declaration.condition
        ? evaluateBooleanExpression(declaration.condition, defaults)
        : null,
      ...transform,
    });
  }

  return components;
}

/**
 * アイコンビューに表示すべき配置済みコンポーネント（コネクタ等、
 * iconTransformation を持つ宣言）を抽出する。座標はアイコン座標系。
 */
export function parseIconComponents(source: string): DiagramComponent[] {
  return extractComponents(source, "icon");
}

function extractConnections(source: string): DiagramConnection[] {
  const { equations } = sliceClassBody(source);
  const connections: DiagramConnection[] = [];

  for (const statement of splitStatements(equations)) {
    if (!/\bconnect\s*\(/.test(statement)) continue;
    const connectMatch = /\bconnect\s*\(([^)]*)\)/.exec(statement);
    if (!connectMatch) continue;
    const endpoints = (connectMatch[1] ?? "").split(",").map((s) => s.trim());

    let points: Vec2[] = [];
    let color: string | null = "rgb(0, 0, 0)";
    const lineIdx = statement.search(/\bLine\s*\(/);
    if (lineIdx >= 0) {
      const line = new ValueParser(statement.slice(lineIdx)).parseValue();
      if (line && line.kind === "call") {
        points = asPoints(line.named.get("points"));
        color = asColor(line.named.get("color")) ?? color;
      }
    }
    connections.push({
      from: endpoints[0] ?? "",
      to: endpoints[1] ?? "",
      points,
      color,
    });
  }

  return connections;
}
