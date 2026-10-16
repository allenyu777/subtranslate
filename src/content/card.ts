import { bg } from "../shared/messaging";
import { isLlmConfigured } from "../shared/settings";
import { normalizeWord, tokenize } from "../shared/tokenize";
import type { Cue, DictResult, SentenceAnalysis, Settings, WordAnalysis } from "../shared/types";
import { addWord, findExample, getEntry, removeExample } from "../shared/vocab-store";
import { h } from "./dom";

export interface CardHost {
  settings(): Settings;
  videoId(): string;
  videoTitle(): string;
  /** 卡片被用户关闭 */
  onClose(): void;
}

export interface WordTarget {
  /** 字幕中的原始形态 */
  word: string;
  lemma: string;
  cue: Cue;
  /** 获取整句翻译（自动翻译关闭时由用户点击触发） */
  getTranslation: () => Promise<string>;
  /** 前后几句字幕，供 AI 参考 */
  context: string;
}

const spinner = (text: string) => h("div", { class: "muted" }, h("span", { class: "spin" }), text);

/** 词典释义压缩成一行，存进生词本 */
export function summarizeDict(d: DictResult | null): string {
  if (!d) return "";
  const s = d.entries
    .slice(0, 3)
    .map((e) => `${e.pos} ${e.terms.slice(0, 3).join("；")}`.trim())
    .join("  ");
  return s || d.translation;
}

function speak(word: string) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    speechSynthesis.speak(u);
  } catch {
    // 浏览器不支持就算了
  }
}

/** 渲染句子，把目标词加粗 */
function sentenceNodes(text: string, word?: string): Node[] {
  const target = word ? normalizeWord(word) : "";
  return tokenize(text).map((t) =>
    t.isWord && target && normalizeWord(t.text) === target ? h("b", {}, t.text) : document.createTextNode(t.text),
  );
}

export class Card {
  private el: HTMLDivElement | null = null;
  /** 每次打开/关闭递增，用于丢弃过期的异步结果 */
  private seq = 0;

