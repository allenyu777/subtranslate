import { bg } from "../shared/messaging";
import { DEFAULT_SETTINGS, getSettings } from "../shared/settings";
import { normalizeWord, tokenize, uniqueWords } from "../shared/tokenize";
import type { Cue, Settings, VocabEntry } from "../shared/types";
import { getLearningLemmas, isVocabKey } from "../shared/vocab-store";
import { Card } from "./card";
import { findCueIndex, findPrevCueIndex, parseCaptions, parseTrackUrl, type TrackInfo } from "./captions";
import { h } from "./dom";
import { PAGE_CSS, SHADOW_CSS } from "./styles";

const TAG = "__subtranslate";

// ---------- 状态 ----------
let settings: Settings = DEFAULT_SETTINGS;
let videoId = "";
let track: TrackInfo | null = null;
let cues: Cue[] = [];
let translations: (string | undefined)[] = [];
let translating = false;
let lemmaMap: Record<string, string> = {};
let learning = new Set<string>();
let currentIdx = -1;
let renderedIdx = -1;
/** 需要重新渲染当前字幕（翻译到达、词形还原完成、生词本变化等） */
let dirty = true;
let loadToken = 0;
let pausedByUs = false;
let hovering = false;
const preferAsked = new Set<string>();

// ---------- 与页面脚本通信 ----------
function toPage(msg: Record<string, unknown>) {
  window.postMessage({ [TAG]: true, dir: "toPage", ...msg }, location.origin);
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const d = ev.data as { [TAG]?: boolean; dir?: string; type?: string; url?: string; text?: string } | null;
  if (!d?.[TAG] || d.dir !== "toContent" || d.type !== "timedtext" || !d.url) return;
  const { url, text } = d;
  // 等读到用户设置后再处理，避免用默认设置（自动翻译）抢跑
  void settingsReady.then(() => onTimedtext(url, text ?? ""));
});

function currentVideoId(): string {
  if (location.pathname !== "/watch") return "";
  return new URLSearchParams(location.search).get("v") ?? "";
}

function getPlayer(): HTMLElement | null {
  return document.getElementById("movie_player");
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("#movie_player video");
}

function videoTitle(): string {
  const h1 = document.querySelector("ytd-watch-metadata h1")?.textContent?.trim();
  return h1 || document.title.replace(/ - YouTube$/, "");
}

// ---------- 界面 ----------
const hostEl = h("div", { class: "st-host" });
const shadow = hostEl.attachShadow({ mode: "open" });
const wrap = h("div", { class: "wrap empty" });
const toolbar = h("div", { class: "toolbar" });
const line = h("div", { class: "line" });
const hint = h("div", { class: "hint" });
shadow.append(h("style", {}, SHADOW_CSS), wrap);

const card = new Card(wrap, hostEl, {
  settings: () => settings,
  videoId: () => videoId,
  videoTitle,
  onClose: () => {
    shadow.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
    maybeResume();
  },
});

toolbar.append(
  h("button", { title: "上一句", onclick: () => jump(-1) }, "⏮ 上一句"),
  h("button", { title: "重播本句", onclick: () => jump(0) }, "⟲ 重播"),
  h("button", { title: "下一句", onclick: () => jump(1) }, "下一句 ⏭"),
  h("button", { title: "让 AI 解析整句", onclick: (ev) => openSentenceCard(ev) }, "🤖 解析整句"),
  h("button", { title: "打开生词本", onclick: () => void bg({ type: "openPage", page: "vocab" }) }, "📒 生词本"),
);

// 阻止点击冒泡到播放器（否则会触发暂停/播放）
for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
  hostEl.addEventListener(type, (ev) => ev.stopPropagation());
}

wrap.addEventListener("mouseenter", () => {
  hovering = true;
  if (settings.pauseOnHover && cues.length) pauseVideo();
});
wrap.addEventListener("mouseleave", () => {
  hovering = false;
  maybeResume();
});

document.addEventListener(
  "keydown",
  (ev) => {
    if (ev.key === "Escape" && card.isOpen) {
      ev.stopPropagation();
      card.close();
    }
  },
  true,
);
document.addEventListener(
  "pointerdown",
  (ev) => {
    if (card.isOpen && !ev.composedPath().some((n) => card.contains(n))) card.close();
  },
  true,
);

function pauseVideo() {
  const v = getVideo();
  if (v && !v.paused) {
    v.pause();
    pausedByUs = true;
  }
}

function maybeResume() {
  if (!pausedByUs || hovering || card.isOpen) return;
  pausedByUs = false;
  void getVideo()?.play();
}

function ensureMounted() {
  const player = getPlayer();
  if (!player) return;
  if (hostEl.parentElement !== player) {
    player.append(hostEl);
    resizeObserver.disconnect();
    resizeObserver.observe(player);
  }
  if (!document.getElementById("st-page-style")) {
    document.head.append(h("style", { id: "st-page-style" }, PAGE_CSS));
  }
}

