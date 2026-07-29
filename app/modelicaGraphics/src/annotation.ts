// Modelica の annotation 値（number / string / array / call / identifier）の
// 簡易パーサと、パース結果（call ノード）から描画プリミティブへの変換。
// 表示専用の抽出のみで、副作用・書き込みは持たない。
// クラス/レイヤの抽出（宣言部の走査）は layers.ts が担う。
//
// 参照実装: Orbis app/src/features/modelica-browser/logic/graphics-annotation-parser.ts
//
// 文字取り出しに s[i] ではなく s.charAt(i) を使うのは、範囲外で undefined ではなく
// "" が返り、以降の比較・正規表現がそのまま成り立つため（noUncheckedIndexedAccess 対応）。

import type {
  BorderPattern,
  Extent,
  FillPattern,
  GraphicPrimitive,
  LinePattern,
  Vec2,
} from "./types";

/** annotation 値のパース結果ノード。 */
export type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "id"; name: string }
  | { kind: "array"; items: Node[] }
  | { kind: "call"; name: string; positional: Node[]; named: Map<string, Node> };

/** Modelica annotation 式の簡易パーサ。 */
export class ValueParser {
  private i = 0;
  private readonly s: string;

  constructor(source: string) {
    this.s = source;
  }

  /** 現在の読み取り位置。 */
  get pos(): number {
    return this.i;
  }

  private atEnd(): boolean {
    return this.i >= this.s.length;
  }

  private ws(): void {
    for (;;) {
      const c = this.s.charAt(this.i);
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i += 1;
        continue;
      }
      // コメントは稀だが念のため飛ばす。
      if (c === "/" && this.s.charAt(this.i + 1) === "/") {
        while (!this.atEnd() && this.s.charAt(this.i) !== "\n") this.i += 1;
        continue;
      }
      if (c === "/" && this.s.charAt(this.i + 1) === "*") {
        this.i += 2;
        while (
          !this.atEnd() &&
          !(this.s.charAt(this.i) === "*" && this.s.charAt(this.i + 1) === "/")
        ) {
          this.i += 1;
        }
        this.i += 2;
        continue;
      }
      break;
    }
  }

  parseValue(): Node | null {
    this.ws();
    if (this.atEnd()) return null;
    const c = this.s.charAt(this.i);
    if (c === "{") return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) {
      return this.parseNumber();
    }
    if (/[A-Za-z_]/.test(c)) return this.parseIdentifierOrCall();
    return null;
  }

  private parseArray(): Node {
    this.i += 1; // {
    const items: Node[] = [];
    this.ws();
    if (this.s.charAt(this.i) === "}") {
      this.i += 1;
      return { kind: "array", items };
    }
    for (;;) {
      const value = this.parseValue();
      if (value) items.push(value);
      this.ws();
      if (this.atEnd()) break;
      const ch = this.s.charAt(this.i);
      if (ch === ",") {
        this.i += 1;
        continue;
      }
      if (ch === "}") {
        this.i += 1;
        break;
      }
      // 予期しない文字はスキップして破綻を避ける。
      this.i += 1;
    }
    return { kind: "array", items };
  }

  private parseString(): Node {
    this.i += 1; // 開き引用符
    let value = "";
    for (;;) {
      if (this.atEnd()) break;
      const ch = this.s.charAt(this.i);
      if (ch === "\\") {
        value += decodeEscape(this.s.charAt(this.i + 1));
        this.i += 2;
        continue;
      }
      if (ch === '"') {
        this.i += 1;
        break;
      }
      value += ch;
      this.i += 1;
    }
    return { kind: "str", value };
  }

  private parseNumber(): Node {
    const match = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.s.slice(this.i));
    if (!match) {
      this.i += 1;
      return { kind: "num", value: 0 };
    }
    this.i += match[0].length;
    return { kind: "num", value: Number(match[0]) };
  }

  private parseIdentifierOrCall(): Node {
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.s.slice(this.i));
    const name = match ? match[0] : "";
    this.i += name.length;
    this.ws();
    if (this.s.charAt(this.i) === "(") return this.parseCall(name);
    if (name === "true") return { kind: "bool", value: true };
    if (name === "false") return { kind: "bool", value: false };
    return { kind: "id", name };
  }

  private parseCall(name: string): Node {
    this.i += 1; // (
    const positional: Node[] = [];
    const named = new Map<string, Node>();
    this.ws();
    if (this.s.charAt(this.i) === ")") {
      this.i += 1;
      return { kind: "call", name, positional, named };
    }
    for (;;) {
      this.ws();
      const save = this.i;
      const key = this.tryReadNamedKey();
      if (key) {
        const value = this.parseValue();
        if (value) named.set(key, value);
      } else {
        this.i = save;
        const value = this.parseValue();
        if (value) positional.push(value);
      }
      this.ws();
      if (this.atEnd()) break;
      const ch = this.s.charAt(this.i);
      if (ch === ",") {
        this.i += 1;
        continue;
      }
      if (ch === ")") {
        this.i += 1;
        break;
      }
      this.i += 1;
    }
    return { kind: "call", name, positional, named };
  }

  /** `identifier =`（`==` は除く）を名前付き引数キーとして読む。 */
  private tryReadNamedKey(): string | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (!match) return null;
    let j = this.i + match[0].length;
    for (;;) {
      const c = this.s.charAt(j);
      if (c === " " || c === "\t" || c === "\n" || c === "\r") j += 1;
      else break;
    }
    if (this.s.charAt(j) === "=" && this.s.charAt(j + 1) !== "=") {
      this.i = j + 1;
      return match[0];
    }
    return null;
  }
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case '"':
      return '"';
    case "\\":
      return "\\";
    default:
      return ch;
  }
}

