// Modelica のパス/名前まわりの純粋ユーティリティ（vscode 非依存）。
// extension.js と omc 連携の双方から使う。

const fs = require("fs");
const path = require("path");

/** Modelica 識別子として妥当か */
function isValidIdent(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * dir の Modelica パッケージ修飾名。package.mo を持つ限り親をたどりドット連結。
 * 例: .../modelica/EAST/Blocks/Math -> "EAST.Blocks.Math"。package.mo が無ければ ""。
 */
function qualifiedName(dir) {
  const parts = [];
  let cur = dir;
  while (fs.existsSync(path.join(cur, "package.mo"))) {
    parts.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return parts.join(".");
}

/**
 * startDir を含む構造化ライブラリのルート（package.mo を持つ最上位の祖先）を返す。
 * package.mo が無ければ null。
 */
function findLibraryRoot(startDir) {
  let cur = startDir;
  let root = null;
  while (fs.existsSync(path.join(cur, "package.mo"))) {
    root = cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return root;
}

/**
 * .mo ファイルパスから、omc に渡す完全修飾クラス名を求める。
 * package.mo なら所属ディレクトリの修飾名そのもの、
 * それ以外は <ディレクトリ修飾名>.<ファイル名(拡張子なし)>。
 */
function classNameForFile(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const q = qualifiedName(dir);
  if (base.toLowerCase() === "package.mo") return q;
  const stem = base.replace(/\.mo$/i, "");
  return q ? `${q}.${stem}` : stem;
}

module.exports = {
  isValidIdent,
  qualifiedName,
  findLibraryRoot,
  classNameForFile,
};
