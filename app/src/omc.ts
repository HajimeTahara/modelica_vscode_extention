// OpenModelica (omc) 連携。
// 方針: コマンドごとに一時 .mos スクリプトを生成し `omc script.mos` を実行、
// 標準出力（getErrorString / SimulationResult）をパースする。

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** omc 診断の重大度。 */
export type OmcSeverity = "Error" | "Warning" | "Notification";

/** 位置付きの omc 診断。 */
export interface OmcDiagnostic {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  severity: OmcSeverity;
  message: string;
}

/** 位置なしの omc 診断。 */
export interface OmcUnlocated {
  severity: OmcSeverity;
  message: string;
}

/** simulate(...) に渡すオプション。 */
export interface SimulateOptions {
  startTime?: number;
  stopTime?: number;
  numberOfIntervals?: number;
  tolerance?: number;
  method?: string;
  outputFormat?: string;
  /** -lv に渡す LOG_* ストリーム。 */
  logging?: string[];
  /** シミュレーション進捗を受け取る TCP ポート（0 なら使わない）。 */
  statusPort?: number;
}

/** omc 実行結果。 */
export interface OmcRunResult {
  stdout: string;
  stderr: string;
  error: cp.ExecFileException | null;
}

/** omc に渡すパスは前方スラッシュへ正規化する（Windows でも omc は "/" を受け付ける） */
export function toOmcPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * getErrorString() の結果は omc の文字列リテラルとして出力されるため、
 * メッセージ末尾に閉じ引用符が残ることがある。それを取り除いて整える。
 */
function cleanMessage(msg: string): string {
  return msg.replace(/"\s*$/, "").trim();
}

/**
 * getErrorString() 出力を診断情報にパースする。
 * 形式: [<file>:<sl>:<sc>-<el>:<ec>:<flag>] Error|Warning|Notification: <message>
 * file にはドライブレター（C:）由来の ':' が含まれるため、path は非貪欲で取る。
 * message は次のヘッダ直前まで（複数行メッセージに対応）。
 */
export function parseErrors(errString: string | undefined): OmcDiagnostic[] {
  const results: OmcDiagnostic[] = [];
  if (!errString) return results;
  const header =
    /\[(.+?):(\d+):(\d+)-(\d+):(\d+):[^\]]*\]\s*(Error|Warning|Notification):/g;
  const matches: { index: number; end: number; groups: RegExpExecArray }[] = [];
  let m: RegExpExecArray | null;
  while ((m = header.exec(errString)) !== null) {
    matches.push({ index: m.index, end: header.lastIndex, groups: m });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const message = cleanMessage(
      errString.slice(cur.end, next ? next.index : undefined)
    );
    const g = cur.groups;
    results.push({
      file: g[1]!,
      startLine: parseInt(g[2]!, 10),
      startCol: parseInt(g[3]!, 10),
      endLine: parseInt(g[4]!, 10),
      endCol: parseInt(g[5]!, 10),
      severity: g[6] as OmcSeverity,
      message,
    });
  }
  return results;
}

/** 位置なしのエラー/警告（[..] ヘッダを持たない行）を抽出する */
export function parseUnlocated(errString: string | undefined): OmcUnlocated[] {
  const out: OmcUnlocated[] = [];
  if (!errString) return out;
  const re = /^(?!\[)[ \t]*(Error|Warning|Notification):[ \t]*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(errString)) !== null) {
    out.push({ severity: m[1] as OmcSeverity, message: cleanMessage(m[2]!) });
  }
  return out;
}

/** SimulationResult 文字列から resultFile のパスを取り出す（無ければ null） */
export function parseResultFile(stdout: string | undefined): string | null {
  const m = /resultFile\s*=\s*"([^"]*)"/.exec(stdout || "");
  return m && m[1] ? m[1] : null;
}

export function buildCheckScript(args: {
  loadTarget: string;
  className: string;
}): string {
  const { loadTarget, className } = args;
  return [
    "loadModel(Modelica); getErrorString();",
    `loadFile("${toOmcPath(loadTarget)}"); getErrorString();`,
    `checkModel(${className});`,
    "getErrorString();",
    "",
  ].join("\n");
}