// ---------------------------------------------------------------------------
// Node からの値取り出しヘルパ
// ---------------------------------------------------------------------------

export function asNum(node: Node | undefined, fallback = 0): number {
  return node && node.kind === "num" ? node.value : fallback;
}

export function asStr(node: Node | undefined, fallback = ""): string {
  return node && node.kind === "str" ? node.value : fallback;
}

function asBool(node: Node | undefined, fallback = true): boolean {
  return node && node.kind === "bool" ? node.value : fallback;
}

function asId(node: Node | undefined): string {
  return node && node.kind === "id" ? node.name : "";
}

export function asPoint(node: Node | undefined): Vec2 | null {
  if (!node || node.kind !== "array" || node.items.length < 2) return null;
  return [asNum(node.items[0]), asNum(node.items[1])];
}

export function asPoints(node: Node | undefined): Vec2[] {
  if (!node || node.kind !== "array") return [];
  const points: Vec2[] = [];
  for (const item of node.items) {
    const point = asPoint(item);
    if (point) points.push(point);
  }
  return points;
}

export function asExtent(node: Node | undefined): Extent | null {
  if (!node || node.kind !== "array" || node.items.length < 2) return null;
  const a = asPoint(node.items[0]);
  const b = asPoint(node.items[1]);
  if (!a || !b) return null;
  return [a, b];
}