  constructor(
    private wrap: HTMLElement,
    private hostEl: HTMLElement,
    private host: CardHost,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  contains(node: EventTarget | null): boolean {
    return !!this.el && node instanceof Node && this.el.contains(node);
  }

  close(notify = true) {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.seq++;
    if (notify) this.host.onClose();
  }

  private mount(card: HTMLDivElement, anchor: DOMRect) {
    this.close(false);
    this.el = card;
    this.wrap.append(card);
    const wrapRect = this.wrap.getBoundingClientRect();
    const hostRect = this.hostEl.getBoundingClientRect();
    const width = Math.min(380, hostRect.width - 16);
    card.style.width = `${width}px`;
    const center = anchor.left + anchor.width / 2;
    const minLeft = hostRect.left - wrapRect.left + 8;
    const maxLeft = hostRect.right - wrapRect.left - width - 8;
    const left = Math.max(minLeft, Math.min(maxLeft, center - wrapRect.left - width / 2));
    card.style.left = `${left}px`;
    card.style.maxHeight = `${Math.max(160, wrapRect.top - hostRect.top - 16)}px`;
  }

  private closeButton() {
    return h("button", { class: "icon", title: "关闭 (Esc)", onclick: () => this.close() }, "✕");
  }

  private llmHint(): HTMLElement {
    return h(
      "div",
      { class: "muted" },
      "配置大模型 API Key 后，可以让 AI 解析这个词在句子中的确切含义。",
      h("button", { onclick: () => void bg({ type: "openPage", page: "options" }) }, "去设置"),
    );
  }

  openWord(t: WordTarget, anchor: DOMRect) {
    const seq = this.seq + 1;
    const settings = this.host.settings();
    const videoId = this.host.videoId();
    const normalized = normalizeWord(t.word);
    const alive = () => this.seq === seq;

    let dict: DictResult | null = null;
    let ai: WordAnalysis | null = null;
    let saved = false;

    const phon = h("span", { class: "phon" });
    const saveBtn = h("button", { class: "primary" }, "☆ 加入生词本");
    const dictSec = h("div", { class: "sec" }, spinner("查询释义…"));
    const trSec = h("div");
    const aiSec = h("div", { class: "sec" });

    const card = h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "head" },
        h("span", { class: "word" }, t.word),
        t.lemma !== normalized && h("span", { class: "lemma" }, `原形 ${t.lemma}`),
        phon,
        h("button", { class: "icon", title: "朗读", onclick: () => speak(t.lemma) }, "🔊"),
        h("span", { class: "spacer" }),
        saveBtn,
        this.closeButton(),
      ),
      dictSec,
      h(
        "div",
        { class: "sec" },
        h("div", { class: "label" }, "原句"),
        h("div", { class: "sent" }, ...sentenceNodes(t.cue.text, t.word)),
        trSec,
      ),
      aiSec,
    );
    this.mount(card, anchor);
    this.seq = seq;

    const renderSave = () => {
      saveBtn.className = saved ? "saved" : "primary";
      saveBtn.textContent = saved ? "★ 已加入" : "☆ 加入生词本";
      saveBtn.title = saved ? "点击从生词本中移除这个例句" : "保存单词和这句原句";
    };

    const dictPromise = bg<DictResult>({ type: "lookup", word: normalized, lemma: t.lemma, target: settings.targetLang })
      .then((d) => {
        dict = d;
        if (!alive()) return d;
        phon.textContent = d.phonetic ? `/${d.phonetic.replace(/^\/|\/$/g, "")}/` : "";
        dictSec.replaceChildren(
          ...(d.entries.length
            ? d.entries.map((e) => h("div", { class: "def" }, h("span", { class: "pos" }, e.pos), e.terms.join("；")))
            : [h("div", { class: "def" }, d.translation || "（没有查到释义）")]),
        );
        return d;
      })
      .catch((err: Error) => {
        if (alive()) dictSec.replaceChildren(h("div", { class: "err" }, `查询失败：${err.message}`));
        return null;
      });

    const example = () => ({
      word: t.word,
      sentence: t.cue.text,
      translation,
      videoId,
      videoTitle: this.host.videoTitle(),
      time: t.cue.start,
      ai: ai ?? undefined,
    });

    // 整句翻译：自动翻译开启时直接显示，关闭时点按钮才翻译
    let translation: string | undefined;
    const showTranslation = async () => {
      trSec.replaceChildren(spinner("翻译中…"));
      try {
        translation = await t.getTranslation();
        if (alive()) trSec.replaceChildren(h("div", { class: "muted" }, translation || "（翻译失败）"));
      } catch {
        if (alive()) trSec.replaceChildren(h("div", { class: "err" }, "翻译失败"));
      }
    };
    if (settings.showTranslation) void showTranslation();
    else trSec.append(h("button", { onclick: () => void showTranslation() }, "显示整句翻译"));

    void getEntry(t.lemma).then((entry) => {
      if (!alive()) return;
      saved = !!entry && !!findExample(entry, t.cue.text, videoId);
      renderSave();
    });

    saveBtn.addEventListener("click", async () => {
      saveBtn.setAttribute("disabled", "");
      try {
        if (saved) {
          const entry = await getEntry(t.lemma);
          const ex = entry && findExample(entry, t.cue.text, videoId);
          if (ex) await removeExample(t.lemma, ex.id);
          saved = false;
        } else {
          const d = await Promise.race([dictPromise, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
          // 生词本里保存整句翻译方便复习（只存不显示）
          if (translation === undefined) {
            translation = await Promise.race([
              t.getTranslation().catch(() => undefined),
              new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
            ]);
          }
          await addWord({ lemma: t.lemma, phonetic: d?.phonetic ?? "", meaning: summarizeDict(d), example: example() });
          saved = true;
        }
      } finally {
        saveBtn.removeAttribute("disabled");
        renderSave();
      }
    });

    const runAi = async () => {
      aiSec.replaceChildren(spinner("AI 正在分析这个词在句中的意思…"));
      try {
        const res = await bg<WordAnalysis>({
          type: "analyzeWord",
          word: t.word,
          sentence: t.cue.text,
          context: t.context,
        });
        ai = res;
        if (!alive()) return;
        aiSec.replaceChildren(renderWordAnalysis(res, settings.showTranslation));
        // 已收藏的话，把 AI 解析一并存进这个例句
        if (saved) await addWord({ lemma: t.lemma, phonetic: dict?.phonetic ?? "", meaning: summarizeDict(dict), example: example() });
      } catch (err) {
        if (!alive()) return;
        aiSec.replaceChildren(
          h("div", { class: "err" }, `AI 解析失败：${(err as Error).message}`),
          h("button", { class: "ai", onclick: () => void runAi() }, "重试"),
        );
      }
    };

    if (!isLlmConfigured(settings)) {
      aiSec.append(this.llmHint());
    } else if (settings.autoAnalyze) {
      void runAi();
    } else {
      aiSec.append(h("button", { class: "ai", onclick: () => void runAi() }, "🤖 AI 解析：它在这句话里是什么意思？"));
    }
    renderSave();
  }

  openSentence(cue: Cue, translation: string | undefined, context: string, anchor: DOMRect) {
    const seq = this.seq + 1;
    const settings = this.host.settings();
    const aiSec = h("div", { class: "sec" });
    const card = h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "head" },
        h("span", { class: "word", style: "font-size:17px" }, "整句解析"),
        h("span", { class: "spacer" }),
        this.closeButton(),
      ),
      h(
        "div",
        { class: "sec" },
        h("div", { class: "sent" }, cue.text),
        translation && h("div", { class: "muted" }, translation),
      ),
      aiSec,
    );
    this.mount(card, anchor);
    this.seq = seq;
    const alive = () => this.seq === seq;

    const run = async () => {
      aiSec.replaceChildren(spinner("AI 正在分析整句…"));
      try {
        const res = await bg<SentenceAnalysis>({ type: "analyzeSentence", sentence: cue.text, context });
        if (alive()) aiSec.replaceChildren(renderSentenceAnalysis(res));
      } catch (err) {
        if (!alive()) return;
        aiSec.replaceChildren(
          h("div", { class: "err" }, `AI 解析失败：${(err as Error).message}`),
          h("button", { class: "ai", onclick: () => void run() }, "重试"),
        );
      }
    };
    if (isLlmConfigured(settings)) void run();
    else aiSec.append(this.llmHint());
  }
}

