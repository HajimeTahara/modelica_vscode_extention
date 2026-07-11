// グラフィック解析ライブラリ modelicaGraphics への薄いアダプタ。
// 拡張フォルダ直下に vendor（同梱）した ../modelicaGraphics を参照する。
// dev(F5)・インストール後とも同じ相対パスに解決される。
let mg;
try {
  mg = require("../modelicaGraphics"); // 拡張直下に同梱した vendor コピー
} catch (_) {
  mg = require("../../modelicaGraphics"); // 後方互換: リポジトリ直下の旧共有パッケージ
}

module.exports = mg;