export function asColor(node: Node | undefined): string | null {
  if (!node || node.kind !== "array" || node.items.length < 3) return null;
  const r = clampByte(asNum(node.items[0]));
  const g = clampByte(asNum(node.items[1]));
  const b = clampByte(asNum(node.items[2]));
  return `rgb(${r}, ${g}, ${b})`;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// ---------------------------------------------------------------------------
// call → プリミティブ変換
// ---------------------------------------------------------------------------

function baseOf(named: Map<string, Node>) {
  return {
    origin: asPoint(named.get("origin")) ?? ([0, 0] as Vec2),
    rotation: asNum(named.get("rotation")),
    visible: asBool(named.get("visible"), true),
  };
}

/** annotation の call ノード（Line/Rectangle/Ellipse/Polygon/Text）を描画プリミティブへ変換する。 */
export function toPrimitive(node: Node): GraphicPrimitive | null {
  if (node.kind !== "call") return null;
  const n = node.named;
  const base = baseOf(n);
  const leaf = node.name.split(".").at(-1);

  switch (leaf) {
    case "Line": {
      return {
        ...base,
        type: "line",
        points: asPoints(n.get("points")),
        color: asColor(n.get("color")) ?? "rgb(0, 0, 0)",
        pattern: linePatternLeaf(n.get("pattern")),
        thickness: asNum(n.get("thickness"), 0.25),
        smooth: asId(n.get("smooth")).endsWith("Bezier"),
        arrow: readArrow(n.get("arrow")),
        arrowSize: asNum(n.get("arrowSize"), 3),
      };
    }
    case "Rectangle": {
      const extent = asExtent(n.get("extent"));
      if (!extent) return null;
      const fill = fillOf(n);
      return {
        ...base,
        type: "rectangle",
        extent,
        lineColor: asColor(n.get("lineColor")) ?? "rgb(0, 0, 0)",
        linePattern: linePatternLeaf(n.get("pattern")),
        fillColor: fill.color,
        fillPattern: fill.pattern,
        lineThickness: asNum(n.get("lineThickness"), 0.25),
        borderPattern: borderPatternLeaf(n.get("borderPattern")),
        radius: asNum(n.get("radius")),
      };
    }
    case "Ellipse": {
      const extent = asExtent(n.get("extent"));
      if (!extent) return null;
      const fill = fillOf(n);
      return {
        ...base,
        type: "ellipse",
        extent,
        lineColor: asColor(n.get("lineColor")) ?? "rgb(0, 0, 0)",
        linePattern: linePatternLeaf(n.get("pattern")),
        fillColor: fill.color,
        fillPattern: fill.pattern,
        lineThickness: asNum(n.get("lineThickness"), 0.25),
      };
    }
    case "Polygon": {
      const points = asPoints(n.get("points"));
      if (points.length < 2) return null;
      const fill = fillOf(n);
      return {
        ...base,
        type: "polygon",
        points,
        lineColor: asColor(n.get("lineColor")) ?? "rgb(0, 0, 0)",
        linePattern: linePatternLeaf(n.get("pattern")),
        fillColor: fill.color,
        fillPattern: fill.pattern,
        lineThickness: asNum(n.get("lineThickness"), 0.25),
        smooth: asId(n.get("smooth")).endsWith("Bezier"),
      };
    }
    case "Text": {
      const extent = asExtent(n.get("extent"));
      if (!extent) return null;
      const style = readTextStyle(n.get("textStyle"));
      return {
        ...base,
        type: "text",
        extent,
        textString: asStr(n.get("textString")) || asStr(n.get("string")),
        color:
          asColor(n.get("textColor")) ?? asColor(n.get("lineColor")) ?? "rgb(0, 0, 0)",
        fontSize: asNum(n.get("fontSize")),
        fontName: asStr(n.get("fontName")),
        horizontalAlignment: readAlignment(n.get("horizontalAlignment")),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
      };
    }
    default:
      // Bitmap などは未対応（表示専用のため）。
      return null;
  }
}

const FILL_PATTERNS: ReadonlySet<string> = new Set([
  "None",
  "Solid",
  "Horizontal",
  "Vertical",
  "Cross",
  "Forward",
  "Backward",
  "CrossDiag",
  "HorizontalCylinder",
  "VerticalCylinder",
  "Sphere",
]);

const LINE_PATTERNS: ReadonlySet<string> = new Set([
  "None",
  "Solid",
  "Dash",
  "Dot",
  "DashDot",
  "DashDotDot",
]);

const BORDER_PATTERNS: ReadonlySet<string> = new Set([
  "None",
  "Raised",
  "Sunken",
  "Engraved",
]);

function fillPatternLeaf(node: Node | undefined): FillPattern {
  const leaf = asId(node).split(".").at(-1) ?? "";
  return (FILL_PATTERNS.has(leaf) ? leaf : "None") as FillPattern;
}

function linePatternLeaf(node: Node | undefined): LinePattern {
  const leaf = asId(node).split(".").at(-1) ?? "";
  return (LINE_PATTERNS.has(leaf) ? leaf : "Solid") as LinePattern;
}

function borderPatternLeaf(node: Node | undefined): BorderPattern {
  const leaf = asId(node).split(".").at(-1) ?? "";
  return (BORDER_PATTERNS.has(leaf) ? leaf : "None") as BorderPattern;
}

/**
 * fillColor と fillPattern を取り出す。fillPattern 未指定でも fillColor が
 * あれば Solid 塗り扱いにする（多くのアイコンで塗り前提のため）。
 */
function fillOf(named: Map<string, Node>): {
  color: string | null;
  pattern: FillPattern;
} {
  const patternNode = named.get("fillPattern");
  const pattern: FillPattern = patternNode
    ? fillPatternLeaf(patternNode)
    : named.has("fillColor")
      ? "Solid"
      : "None";
  if (pattern === "None") return { color: null, pattern: "None" };
  return { color: asColor(named.get("fillColor")) ?? "rgb(0, 0, 0)", pattern };
}

function readArrow(node: Node | undefined): [string, string] {
  if (!node || node.kind !== "array") return ["None", "None"];
  return [asId(node.items[0]) || "None", asId(node.items[1]) || "None"];
}

function readTextStyle(node: Node | undefined): {
  bold: boolean;
  italic: boolean;
  underline: boolean;
} {
  if (!node || node.kind !== "array") {
    return { bold: false, italic: false, underline: false };
  }
  const ids = node.items.map((item) => asId(item));
  return {
    bold: ids.some((id) => id.endsWith("Bold")),
    italic: ids.some((id) => id.endsWith("Italic")),
    underline: ids.some((id) => id.endsWith("UnderLine") || id.endsWith("Underline")),
  };
}

function readAlignment(node: Node | undefined): "left" | "center" | "right" {
  const name = asId(node);
  if (name.endsWith("Left")) return "left";
  if (name.endsWith("Right")) return "right";
  return "center";
}