// 字号随播放器大小缩放（全屏时更大）
const resizeObserver = new ResizeObserver((entries) => {
  const height = entries[0]?.contentRect.height ?? 480;
  hostEl.style.setProperty("--st-scale", String(Math.min(1.8, Math.max(0.75, height / 560))));
});

function applySettings() {
  hostEl.style.setProperty("--st-font", `${settings.fontSize}px`);
  hostEl.style.display = settings.enabled ? "" : "none";
  getPlayer()?.classList.toggle("st-active", settings.enabled && cues.length > 0);
  if (settings.showTranslation && cues.length && !translating) void startTranslation(loadToken);
  dirty = true;
}

let hintTimer = 0;
function showHint(text: string, ms = 8000) {
  if (cues.length) return;
  hint.textContent = text;
  wrap.replaceChildren(hint);
  wrap.classList.remove("empty");
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    if (!cues.length) {
      wrap.replaceChildren();
      wrap.classList.add("empty");
    }
  }, ms);
}

function render() {
  // 卡片打开时保持当前字幕不变，避免卡片「悬空」
  if (card.isOpen) return;
  if (currentIdx === renderedIdx && !dirty) return;
  renderedIdx = currentIdx;
  dirty = false;
  const cue = cues[currentIdx];
  if (!cue) {
    wrap.replaceChildren();
    wrap.classList.add("empty");
    return;
  }
  wrap.classList.remove("empty");
  const en = h("div", { class: "en" });
  for (const tok of tokenize(cue.text)) {
    if (!tok.isWord) {
      en.append(tok.text);
      continue;
    }
    const norm = normalizeWord(tok.text);
    const lemma = lemmaMap[norm] ?? norm;
    const span = h("span", { class: learning.has(lemma) ? "w saved" : "w" }, tok.text);
    // 鼠标悬停时提前查询，点击时结果多半已经准备好
    let hoverTimer = 0;
    span.addEventListener("mouseenter", () => {
      hoverTimer = window.setTimeout(() => void ensureLemma(norm).then((l) => prefetch(norm, l)), 120);
    });
    span.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
    span.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void openWordCard(tok.text, currentIdx, span);
    });
    en.append(span);
  }
  line.replaceChildren(en);
  if (settings.showTranslation) {
    const tr = translations[currentIdx];
    line.append(h("div", { class: tr === undefined ? "zh pending" : "zh" }, tr ?? "翻译中…"));
  }
  wrap.replaceChildren(toolbar, line);
}

const prefetched = new Set<string>();
function prefetch(word: string, lemma: string) {
  const key = `${word}|${lemma}`;
  if (prefetched.has(key)) return;
  prefetched.add(key);
  bg({ type: "lookup", word, lemma, target: settings.targetLang }).catch(() => prefetched.delete(key));
  bg({ type: "pronounce", word: lemma }).catch(() => {});
}

function contextFor(idx: number): string {
  return cues
    .slice(Math.max(0, idx - 2), idx + 3)
    .filter((_, i, arr) => arr[i] !== cues[idx])
    .map((c) => c.text)
    .join(" / ");
}

/** 词形还原结果：字幕刚加载、批量还原还没完成时，单独请求这个词 */
async function ensureLemma(norm: string): Promise<string> {
  if (!(norm in lemmaMap)) {
    try {
      Object.assign(lemmaMap, await bg<Record<string, string>>({ type: "lemmatize", words: [norm] }));
    } catch {
      // 失败时退化为原词
    }
  }
  return lemmaMap[norm] ?? norm;
}

async function openWordCard(word: string, idx: number, span: HTMLElement) {
  const cue = cues[idx];
  if (!cue) return;
  pauseVideo();
  shadow.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
  span.classList.add("active");
  const anchor = span.getBoundingClientRect();
  const lemma = await ensureLemma(normalizeWord(word));
  card.openWord({ word, lemma, cue, getTranslation: () => translateCue(idx), context: contextFor(idx) }, anchor);
}

function openSentenceCard(ev: MouseEvent) {
  const idx = currentIdx >= 0 ? currentIdx : findPrevCueIndex(cues, getVideo()?.currentTime ?? 0);
  const cue = cues[idx];
  if (!cue) return;
  pauseVideo();
  const tr = settings.showTranslation ? translations[idx] : undefined;
  card.openSentence(cue, tr, contextFor(idx), (ev.currentTarget as HTMLElement).getBoundingClientRect());
}

/** 翻译单句（有缓存直接返回），用于单词卡片和保存生词 */
async function translateCue(idx: number): Promise<string> {
  const cached = translations[idx];
  if (cached !== undefined) return cached;
  const token = loadToken;
  const [res] = await bg<string[]>({ type: "translate", texts: [cues[idx].text], target: settings.targetLang });
  if (token === loadToken) translations[idx] = res ?? "";
  return res ?? "";
}

function jump(delta: number) {
  const v = getVideo();
  if (!v || !cues.length) return;
  const base = currentIdx >= 0 ? currentIdx : findPrevCueIndex(cues, v.currentTime);
  const target = cues[Math.min(cues.length - 1, Math.max(0, base + delta))];
  if (!target) return;
  card.close(false);
  v.currentTime = target.start + 0.01;
}

