// vscode モジュールの読み込みガード。
//
// vscode は拡張ホストの中でしか require できない。単体検証などランタイム外から
// このパッケージを読み込んでも「モジュールの読み込み自体は成功する」ようにするため、
// 静的 import ではなく実行時 require をガードして取り込む。
// 型は `import type` で得るので、型検査は通常の import と同じだけ効く。
//
// vscode が無い環境で vscode API に触れる関数を呼べば当然 TypeError になる。
// それは元の JS 実装と同じ前提（純粋関数だけを外から使う）。

import type * as vscodeTypes from "vscode";

function loadVscode(): typeof vscodeTypes {
  try {
    return require("vscode") as typeof vscodeTypes;
  } catch (_) {
    return undefined as unknown as typeof vscodeTypes;
  }
}

export const vscode = loadVscode();
