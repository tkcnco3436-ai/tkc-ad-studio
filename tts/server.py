"""Qwen3-TTS 로컬 서버 (mlx-audio, 애플 실리콘) — 광고 수집기가 127.0.0.1:3910 으로 부른다.

  GET  /health    → 상태 · 내려받은 모델
  GET  /speakers  → 기본 목소리(CustomVoice) 이름·언어 목록
  POST /speak     → {text, language, speaker, instruct} 기본 목소리
                    {text, language, ref_audio, ref_text}  녹음 복제 (Base)
                    + out(저장할 wav 절대 경로) → {file, duration, seconds}

모델은 처음 부를 때 메모리에 올리고 계속 둔다. 한 번에 한 건만 만든다.
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from scipy.io import wavfile

CUSTOM = os.environ.get("QWEN_TTS_CUSTOM", "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit")
BASE = os.environ.get("QWEN_TTS_BASE", "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit")
PORT = int(os.environ.get("QWEN_TTS_PORT", "3910"))

_models = {}
_lock = threading.Lock()


def downloaded(repo):
    try:
        from huggingface_hub import try_to_load_from_cache
        return isinstance(try_to_load_from_cache(repo, "config.json"), str)
    except Exception:
        return False


def model(repo):
    if repo not in _models:
        from mlx_audio.tts.utils import load_model
        _models[repo] = load_model(repo)
    return _models[repo]


def speak(req):
    text = str(req.get("text") or "").strip()
    out = req.get("out")
    if not text or not out:
        raise ValueError("text 와 out 이 필요합니다")
    lang = req.get("language") or "auto"
    t0 = time.time()
    if req.get("ref_audio"):
        m = model(BASE)
        gen = m.generate(text=text, lang_code=lang, ref_audio=req["ref_audio"], ref_text=req.get("ref_text") or None)
    else:
        m = model(CUSTOM)
        gen = m.generate_custom_voice(text=text, speaker=req.get("speaker") or "Sohee", language=lang, instruct=req.get("instruct") or None)
    audio = np.concatenate([np.array(r.audio, dtype=np.float32).reshape(-1) for r in gen])
    sr = m.sample_rate
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wavfile.write(out, sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    return {"file": out, "duration": round(len(audio) / sr, 2), "seconds": round(time.time() - t0, 1)}


class H(BaseHTTPRequestHandler):
    def send(self, code, data):
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        try:
            if self.path == "/health":
                return self.send(200, {"ok": True, "loaded": list(_models), "models": {"custom": {"repo": CUSTOM, "downloaded": downloaded(CUSTOM)}, "base": {"repo": BASE, "downloaded": downloaded(BASE)}}})
            if self.path == "/speakers":
                with _lock:
                    m = model(CUSTOM)
                return self.send(200, {"speakers": m.get_supported_speakers(), "languages": m.get_supported_languages()})
            self.send(404, {"error": "없음"})
        except Exception as e:
            self.send(500, {"error": str(e)})

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            if self.path == "/speak":
                with _lock:
                    return self.send(200, speak(req))
            self.send(404, {"error": "없음"})
        except Exception as e:
            self.send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"qwen-tts on 127.0.0.1:{PORT}", file=sys.stderr, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
