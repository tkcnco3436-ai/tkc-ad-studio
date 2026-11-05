// 처음 설정 화면 (#setup) — ① 프로그램 ② Claude 구독 ③ 힉스필드 ④ 저장 폴더 (서버: lib/setup.js)
// 저장 폴더를 바꾸면 서버가 다시 켜지므로, 새 폴더로 켜질 때까지 기다렸다가 화면을 새로 고친다.
import { esc } from "./fields.js";

const $ = (s) => document.querySelector(s);
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

const st = { s: null, claude: null, hf: null, bound: false, busy: "", inst: null }; // inst = { id, job, line } 설치 중인 것
const pill = (ok, on = "준비됨", off = "필요") => `<span class="chip ${ok ? "" : "is-off"}">${ok ? on : off}</span>`;
const code = (t) => `<code class="su__code">${esc(t)}</code>`;
const CONNECTORS = "https://claude.ai/settings/connectors";
// 설치 버튼 — 설치 중이면 마지막 출력 한 줄을 보여 준다
const instBtn = (id, label = "설치") => st.inst?.id === id
  ? `<span class="su__inst"><span class="log__dot is-run"></span>설치 중… <span class="muted small">${esc(st.inst.line || "")}</span></span>`
  : `<button class="btn btn--primary btn--sm" type="button" data-su="install" data-id="${id}" ${st.inst ? "disabled" : ""}>${label}</button>`;

