// ego-browser CLI 를 띄워 브라우저 스크립트를 실행한다.
// 스크립트는 stdout 에 `__EVT__{json}` (진행) 과 `__RESULT__{json}` (최종) 줄을 찍는다.
import { spawn } from "node:child_process";

export function runEgo(script, { onEvent = () => {}, onLog = () => {}, timeoutMs = 15 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    // 윈도우에서는 ego-browser 가 .cmd 로 설치될 수 있어 셸을 거쳐 실행한다
    const child = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    let result, buf = "", errBuf = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("ego-browser 시간 초과")); }, timeoutMs);

    const handleLine = (line) => {
      if (line.startsWith("__EVT__")) { try { onEvent(JSON.parse(line.slice(7))); } catch {} }
      else if (line.startsWith("__RESULT__")) result = JSON.parse(line.slice(10));
      else if (line.trim()) onLog(line);
    };
    // ego-browser 는 스크립트의 console.log 를 stderr 로 보낼 때가 있어 두 스트림을 같이 읽는다
    const onData = (d) => {
      buf += d;
      errBuf = (errBuf + d).slice(-4000);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`ego-browser 실행 실패: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf) handleLine(buf);
      if (result?.error) return reject(new Error(result.error));
      if (result) return resolve(result);
      reject(new Error(`ego-browser 종료 코드 ${code}\n${errBuf.trim().slice(-1500)}`));
    });
    child.stdin.end(script);
  });
}