export function buildSimulateScript(args: {
  loadTarget: string;
  className: string;
  options?: SimulateOptions;
}): string {
  const { loadTarget, className } = args;
  const o: SimulateOptions = args.options || {};
  const parts: string[] = [];
  if (o.startTime !== undefined) parts.push(`startTime=${o.startTime}`);
  if (o.stopTime !== undefined) parts.push(`stopTime=${o.stopTime}`);
  if (o.numberOfIntervals !== undefined)
    parts.push(`numberOfIntervals=${o.numberOfIntervals}`);
  if (o.tolerance !== undefined) parts.push(`tolerance=${o.tolerance}`);
  if (o.method) parts.push(`method="${o.method}"`);
  if (o.outputFormat) parts.push(`outputFormat="${o.outputFormat}"`);
  // 生成ファイルのベース名を単純クラス名にする（既定はフル修飾名）。
  const simpleName = String(className).split(".").pop();
  parts.push(`fileNamePrefix="${simpleName}"`);
  const ext = o.outputFormat === "csv" ? "csv" : "mat";
  const sim: string[] = [];
  if (o.logging && o.logging.length) sim.push(`-lv=${o.logging.join(",")}`);
  if (o.statusPort) sim.push(`-port=${o.statusPort}`);
  // 結果ファイル名を <単純名>.<ext> にする（既定の _res サフィックスを付けない）。
  sim.push(`-r=${simpleName}.${ext}`);
  if (sim.length) parts.push(`simflags="${sim.join(" ")}"`);
  const optStr = parts.length ? `, ${parts.join(", ")}` : "";
  return [
    "loadModel(Modelica); getErrorString();",
    `loadFile("${toOmcPath(loadTarget)}"); getErrorString();`,
    `simulate(${className}${optStr});`,
    "getErrorString();",
    // 依存込みの自己完結モデルを保存（再現・アーカイブ用）。
    // saveTotalModel は checkModel/simulate より厳格で、`redeclare constant` 等に
    // 非致命的なエラーを出す。その診断を後段で拾わないよう、ここでは getErrorString() を呼ばない。
    `saveTotalModel("${simpleName}_total.mo", ${className});`,
    "",
  ].join("\n");
}

/**
 * omc を .mos スクリプトで実行し stdout/stderr を返す。
 * omcPath が空、または指定パスが見つからない場合は OS の PATH から omc を探す。
 */
export function runOmc(
  omcPath: string,
  scriptContent: string,
  cwd: string,
  keepScriptPath?: string
): Promise<OmcRunResult> {
  return new Promise((resolve, reject) => {
    let tmpDir: string | null = null;
    let scriptPath: string;
    try {
      if (keepScriptPath) {
        // 指定パスに .mos を保存して実行し、削除しない（provenance 用）
        scriptPath = keepScriptPath;
        fs.writeFileSync(scriptPath, scriptContent, "utf8");
      } else {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelica-omc-"));
        scriptPath = path.join(tmpDir, "run.mos");
        fs.writeFileSync(scriptPath, scriptContent, "utf8");
      }
    } catch (e) {
      reject(e);
      return;
    }

    const configured = omcPath.trim();
    const commands =
      configured && configured !== "omc" ? [configured, "omc"] : ["omc"];
    const finish = (fn: () => void): void => {
      try {
        fn();
      } finally {
        if (tmpDir) {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch (_) {
            /* ignore */
          }
        }
      }
    };
    const runNext = (index: number): void => {
      const command = commands[index]!;
      cp.execFile(
        command,
        [scriptPath],
        { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error && error.code === "ENOENT" && index + 1 < commands.length) {
            runNext(index + 1);
            return;
          }
          if (error && error.code === "ENOENT") {
            finish(() =>
              reject(
                new Error(
                  `omc が見つかりません。設定 modelica.omcPath を確認するか、OpenModelica の bin を PATH に追加してください。試行: ${commands.join(
                    ", "
                  )}`
                )
              )
            );
            return;
          }
          finish(() =>
            resolve({
              stdout: stdout || "",
              stderr: stderr || "",
              error: error || null,
            })
          );
        }
      );
    };
    runNext(0);
  });
}