function render() {
  const s = st.s; if (!s) return;
  const need = s.tools.filter((t) => t.required && !t.ok).length;
  const toolsOk = need === 0;
  const claudeOk = s.claude.installed && st.claude?.ok;
  const hfOk = s.hf.mode === "api" ? s.hf.hasKey : !!st.hf?.ok;
  const dataOk = s.data.set && s.data.exists;
  const step = (n, title, ok, inner) => `<section class="ra-card su__step ${ok ? "is-ok" : ""}"><div class="su__head"><span class="su__n">${n}</span><div class="ra-card__t">${title}</div>${pill(ok)}</div>${inner}</section>`;

  $("#suBody").innerHTML = [
    step(1, "필요한 프로그램", toolsOk, `
      <p class="muted small">${s.platform === "windows" ? "install-windows.bat" : "./install-mac.sh"} 를 한 번 실행하면 한꺼번에 깔립니다. 깐 뒤에는 앱을 껐다 켜야 보입니다.</p>
      <table class="su__tbl">${s.tools.map((t) => `<tr><td>${pill(t.ok, "있음", t.required ? "없음" : "없음 (선택)")}</td><td><strong>${esc(t.label)}</strong><div class="muted small">${esc(t.need)}</div></td><td class="su__act">${t.ok ? "" : t.installable ? `${instBtn(t.id)}<div class="muted small">${code(t.hint)}</div>` : code(t.hint)}</td></tr>`).join("")}</table>`),
    step(2, "Claude 구독 연결", claudeOk, `
      <p class="muted small">카피·대본·분석은 이 PC 에 로그인한 <strong>내 Claude 구독 계정</strong>으로 돕니다. 계정은 한 사람당 하나 — 다른 사람 계정으로 로그인하지 마세요.</p>
      ${s.claude.installed
        ? `<p class="small">Claude Code ${esc(s.claude.version)} 설치됨. 로그인이 안 돼 있으면 [로그인 창 열기] → 열린 창에서 내 계정으로 로그인 → 돌아와 [연결 확인].</p>`
        : `<p class="small">Claude Code 가 없습니다. [Claude Code 설치]를 누르세요 (직접: ${code(s.claude.hint)}).</p><div class="ra-row">${instBtn("claude", "Claude Code 설치")}</div>`}
      <div class="ra-row">${s.claude.installed ? `<button class="btn btn--ghost btn--sm" type="button" data-su="login">로그인 창 열기</button>` : ""}<button class="btn btn--primary btn--sm" type="button" data-su="claude" ${s.claude.installed && !st.busy ? "" : "disabled"}>${st.busy === "claude" ? "확인하는 중… (1분 안팎)" : "연결 확인"}</button>
      ${st.claude ? `<span class="small ${st.claude.ok ? "" : "su__err"}">${st.claude.ok ? "연결됨" : esc(st.claude.text || "응답 없음")}</span>` : ""}</div>`),
    step(3, "힉스필드 연결", hfOk, `
      <p class="muted small">이미지·영상 생성은 힉스필드로 합니다. 방식은 화면 오른쪽 위 <strong>MCP / API</strong> 에서 고릅니다. 지금: <strong>${s.hf.mode === "api" ? "API" : "MCP"}</strong></p>
      ${s.hf.mode === "api"
        ? `<p class="small">API 키 ${s.hf.hasKey ? `저장됨 (…${esc(s.hf.keyIdTail)})` : "없음"}. 키는 이 PC 사용자 폴더에만 저장되고 화면에 다시 보이지 않습니다.</p>
           <div class="ra-row"><button class="btn btn--primary btn--sm" type="button" data-su="hfkey">API 키 넣기</button></div>`
        : `<ol class="small su__ol"><li><a href="${CONNECTORS}" target="_blank" rel="noopener">claude.ai 커넥터 설정 열기 ↗</a> → <strong>Higgsfield</strong> 연결 · 로그인 (2단계와 같은 Claude 계정)</li><li>아래 버튼으로 확인 — 잔여 크레딧만 조회하고 크레딧은 쓰지 않습니다</li></ol>
           <div class="ra-row"><button class="btn btn--primary btn--sm" type="button" data-su="hf" ${claudeOk && !st.busy ? "" : "disabled"}>${st.busy === "hf" ? "확인하는 중… (1~2분)" : "연결 확인"}</button>
           ${claudeOk ? "" : `<span class="muted small">2단계를 먼저 확인하세요</span>`}
           ${st.hf ? `<span class="small ${st.hf.ok ? "" : "su__err"}">${esc(st.hf.text || (st.hf.ok ? "연결됨" : "연결 안 됨"))}</span>` : ""}</div>`}`),
    step(4, "저장 폴더", dataOk, `
      <p class="muted small">모은 광고와 만든 소재가 모두 이 폴더에 쌓입니다. 고르면 안에 아래 폴더를 만들어 둡니다. <strong>여러 사람이 같은 폴더를 동시에 쓰지 마세요</strong> — 파일이 서로 덮어써질 수 있습니다.</p>
      <div class="ra-row"><input id="suDir" class="ra-grow" value="${esc(s.data.set ? s.data.path : "")}" placeholder="${esc(s.data.path)}"><button class="btn btn--ghost btn--sm" type="button" data-su="pick">폴더 고르기</button><button class="btn btn--primary btn--sm" type="button" data-su="save">이 폴더로 저장</button></div>
      ${s.data.set ? `<ul class="su__subs">${s.data.subs.map((x) => `<li>${pill(x.ok, "있음", "없음")} <code>${esc(x.dir)}</code> <span class="muted small">${esc(x.label)}</span></li>`).join("")}</ul>` : `<p class="small su__err">아직 고르지 않았습니다. 비워 두고 저장하면 칸에 흐리게 보이는 기본 폴더를 씁니다.</p>`}`),
    toolsOk && claudeOk && hfOk && dataOk ? `<div class="ra-row"><a class="btn btn--primary" href="#home">모두 준비됨 — 시작하기</a></div>` : "",
  ].join("");
}

async function load() {
  st.s = await api("/api/setup");
  st.claude ||= st.s.checks?.claude; st.hf ||= st.s.checks?.hf; // 예전에 확인한 결과
  render();
}

async function check(kind) {
  st.busy = kind; render();
  try { st[kind] = await api(`/api/setup/${kind}`, { method: "POST" }); }
  catch (e) { st[kind] = { ok: false, text: e.message }; }
  st.busy = ""; render();
}