export function renderWordAnalysis(a: WordAnalysis, showSentence = true): HTMLElement {
  return h(
    "div",
    { class: "ai-box" },
    h("div", { class: "label" }, "AI · 本句中的意思"),
    h(
      "div",
      {},
      h("span", { class: "ai-meaning" }, a.meaningInContext),
      h("span", { class: a.isCommonMeaning ? "tag ok" : "tag" }, a.isCommonMeaning ? "常用义" : "非常用义"),
    ),
    a.partOfSpeech && h("div", { class: "muted" }, `${a.partOfSpeech}${a.lemma ? ` · 原形 ${a.lemma}` : ""}`),
    a.explanation && h("div", { class: "def" }, a.explanation),
    a.phrase && h("div", { class: "def" }, h("span", { class: "pos" }, "短语"), a.phrase),
    a.commonMeanings && h("div", { class: "def" }, h("span", { class: "pos" }, "常见义"), a.commonMeanings),
    showSentence && a.sentenceTranslation && h("div", { class: "def muted" }, `整句：${a.sentenceTranslation}`),
  );
}

export function renderSentenceAnalysis(a: SentenceAnalysis): HTMLElement {
  return h(
    "div",
    { class: "ai-box" },
    h("div", { class: "label" }, "AI · 翻译"),
    h("div", { class: "def" }, a.translation),
    a.structure && h("div", { class: "label", style: "margin-top:6px" }, "句子结构"),
    a.structure && h("div", { class: "def" }, a.structure),
    a.keyPoints.length > 0 && h("div", { class: "label", style: "margin-top:6px" }, "重点"),
    ...a.keyPoints.map((p) => h("div", { class: "kp" }, h("b", {}, p.text), " — ", p.explanation)),
  );
}
