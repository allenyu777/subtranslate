import { normalizeWord, tokenize } from "../shared/tokenize";
import type { Pronunciation, VocabEntry } from "../shared/types";
import { deleteEntry, getAllEntries, importEntries, isVocabKey, removeExample, setPron, setStatus } from "../shared/vocab-store";
import { h } from "../content/dom";
import { pronView } from "../content/pron-view";
import { bg } from "../shared/messaging";
import { playWord, speak } from "../shared/speech";
import { toCsv, videoLink } from "../shared/export";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $<HTMLElement>("list");
const search = $<HTMLInputElement>("search");
const statusSel = $<HTMLSelectElement>("status");
const sortSel = $<HTMLSelectElement>("sort");

let entries: VocabEntry[] = [];

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

function highlighted(sentence: string, forms: string[]): Node[] {
  const set = new Set(forms.map(normalizeWord));
  return tokenize(sentence).map((t) =>
    t.isWord && set.has(normalizeWord(t.text)) ? h("b", {}, t.text) : document.createTextNode(t.text),
  );
}

function matches(e: VocabEntry, q: string): boolean {
  if (!q) return true;
  const hay = [e.lemma, e.meaning, ...e.forms, ...e.examples.flatMap((x) => [x.sentence, x.translation ?? "", x.videoTitle])]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

function sorted(items: VocabEntry[]): VocabEntry[] {
  const by = sortSel.value;
  return [...items].sort((a, b) =>
    by === "alpha"
      ? a.lemma.localeCompare(b.lemma)
      : by === "examples"
        ? b.examples.length - a.examples.length
        : b.updatedAt - a.updatedAt,
  );
}

function renderEntry(e: VocabEntry): HTMLElement {
  const mastered = e.status === "mastered";
  return h(
    "section",
    { class: mastered ? "entry mastered" : "entry" },
    h(
      "div",
      { class: "entry-head" },
      h(
        "span",
        { class: "lemma speakable", title: "点击朗读（美音）", onclick: () => playWord(e.lemma, "us", e.pron?.usAudio) },
        e.lemma,
      ),
      pronView(e.lemma, e.pron),
      e.forms.some((f) => f !== e.lemma) && h("span", { class: "forms" }, `形态：${e.forms.join(", ")}`),
      h("span", { class: "grow" }),
      h(
        "button",
        {
          title: mastered ? "重新标记为学习中（会在字幕中高亮）" : "标记为已掌握（不再在字幕中高亮）",
          onclick: () => void setStatus(e.lemma, mastered ? "learning" : "mastered"),
        },
        mastered ? "↺ 重新学习" : "✓ 已掌握",
      ),
      h(
        "button",
        {
          class: "danger",
          onclick: () => {
            if (confirm(`删除 “${e.lemma}” 及其全部例句？`)) void deleteEntry(e.lemma);
          },
        },
        "删除",
      ),
    ),
    e.meaning && h("div", { class: "meaning" }, e.meaning),
    h(
      "div",
      { class: "examples" },
      ...[...e.examples]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map((x) =>
          h(
            "div",
            { class: "ex" },
            h(
              "div",
              { class: "sent" },
              ...highlighted(x.sentence, [...e.forms, x.word]),
              " ",
              h("button", { class: "icon", title: "朗读例句", onclick: () => speak(x.sentence) }, "🔊"),
            ),
            x.translation && h("div", { class: "tr" }, x.translation),
            x.ai &&
              h(
                "div",
                { class: "ai" },
                h("span", { class: "m" }, `${x.ai.partOfSpeech ? x.ai.partOfSpeech + " · " : ""}${x.ai.meaningInContext}`),
                h("span", { class: x.ai.isCommonMeaning ? "tag ok" : "tag" }, x.ai.isCommonMeaning ? "常用义" : "非常用义"),
                x.ai.explanation && h("div", {}, x.ai.explanation),
                x.ai.phrase && h("div", {}, `短语：${x.ai.phrase}`),
              ),
            h(
              "div",
              { class: "ex-meta" },
              h(
                "a",
                { href: videoLink(x.videoId, x.time), target: "_blank", rel: "noopener", title: "回到视频中的这一句" },
                `▶ ${fmtTime(x.time)}`,
              ),
              h("span", { class: "muted" }, x.videoTitle),
              h("span", { class: "grow" }),
              h("span", { class: "muted" }, new Date(x.addedAt).toLocaleDateString()),
              h("button", { class: "danger", title: "删除这个例句", onclick: () => void removeExample(e.lemma, x.id) }, "×"),
            ),
          ),
        ),
    ),
  );
}

function render() {
  const q = search.value.trim().toLowerCase();
  const status = statusSel.value;
  const shown = sorted(entries.filter((e) => (status === "all" || e.status === status) && matches(e, q)));
  const learning = entries.filter((e) => e.status === "learning").length;
  $("stats").textContent = `共 ${entries.length} 个词 · 学习中 ${learning} · 已掌握 ${entries.length - learning}`;
  list.replaceChildren(
    ...(shown.length
      ? shown.map(renderEntry)
      : [
          h(
            "div",
            { class: "empty muted" },
            entries.length ? "没有匹配的单词" : "还没有生词。在 YouTube 字幕上点击单词，然后点「加入生词本」。",
          ),
        ]),
  );
}

async function load() {
  entries = await getAllEntries();
  render();
  void backfillPronunciation();
}

let backfilling = false;
/** 旧版本保存的词没有英美音标，打开生词本时逐个补上 */
async function backfillPronunciation() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (const e of entries.filter((x) => x.pron === undefined)) {
      try {
        await setPron(e.lemma, await bg<Pronunciation>({ type: "pronounce", word: e.lemma }));
      } catch {
        // 网络失败就下次再补
      }
    }
  } finally {
    backfilling = false;
  }
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export-csv").addEventListener("click", () => {
  download(`subtranslate-${Date.now()}.csv`, "﻿" + toCsv(entries), "text/csv;charset=utf-8");
});
$("export-json").addEventListener("click", () => {
  download(`subtranslate-backup-${Date.now()}.json`, JSON.stringify(entries, null, 2), "application/json");
});
$("import-json").addEventListener("click", () => $<HTMLInputElement>("import-file").click());
$<HTMLInputElement>("import-file").addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as VocabEntry[];
    if (!Array.isArray(data)) throw new Error("文件格式不对");
    const n = await importEntries(data);
    alert(`已导入 ${n} 个单词`);
  } catch (err) {
    alert(`导入失败：${(err as Error).message}`);
  }
  (ev.target as HTMLInputElement).value = "";
});

search.addEventListener("input", render);
statusSel.addEventListener("change", render);
sortSel.addEventListener("change", render);

let reloadTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(changes).some(isVocabKey)) return;
  clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void load(), 100);
});

void load();
