// 목소리 만들기 → "유튜브에서 목소리 가져오기": 링크·구간 → mp3 (서버 lib/ytaudio.js)
// 결과는 듣기 · mp3 받기 · 이 소리로 복제하기(녹음으로 복제 칸에 파일·이름·받아 적은 말을 채움) · 리소스(목소리)로 저장
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, isErr = false) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.toggle("is-err", isErr); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3500);
}
async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}
let last = null;

function render() {
  const r = last; if (!r) { $("#vcYtOut").innerHTML = ""; return; }
  $("#vcYtOut").innerHTML = `<div class="vc-yt__out">
    <audio controls src="${esc(r.url)}"></audio>
    <span class="small"><b>${esc(r.title)}</b> · ${esc(r.range)} · ${r.duration}초${r.duration > 15 ? ` <span class="muted">(복제는 앞쪽 15초 안의 쉼에서 잘라 씁니다)</span>` : ""}</span>
    <label class="field"><span>받아 적은 말 ${r.text ? "(whisper — 틀린 곳은 고치세요)" : "(60초가 넘거나 whisper 가 없어 비었습니다)"}</span><textarea id="vcYtText" rows="2">${esc(r.text)}</textarea></label>
    <div class="row">
      <a class="btn btn--sm" href="${esc(r.url)}" download="${esc(r.title.slice(0, 40))}.mp3">mp3 받기</a>
      <button class="btn btn--sm" type="button" data-ytclone>이 소리로 복제하기</button>
      <button class="btn btn--sm" type="button" data-ytsave>리소스로 저장</button>
    </div>
  </div>`;
}

function bind() {
  $("#vcYtForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$("#vcYtConsent").checked) return toast("본인 목소리이거나 허락받은 목소리인지 체크해 주세요", true);
    const btn = e.submitter; btn.disabled = true; btn.textContent = "추출 중… (영상 길이에 따라 30초~2분)";
    try {
      last = await post("/api/voice/youtube", { url: $("#vcYtUrl").value, start: $("#vcYtStart").value, end: $("#vcYtEnd").value, denoise: $("#vcYtDenoise").checked });
      render(); toast("mp3 를 만들었습니다");
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = "mp3 추출"; }
  });
  $("#vcYtOut").addEventListener("click", async (e) => {
    if (!last) return;
    if (e.target.closest("[data-ytsave]")) {
      const name = prompt("리소스 이름", last.title.slice(0, 30)); if (!name) return;
      try { await post("/api/voice/youtube/save", { file: last.file, name, source: last.source, range: last.range, text: $("#vcYtText").value }); toast("목소리 리소스로 저장했습니다"); window.resPage?.load(); }
      catch (err) { toast(err.message, true); }
    }
    if (e.target.closest("[data-ytclone]")) {
      // 녹음으로 복제 칸에 그대로 채운다 (목소리 엔진이 켜져 있어야 복제 칸이 보인다)
      if ($("#vcBody").hidden) return toast("목소리 엔진이 꺼져 있어 복제 칸이 없습니다 — mp3 를 받아 두었다가 엔진을 켠 뒤 올리세요", true);
      const blob = await (await fetch(last.url)).blob(), dt = new DataTransfer();
      dt.items.add(new File([blob], `${last.file}`, { type: "audio/mpeg" }));
      $('[data-vcmode="clone"]')?.click();
      $("#vcFile").files = dt.files;
      $("#vcName").value = last.title.slice(0, 30);
      $("#vcRefText").value = $("#vcYtText").value;
      $("#vcNew").open = true; $("#vcNew").scrollIntoView({ block: "center" });
      toast("복제 칸에 채웠습니다 — 동의를 체크하고 '목소리 복제하기'를 누르세요");
    }
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
