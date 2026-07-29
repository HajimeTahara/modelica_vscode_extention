// Modelica の図形アノテーション（Icon / Diagram）に関する型定義のみを集約する。
// 解析は layers.ts（クラス/レイヤ抽出）と annotation.ts（annotation 値パーサ）、
// 描画は render.ts が担う。
//
// 参照実装: Orbis app/src/features/modelica-browser/modelica-graphics-types.ts

/** Modelica の 2 次元点 {x, y}。 */
export type Vec2 = [number, number];

/** Modelica の extent {{x1,y1},{x2,y2}}。 */
export type Extent = [Vec2, Vec2];

/** すべての図形が持つ共通の配置属性。 */
export interface GraphicBase {
  origin: Vec2;
  rotation: number;
  visible: boolean;
}

/** FillPattern の識別子（末尾名）。None は塗りなし、それ以外は塗りあり。 */
export type FillPattern =
  | "None"
  | "Solid"
  | "Horizontal"
  | "Vertical"
  | "Cross"
  | "Forward"
  | "Backward"
  | "CrossDiag"
  | "HorizontalCylinder"
  | "VerticalCylinder"
  | "Sphere";

/** LinePattern の識別子（末尾名）。None は線なし、それ以外は線種。 */
export type LinePattern = "None" | "Solid" | "Dash" | "Dot" | "DashDot" | "DashDotDot";

/** BorderPattern の識別子（末尾名）。 */
export type BorderPattern = "None" | "Raised" | "Sunken" | "Engraved";

export interface LinePrimitive extends GraphicBase {
  type: "line";
  points: Vec2[];
  color: string | null;
  pattern: LinePattern;
  thickness: number;
  smooth: boolean;
  arrow: [string, string];
  arrowSize: number;
}

export interface RectanglePrimitive extends GraphicBase {
  type: "rectangle";
  extent: Extent;
  lineColor: string | null;
  linePattern: LinePattern;
  fillColor: string | null;
  fillPattern: FillPattern;
  lineThickness: number;
  borderPattern: BorderPattern;
  radius: number;
}

export interface EllipsePrimitive extends GraphicBase {
  type: "ellipse";
  extent: Extent;
  lineColor: string | null;
  linePattern: LinePattern;
  fillColor: string | null;
  fillPattern: FillPattern;
  lineThickness: number;
}

export interface PolygonPrimitive extends GraphicBase {
  type: "polygon";
  points: Vec2[];
  lineColor: string | null;
  linePattern: LinePattern;
  fillColor: string | null;
  fillPattern: FillPattern;
  lineThickness: number;
  smooth: boolean;
}

export interface TextPrimitive extends GraphicBase {
  type: "text";
  extent: Extent;
  textString: string;
  color: string | null;
  fontSize: number;
  fontName: string;
  horizontalAlignment: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type GraphicPrimitive =
  | LinePrimitive
  | RectanglePrimitive
  | EllipsePrimitive
  | PolygonPrimitive
  | TextPrimitive;

/** ダイアグラム（またはアイコン）上に配置されたコンポーネント。 */
export interface DiagramComponent {
  name: string;
  typeName: string;
  extent: Extent;
  origin: Vec2 | null;
  rotation: number;
  /** `Foo x if cond` の cond（無ければ null）。 */
  condition: string | null;
  /** condition を Boolean パラメータの既定値で評価した結果（不明なら null）。 */
  conditionDefault: boolean | null;
}

/** connect(...) 1 本。 */
export interface DiagramConnection {
  from: string;
  to: string;
  points: Vec2[];
  color: string | null;
}

/** 座標系 extent と図形の組（Icon / Diagram の graphics レイヤ）。 */
export interface GraphicsLayer {
  extent: Extent;
  primitives: GraphicPrimitive[];
}

/** Diagram レイヤ（自前の graphics ＋ コンポーネント配置 ＋ 接続線）。 */
export interface DiagramLayer extends GraphicsLayer {
  components: DiagramComponent[];
  connections: DiagramConnection[];
}

/** Modelica の既定座標系 {{-100,-100},{100,100}}。 */
export const DEFAULT_EXTENT: Extent = [
  [-100, -100],
  [100, 100],
];
