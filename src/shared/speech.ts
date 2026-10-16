export type Accent = "uk" | "us";

const voices: Partial<Record<Accent, SpeechSynthesisVoice | null>> = {};

function pickVoice(accent: Accent): SpeechSynthesisVoice | null {
  if (voices[accent] !== undefined) return voices[accent] ?? null;
  const lang = accent === "uk" ? "en-GB" : "en-US";
  const all = speechSynthesis.getVoices();
  const v =
    all.find((x) => x.lang === lang && x.localService) ??
    all.find((x) => x.lang === lang) ??
    all.find((x) => x.lang.startsWith("en")) ??
    null;
  if (all.length) voices[accent] = v;
  return v;
}

/** 用浏览器自带的语音合成朗读英文 */
export function speak(text: string, accent: Accent = "us", rate = 0.9) {
  if (!("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent === "uk" ? "en-GB" : "en-US";
  u.rate = rate;
  const v = pickVoice(accent);
  if (v) u.voice = v;
  // Chrome 在 cancel() 之后立刻 speak() 偶尔会没有声音，稍等一下再读
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 60);
  } else {
    speechSynthesis.speak(u);
  }
}

let current: HTMLAudioElement | null = null;

/** 播放单词的英音/美音：优先播放词典的发音音频，失败时退回语音合成 */
export function playWord(word: string, accent: Accent, audioUrl?: string) {
  current?.pause();
  if (!audioUrl) return speak(word, accent);
  const audio = new Audio(audioUrl);
  current = audio;
  audio.play().catch(() => speak(word, accent));
}

if ("speechSynthesis" in window) {
  // 语音列表是异步加载的
  speechSynthesis.addEventListener?.("voiceschanged", () => {
    delete voices.uk;
    delete voices.us;
  });
}
