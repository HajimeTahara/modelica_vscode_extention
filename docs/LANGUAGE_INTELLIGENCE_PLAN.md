# Language Intelligence 実装計画

Modelica VS Code 拡張の次段階として、次の三つを一つのシンボル解決基盤の上に実装する。

1. Modelica の実用的な名前解決
2. Hover と Signature Help
3. 参照検索、およびクラス／パッケージの横断リネーム

結果プロットはこの計画の対象外とし、別途検討する。

## 目的と完了条件

既存の F12、補完、ダイアグラム／アイコンの型解決は、完全修飾名と現在のファイル内の変数を主な対象としている。
本計画では `import`、相対名、`extends`、`redeclare` を基本的に扱えるようにし、同じ解決結果を編集支援機能で共有する。

完了時には、以下を満たす。

- `import A.B;`、`import C = A.B;`、`extends A` を経由した型・メンバーの解決が、F12、補完、Hover、ダイアグラムで一致する。
- 識別子に Hover すると、宣言元、種別、型、既定値、説明、単位など取得できる情報を表示する。
- 関数呼び出し中に引数一覧と現在の引数を表示する。
- 変数、コンポーネント、クラス、パッケージについて workspace 内の参照を検索できる。
- クラス／パッケージのリネームは、宣言、参照、対応するファイル／フォルダ、`package.order` を一つの WorkspaceEdit で更新し、曖昧・危険なケースは実行しない。

## 前提：ライブラリの指定

外部ライブラリは、利用するリポジトリの `.vscode/settings.json` に設定する方式を推奨する。ソースへ annotation を追加せず、チームで共有でき、VS Code の Settings UI からも編集できるためである。

設定キーは **`modelica.libraryFiles`** とし、読み込み順を持つライブラリのトップ `package.mo` の配列にする。

```json
{
  "modelica.libraryFiles": [
    "${workspaceFolder}/../ModelicaStandardLibrary/Modelica/package.mo",
    "${workspaceFolder}/../Helion/package.mo"
  ]
}
```

- 相対パスは設定したワークスペースフォルダから解決する。`${workspaceFolder}` など VS Code の変数も解決する。
- 順序は OpenModelica へ渡す `loadFile` の順序であり、同名定義の優先順を明示できる。
- `package.mo` の親ディレクトリをシンボル解決のルートとして登録する。したがって、ワークスペース外のライブラリでも F12、補完、Hover、リネーム対象の検索に使える。
- ユーザー全体設定にも置けるが、再現性のためリポジトリ単位の `.vscode/settings.json` を標準とする。

将来、ディレクトリ指定も必要になれば `modelica.libraryPaths` を別に追加する。最初からファイルとディレクトリを一つの設定に混在させないことで、読み込み順と対象が明確になる。

### 実行時ライブラリ選択（先行実装）

`modelica.check` と `modelica.simulate` は、実行開始時に Setup 画面を表示する。`modelica.libraryFiles` の有効な項目を、複数行のライブラリ入力欄の初期値として表示し、利用者は今回の実行から追加・除外できる。「ライブラリを追加」で行を作り、各行のフォルダボタンからエクスプローラーを開いてトップ `package.mo` を選べるが、この入力は設定へ保存しない。

VS Code 標準の Settings UI の配列入力欄には、拡張機能からファイル選択ボタンを追加できない。その代わり
コマンド「Modelica: 既定ライブラリをエクスプローラーから選択」でトップ `package.mo` を選び、
`modelica.libraryFiles` をワークスペース設定へ保存できるようにする。

- 選択順は `loadModel(Modelica)` の後、対象モデルの `loadFile` より前に OpenModelica へ渡す `loadFile` の順序となる。
- 設定またはファイル選択で指定された、トップ `package.mo` ではないファイルは実行せず、理由を通知する。
- 保存時の自動チェック（`modelica.checkOnSave`）はピッカーを表示せず、`modelica.libraryFiles` の既定値を使う。
- 基本ライブラリ `Modelica` は従来どおり常に `loadModel(Modelica)` で読み込むため、ピッカーの対象外とする。

## 共通基盤：シンボル索引と解決器

### 実装方針

`app/src/symbols.ts` を中心に、VS Code 非依存のまま次の情報を構造化する。

- クラス、パッケージ、ネストクラスとその定義範囲
- `within`、`import`（通常・別名・限定）、`extends`、`redeclare`
- コンポーネント、parameter、constant、function の引数
- Documentation の短い説明、`unit`、既定値

`ResolvedSymbol` を共通の戻り値とする。少なくとも完全修飾名、種別、定義場所、所属クラス、型、宣言テキスト、解決の経路を持たせる。既存の `RootMap` は、ワークスペース内のルートと `modelica.libraryFiles` から得たルートを併合する。

