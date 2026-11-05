// 서버를 켜고 지켜본다 — 설정 화면에서 저장 폴더를 바꾸면 server.js 가 종료 코드 75 로 끝나고, 여기서 새 폴더로 다시 켠다.
//   node start.js          서버만 켠다 (npm start)
//   node start.js --open   켠 뒤 브라우저로 연다 (start-mac.command · start-windows.bat)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const URL = `http://localhost:${process.env.PORT || 5179}`;
let opened = !process.argv.includes("--open");

function openBrowser() {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", URL]] : process.platform === "darwin" ? ["open", [URL]] : ["xdg-open", [URL]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

function launch() {
  const child = spawn(process.execPath, [path.join(DIR, "server.js")], { cwd: DIR, stdio: "inherit" });
  if (!opened) { opened = true; setTimeout(openBrowser, 1500); }
  child.on("exit", (code) => {
    if (code === 75) { console.log("저장 폴더를 바꿔 다시 켭니다…"); return launch(); }
    process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => child.kill(sig));
}
launch();
