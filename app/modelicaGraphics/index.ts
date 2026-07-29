// modelicaGraphics — Modelica のグラフィカルアノテーション解析と SVG 描画の共通パッケージ。
// vscode 非依存・依存ゼロ。VS Code 拡張や他ツールから再利用する。
// ビルドは拡張本体と同じ app/tsconfig.json が担当し、app/out/modelicaGraphics/ へ出力される。
//
// 解析・描画のモデルは Orbis（ref/Orbis）の modelica-browser 実装から移植している。
// - types.ts       … Icon / Diagram の図形モデル（FillPattern / LinePattern / 矢印など）
// - annotation.ts  … annotation 値パーサと call → プリミティブ変換
// - layers.ts      … クラス本体の走査、Icon / Diagram レイヤ・配置・接続の抽出
// - inheritance.ts … extends を辿った Icon 合成とポート収集
// - render.ts      … プリミティブ / ダイアグラムの SVG 文字列描画

export type {
  Vec2,
  Extent,
  GraphicBase,
  FillPattern,
  LinePattern,
  BorderPattern,
  LinePrimitive,
  RectanglePrimitive,
  EllipsePrimitive,
  PolygonPrimitive,
  TextPrimitive,
  GraphicPrimitive,
  DiagramComponent,
  DiagramConnection,
  GraphicsLayer,
  DiagramLayer,
} from "./src/types";

export { DEFAULT_EXTENT } from "./src/types";

export {
  ValueParser,
  asNum,
  asStr,
  asPoint,
  asPoints,
  asExtent,
  asColor,
  toPrimitive,
} from "./src/annotation";
export type { Node } from "./src/annotation";

export {
  parseOwnIconGraphics,
  parseOwnDiagramGraphics,
  parseDiagramLayer,
  parseIconComponents,
  extractExtendsTypeNames,
  sliceNamedClass,
  isConnectorLikeType,
} from "./src/layers";
export type { PlacementLayer } from "./src/layers";

export {
  buildInheritedIconLayer,
  collectInheritedIconComponents,
} from "./src/inheritance";
export type { ClassTextResolver, ScopedIconComponent } from "./src/inheritance";

export {
  SELECT_COLOR,
  esc,
  normalizeExtent,
  pointsToPath,
  smoothPath,
  strokeWidthPx,
  iconMapTransform,
  renderPrimitive,
  renderComponentIcon,
  buildDiagramSvg,
} from "./src/render";
export type {
  FlipSigns,
  IconMap,
  NodeIcon,
  DiagramSvgOptions,
  DiagramSvgResult,
} from "./src/render";
