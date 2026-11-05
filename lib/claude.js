// Claude Code 를 헤드리스(`claude -p`)로 불러 구독제 계정으로 판단을 맡긴다.
// 이미지는 cwd 안의 파일 이름을 프롬프트에 적고 Read 도구로 읽게 한다.
// 프롬프트는 인자가 아니라 표준 입력으로 넘긴다 — 윈도우에서 셸을 거치면 줄바꿈·따옴표가 깨지기 때문
import { spawn } from "node:child_process";

export function askClaude(prompt, { cwd, timeoutMs = 10 * 60_000, allowedTools = ["Read"] } = {}) {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    const args = ["-p", "--output-format", "json", "--allowedTools", win ? `"${allowedTools.join(",")}"` : allowedTools.join(",")];
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: win });
    child.stdin.end(prompt);
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude 응답 시간 초과")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`claude 실행 실패: ${e.message} (Claude Code 설치·로그인 확인)`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out); } catch { return reject(new Error(`Claude 응답을 읽지 못했습니다 (종료 코드 ${code}) ${err.slice(-300)}`)); }
      if (res.is_error) return reject(new Error(`Claude 오류: ${String(res.result || "").slice(0, 300)}`));
      resolve({ text: res.result || "", durationMs: res.duration_ms });
    });
  });
}

/** 응답 글에서 JSON 객체 하나를 꺼낸다 (```json 블록이나 앞뒤 설명이 붙어 와도) */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("응답에 JSON 이 없습니다");
  return JSON.parse(body.slice(start, end + 1));
}