async function waitRestart(dir) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await api("/api/status").catch(() => null);
    if (s && s.dataDir === dir) return location.reload();
  }
  toast("서버가 다시 켜지지 않았습니다 — 앱을 껐다가 다시 켜 주세요", true);
}

async function save() {
  const dir = $("#suDir").value.trim() || st.s.data.path;
  try {
    const r = await api("/api/setup/data", { method: "POST", body: { path: dir } });
    if (r.restart) { toast("저장 폴더를 바꿨습니다 — 다시 켜는 중…"); return waitRestart(r.path); }
    toast("저장 폴더를 만들었습니다"); load();
  } catch (e) { toast(e.message, true); }
}

function bind() {
  $("#suReload").addEventListener("click", () => load().catch((e) => toast(e.message, true)));
  $("#suBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-su]"); if (!b) return;
    const k = b.dataset.su;
    if (k === "claude" || k === "hf") return check(k);
    if (k === "hfkey") return $("#hfGear")?.click();
    if (k === "login") {
      try { const r = await api("/api/setup/login", { method: "POST" }); toast(`${r.opened} 창에서 로그인하세요. 끝나면 [연결 확인]`); }
      catch (e2) { toast(e2.message, true); }
      return;
    }
    if (k === "install") {
      const id = b.dataset.id, name = st.s.tools.find((t) => t.id === id)?.label || "Claude Code";
      if (!confirm(`${name} 를 이 PC 에 설치할까요?\n${st.s.platform === "windows" ? "winget" : "Homebrew"} 로 설치하며 몇 분 걸릴 수 있습니다. 관리자 비밀번호를 물어보면 입력해야 합니다.`)) return;
      try { st.inst = { id, job: "", line: "시작하는 중" }; render(); await api("/api/setup/install", { method: "POST", body: { id } }); }
      catch (e2) { st.inst = null; render(); toast(e2.message, true); }
      return;
    }
    if (k === "save") return save();
    if (k === "pick") {
      b.disabled = true; b.textContent = "창에서 고르세요…";
      const r = await api("/api/setup/pick", { method: "POST" }).catch((e2) => (toast(e2.message, true), {}));
      b.disabled = false; b.textContent = "폴더 고르기";
      if (r.path) $("#suDir").value = r.path;
      else toast("이 PC 에서 폴더 창을 못 열었거나 취소했습니다 — 경로를 직접 적어도 됩니다");
    }
  });
  // 오른쪽 위 MCP/API 를 바꾸거나 키를 저장하면 3단계를 다시 그린다
  const again = () => { if (!$("#setupView").hidden) setTimeout(() => load().catch(() => {}), 800); };
  document.addEventListener("click", (e) => { if (e.target.closest("[data-hfmode], #hfClearKey, #hfClose")) again(); });
  $("#hfForm")?.addEventListener("submit", again);
  // 설치 진행 — 서버 이벤트(app.js 가 "srv-event" 로 나눠 준다)에서 설치 작업만 본다
  window.addEventListener("srv-event", ({ detail: e }) => {
    if (!st.inst) return;
    if (e.type === "job" && e.kind === "setup" && e.state === "start") st.inst.job = e.job;
    else if (e.type === "log" && e.job === st.inst.job && e.message) st.inst.line = e.message.slice(0, 80);
    else if (e.type === "job" && e.job === st.inst.job && e.state !== "start") {
      toast(e.state === "done" ? `설치했습니다${st.s.platform === "windows" ? " — 앱을 껐다 켜야 보일 수 있습니다" : ""}` : e.message, e.state !== "done");
      st.inst = null; load().catch(() => {}); return;
    } else return;
    if (!$("#setupView").hidden) render();
  });
}

window.setupPage = {
  async open() {
    if (!st.bound) { bind(); st.bound = true; }
    await load().catch((e) => toast(e.message, true));
  },
  close() {},
};