// ---------- 字幕加载 ----------
function onTimedtext(url: string, text: string) {
  const info = parseTrackUrl(url);
  if (!info.videoId || info.videoId !== currentVideoId() || info.tlang) return;

  if (!preferAsked.has(info.videoId)) {
    preferAsked.add(info.videoId);
    toPage({ type: "preferEnglish", currentLang: info.lang, currentKind: info.kind });
  }
  if (!info.lang.startsWith("en")) {
    showHint("SubTranslate：当前字幕不是英文，请在播放器设置中选择英文字幕");
    return;
  }
  // 同一条字幕轨道重复请求时不重新加载
  if (track && cues.length && track.videoId === info.videoId && track.lang === info.lang && track.kind === info.kind) {
    return;
  }
  let parsed: Cue[];
  try {
    parsed = parseCaptions(text, info.kind === "asr");
  } catch {
    return;
  }
  if (!parsed.length) return;

  const token = ++loadToken;
  track = info;
  cues = parsed;
  translations = new Array<string | undefined>(cues.length);
  translating = false;
  currentIdx = -1;
  dirty = true;
  card.close(false);
  clearTimeout(hintTimer);
  applySettings();
  void loadLemmas(token);
}

async function loadLemmas(token: number) {
  const words = uniqueWords(cues.map((c) => c.text)).filter((w) => !(w in lemmaMap));
  if (!words.length) return;
  try {
    const map = await bg<Record<string, string>>({ type: "lemmatize", words });
    if (token !== loadToken) return;
    Object.assign(lemmaMap, map);
    dirty = true;
  } catch {
    // 词形还原失败时退化为原词
  }
}

/** 分批翻译字幕，优先翻译当前播放位置附近的部分 */
async function startTranslation(token: number) {
  translating = true;
  const chunks: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  cues.forEach((c, i) => {
    if (translations[i] !== undefined) return;
    if (cur.length >= 40 || chars + c.text.length > 3000) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += c.text.length;
  });
  if (cur.length) chunks.push(cur);

  const nowIdx = Math.max(0, findPrevCueIndex(cues, getVideo()?.currentTime ?? 0));
  const dist = (chunk: number[]) =>
    nowIdx < chunk[0] ? chunk[0] - nowIdx : nowIdx > chunk[chunk.length - 1] ? nowIdx - chunk[chunk.length - 1] : 0;
  chunks.sort((a, b) => dist(a) - dist(b));

  const worker = async () => {
    for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
      // 用户中途关闭了自动翻译
      if (!settings.showTranslation || token !== loadToken) return;
      try {
        const res = await bg<string[]>({
          type: "translate",
          texts: chunk.map((i) => cues[i].text),
          target: settings.targetLang,
        });
        if (token !== loadToken) return;
        chunk.forEach((cueIdx, j) => (translations[cueIdx] = res[j] ?? ""));
      } catch {
        if (token !== loadToken) return;
        chunk.forEach((cueIdx) => (translations[cueIdx] = ""));
      }
      if (chunk.includes(currentIdx)) dirty = true;
    }
  };
  await Promise.all([worker(), worker()]);
  if (token === loadToken) translating = false;
}

function resetForVideo(id: string) {
  videoId = id;
  track = null;
  cues = [];
  translations = [];
  translating = false;
  currentIdx = -1;
  dirty = true;
  loadToken++;
  card.close(false);
  pausedByUs = false;
  getPlayer()?.classList.remove("st-active");
  wrap.replaceChildren();
  wrap.classList.add("empty");
  if (!id) return;
  ensureMounted();
  toPage({ type: "replay", videoId: id });
  if (settings.enabled && settings.autoEnableCaptions) toPage({ type: "enableCaptions" });
  window.setTimeout(() => {
    if (videoId === id && !cues.length && settings.enabled) {
      showHint("SubTranslate：没有获取到字幕，请点击播放器的 CC 按钮打开英文字幕");
    }
  }, 6000);
}

// ---------- 主循环 ----------
function tick() {
  const id = currentVideoId();
  if (id !== videoId) resetForVideo(id);
  if (videoId && settings.enabled) {
    ensureMounted();
    const v = getVideo();
    if (v && cues.length) {
      currentIdx = findCueIndex(cues, v.currentTime);
      render();
    }
  }
  requestAnimationFrame(tick);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    void getSettings().then((s) => {
      settings = s;
      applySettings();
    });
  }
  let vocabChanged = false;
  for (const [key, change] of Object.entries(changes)) {
    if (!isVocabKey(key)) continue;
    vocabChanged = true;
    const entry = change.newValue as VocabEntry | undefined;
    const lemma = key.slice(2);
    if (entry?.status === "learning") learning.add(lemma);
    else learning.delete(lemma);
  }
  if (vocabChanged) dirty = true;
});

let markReady: () => void = () => {};
const settingsReady = new Promise<void>((resolve) => (markReady = resolve));

async function init() {
  settings = await getSettings();
  markReady();
  learning = await getLearningLemmas();
  applySettings();
  requestAnimationFrame(tick);
}

void init();
