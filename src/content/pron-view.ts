import { playWord, type Accent } from "../shared/speech";
import type { Pronunciation } from "../shared/types";
import { h } from "./dom";

/** 渲染「英 /…/ 🔊  美 /…/ 🔊」，点击音标或喇叭都会发音 */
export function pronView(word: string, pron: Pronunciation | undefined): HTMLElement {
  const item = (accent: Accent, label: string, phone: string, audio: string) => {
    const play = () => playWord(word, accent, audio);
    return h(
      "span",
      { class: "pron-item", title: `点击播放${label}音` },
      h("span", { class: "pron-label", onclick: play }, label),
      phone && h("span", { class: "pron-phone", onclick: play }, `/${phone}/`),
      h("button", { class: "icon", onclick: play }, "🔊"),
    );
  };
  return h(
    "span",
    { class: "pron" },
    item("uk", "英", pron?.uk ?? "", pron?.ukAudio ?? ""),
    item("us", "美", pron?.us ?? "", pron?.usAudio ?? ""),
  );
}
