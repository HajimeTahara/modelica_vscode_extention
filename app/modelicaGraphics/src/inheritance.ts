// extends によるアイコン継承を解決する。基底クラスのソース取得は呼び出し側の
// resolver（ファイル横断ルックアップ）に委ね、このモジュールは vscode / fs 非依存を保つ。
//
// 参照実装: Orbis app/src/features/modelica-browser/modelica-icon-inheritance.ts

import {
  extractExtendsTypeNames,
  isConnectorClass,
  isConnectorLikeType,
  parseIconComponents,
  parseOwnIconGraphics,
  sliceNamedClass,
} from "./layers";
import { DEFAULT_EXTENT } from "./types";
import type { DiagramComponent, Extent, GraphicPrimitive, GraphicsLayer } from "./types";

/**
 * 型名（token）と宣言側スコープ（完全修飾クラス名）から、基底クラスのソースと
 * 解決後の完全修飾名を返す。解決できなければ null。
 */
export type ClassTextResolver = (
  token: string,
  scopeClassName: string
) => { text: string; className: string } | null;

/** 継承チェーンの安全上限。 */
const MAX_DEPTH = 12;

/**
 * ownSource（対象クラスの定義本文）と継承元を辿って Icon レイヤを合成する。
 * 基底が下、派生が上に重なる。scopeClassName は名前解決に使う完全修飾クラス名。
 */
export function buildInheritedIconLayer(
  ownSource: string,
  scopeClassName: string,
  resolve: ClassTextResolver,
  visited: Set<string> = new Set(),
  depth = 0
): GraphicsLayer {
  const own = parseOwnIconGraphics(ownSource);

  if (depth >= MAX_DEPTH) {
    return { extent: own.extent ?? DEFAULT_EXTENT, primitives: own.primitives };
  }

  const basePrimitives: GraphicPrimitive[] = [];
  let inheritedExtent: Extent | null = null;

  for (const token of extractExtendsTypeNames(ownSource)) {
    const resolved = resolveQuietly(resolve, token, scopeClassName);
    if (!resolved) continue;
    if (visited.has(resolved.className)) continue; // 循環継承ガード
    visited.add(resolved.className);

    const baseLayer = buildInheritedIconLayer(
      narrowToClass(resolved.text, resolved.className),
      resolved.className,
      resolve,
      visited,
      depth + 1
    );
    basePrimitives.push(...baseLayer.primitives);
    // 最初に見つかった基底の extent を継承候補にする。
    if (!inheritedExtent && baseLayer.primitives.length > 0) {
      inheritedExtent = baseLayer.extent;
    }
  }

  return {
    // 派生自身に coordinateSystem があればそれを優先、なければ基底から継承。
    extent: own.extent ?? inheritedExtent ?? DEFAULT_EXTENT,
    primitives: [...basePrimitives, ...own.primitives],
  };
}

/** アイコンに現れるポート（コネクタ）を、宣言クラスのスコープ付きで返す。 */
export interface ScopedIconComponent {
  component: DiagramComponent;
  /** 宣言していたクラスの完全修飾名（ポート型を正しいスコープで解決するために保持）。 */
  scope: string;
}

/**
 * ownSource と継承元を辿り、アイコンに配置されたポート（コネクタ）を集める。
 * 同名は派生側（より末端）を優先する。
 *
 * アイコンに描くのはコネクタだけ。型を解決して見出しが `connector` かどうかで
 * 判定するので、`Frame_a` のような名前でも拾え、`Add addD if with_D` のような
 * 条件付きの内部ブロックは除ける。解決できない型だけ名前の慣習で判定する。
 */
export function collectInheritedIconComponents(
  ownSource: string,
  scopeClassName: string,
  resolve: ClassTextResolver,
  visited: Set<string> = new Set(),
  depth = 0
): ScopedIconComponent[] {
  const own = parseIconComponents(ownSource)
    .filter((component) => isConnectorType(component.typeName, scopeClassName, resolve))
    .map((component) => ({ component, scope: scopeClassName }));
  if (depth >= MAX_DEPTH) return own;

  const inherited: ScopedIconComponent[] = [];
  for (const token of extractExtendsTypeNames(ownSource)) {
    const resolved = resolveQuietly(resolve, token, scopeClassName);
    if (!resolved) continue;
    if (visited.has(resolved.className)) continue;
    visited.add(resolved.className);

    inherited.push(
      ...collectInheritedIconComponents(
        narrowToClass(resolved.text, resolved.className),
        resolved.className,
        resolve,
        visited,
        depth + 1
      )
    );
  }

  // 同名ポートは派生側で上書き（派生の宣言が優先）。
  const byName = new Map<string, ScopedIconComponent>();
  for (const item of inherited) byName.set(item.component.name, item);
  for (const item of own) byName.set(item.component.name, item);
  return [...byName.values()];
}

/** 型名がコネクタを指すか。解決できたら見出しキーワード、駄目なら名前の慣習で判定する。 */
function isConnectorType(
  typeName: string,
  scopeClassName: string,
  resolve: ClassTextResolver
): boolean {
  const resolved = resolveQuietly(resolve, typeName, scopeClassName);
  if (!resolved) return isConnectorLikeType(typeName);
  return isConnectorClass(narrowToClass(resolved.text, resolved.className));
}

function resolveQuietly(
  resolve: ClassTextResolver,
  token: string,
  scopeClassName: string
): { text: string; className: string } | null {
  try {
    return resolve(token, scopeClassName);
  } catch (_) {
    return null;
  }
}

/** 複数クラスを含むファイル本文なら該当クラスへ絞り込む。 */
function narrowToClass(text: string, className: string): string {
  const simpleName = className.split(".").filter(Boolean).at(-1) ?? "";
  return sliceNamedClass(text, simpleName) ?? text;
}
