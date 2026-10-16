let voice: SpeechSynthesisVoice | null = null;

function englishVoice(): SpeechSynthesisVoice | null {
  if (voice) return voice;
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => v.lang === "en-US" && v.localService) ??
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  return voice;
}

/** 用浏览器自带的语音合成朗读英文 */
export function speak(text: string, rate = 0.9) {
  if (!("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate;
  const v = englishVoice();
  if (v) u.voice = v;
  // Chrome 在 cancel() 之后立刻 speak() 偶尔会没有声音，稍等一下再读
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 60);
  } else {
    speechSynthesis.speak(u);
  }
}

if ("speechSynthesis" in window) {
  // 语音列表是异步加载的
  speechSynthesis.addEventListener?.("voiceschanged", () => (voice = null));
}
