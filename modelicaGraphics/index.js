// modelicaGraphics — Modelica のグラフィカルアノテーション解析と SVG 描画の共通パッケージ。
// vscode 非依存・プレーン JS（CommonJS）・依存ゼロ。VS Code 拡張や他ツールから再利用する。

const parse = require("./src/parse");
const diagram = require("./src/diagram");
const icon = require("./src/icon");

module.exports = {
  // 低レベル解析
  matchParen: parse.matchParen,
  matchBracket: parse.matchBracket,
  parseNumberArray: parse.parseNumberArray,
  extractBraceValue: parse.extractBraceValue,

  // ダイアグラム（モデル構成）
  parseDiagramExtent: diagram.parseDiagramExtent,
  parseComponentPlacements: diagram.parseComponentPlacements,
  parseConnections: diagram.parseConnections,
  buildDiagramSvg: diagram.buildDiagramSvg,
  esc: diagram.esc,
  rgb: diagram.rgb,

  // アイコン（Icon 図形）
  parseValue: icon.parseValue,
  parseIcon: icon.parseIcon,
  parseExtends: icon.parseExtends,
  renderIcon: icon.renderIcon,
};