索引はファイル更新時に無効化し、初期段階ではオンデマンドで再構築する。性能上の問題が確認されてから、ファイル単位キャッシュと差分更新を追加する。

### 解決順序

識別子 `X` または `A.B.X` は、以下の順序で試す。

1. ローカル宣言と現在／外側のクラス
2. 有効な `import`（別名を含む）
3. 現在のクラスと親パッケージを内側から外側へ補った相対名
4. `extends` の基底クラス（派生側の `redeclare` を優先）
5. ライブラリルートからの完全修飾名

複数候補が残る場合は、任意に一つを選ばない。F12 やリネームは候補を提示または拒否し、Hover は「曖昧」と表示する。

### テスト資産

`app/test/fixtures/` に最小の Modelica ライブラリを置く。少なくとも通常 import、別名 import、相対名、三段階の extends、redeclare、同名クラス、単一ファイルライブラリを含める。テストは vscode 非依存の `symbols` を中心にし、VS Code provider は薄い結合テストに留める。

## フェーズ 1：実用的な名前解決

1. コメント・文字列を除外した構文走査に import、extends、redeclare、引数宣言の抽出を追加する。
2. `ResolvedSymbol` と解決器を実装し、既存の定義ジャンプ、補完、グラフィック型解決を段階的に移行する。
3. `modelica.libraryFiles` を設定として追加し、パス検証、RootMap 併合、OpenModelica スクリプトへの順序付き `loadFile` を実装する。
4. 無効なパス、循環継承、未解決・曖昧な参照を安全に扱い、Output Channel に理由を出す。

### 受け入れ条件

- fixture と Helion／MSL の代表例で、F12、補完、ダイアグラムの解決先が同じになる。
- workspace 外の `package.mo` を `modelica.libraryFiles` に指定すると、ナビゲーションと `omc` の両方で利用できる。
- 既存の完全修飾名、ローカル変数、単一ファイルライブラリの挙動を維持する。

## フェーズ 2：Hover と Signature Help

1. `ResolvedSymbol` から Markdown を作る純粋関数を追加する。
2. `HoverProvider` を登録する。宣言場所、種別、修飾名、型、parameter／constant の値、`unit`、短い Documentation を表示する。
3. 関数の引数宣言と呼び出し位置を解析し、`SignatureHelpProvider` を登録する。
4. 名前付き引数、位置引数、ネストした括弧、文字列内のカンマを扱い、現在の引数番号を正しく求める。

### 受け入れ条件

- import・継承経由で参照したクラス／コンポーネントでも、F12 と同じ宣言を Hover に表示する。
- 関数呼び出しの途中で、現在入力中の引数が強調される。
- 解決できない、または曖昧な場合に例外を出さず、誤った宣言を表示しない。

## フェーズ 3：参照検索と横断リネーム

### 対象を分ける

- 変数／コンポーネント：既存 F2 を共通解決器へ移行し、Find References を追加する。
- クラス：クラス名、型注釈、extends、import、完全修飾参照を対象にする。
- パッケージ：パッケージ名と配下の完全修飾参照を対象にする。

### 実装手順

1. 索引から候補ファイルを絞り、コメント・文字列を除外して参照候補を収集する。
2. 各候補を解決器で再検証し、同名だが別シンボルの出現を除外する。
3. `ReferenceProvider` を登録する。
4. クラス／パッケージの `prepareRename` で安全性を検証する。標準ライブラリ、workspace 外、曖昧参照、衝突、引用符付き識別子、演算子名は初期版では拒否する。
5. `RenameProvider` が `WorkspaceEdit` を生成する。ファイル名・フォルダ名の変更、`package.order` 更新、宣言・参照更新を同じ edit に含める。
6. 実行前に変更対象ファイル数と不確実な参照の有無をプレビューで確認できるようにする。

### 受け入れ条件

- クラスリネームで、対応する `.mo` ファイル、`package.order`、workspace 内の解決済み参照が更新される。
- パッケージリネームで、フォルダ、`package.mo`、親の `package.order`、完全修飾参照が更新される。
- 対象外または曖昧なケースでは、一切の edit を適用せず理由を表示する。
- 変更後に対象 fixture を再解決し、古い名前の解決済み参照が残らない。

## 非対象と後続候補

- `inner/outer` の完全な意味解析、条件付き宣言の実行時評価、全ての Modelica 文法を扱う AST は初期範囲に含めない。
- GUI による Diagram／Icon 編集は別機能として扱う。
- シミュレーション結果のプロットは保留する。
- OpenModelica をバックエンドにした完全な言語サーバーへの移行は、軽量解決器で性能または互換性の限界が出た場合に再評価する。
