// modelicaGraphics — Modelica のグラフィカルアノテーション解析と SVG 描画の共通パッケージ。
// vscode 非依存・依存ゼロ。VS Code 拡張や他ツールから再利用する。
// ビルドは拡張本体と同じ app/tsconfig.json が担当し、app/out/modelicaGraphics/ へ出力される。

export {
  // 低レベル解析
  matchParen,
  matchBracket,
  parseNumberArray,
  extractBraceValue,
  // NumArray → 具体形
  toPoint,
  toPoints,
  toExtent,
  toRgb,
} from "./src/parse";

export type { NumArray, Point, Extent, Rgb, CoordExtent } from "./src/parse";

export {
  // ダイアグラム（モデル構成）
  parseDiagramExtent,
  parseComponentPlacements,
  parseConnections,
  buildDiagramSvg,
  esc,
  rgb,
} from "./src/diagram";

export type {
  ComponentRef,
  Placement,
  Connection,
  DiagramOptions,
} from "./src/diagram";

export {
  // アイコン（Icon 図形）
  parseValue,
  parseIcon,
  parseExtends,
  extractIconBody,
  iconCoordSystem,
  iconGraphics,
  renderIcon,
} from "./src/icon";

export type {
  AnnValue,
  AnnEnum,
  AnnRecord,
  IconDef,
  IconBox,
  IconTransform,
  IconContext,
} from "./src/icon";
