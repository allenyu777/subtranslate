/*
 * 网页双语翻译（类似沉浸式翻译）：把译文插在每个段落原文的下方。
 *
 * 由弹出窗口或快捷键按需注入到当前标签页（不会常驻在所有网页上）。
 * 只翻译出现在屏幕上的段落，滚动到哪里翻译到哪里，节省翻译额度。
 */
import { bg } from "../shared/messaging";
import type { Settings } from "../shared/types";
import { collectParagraphs, paragraphText, TRANSLATION_TAG } from "./paragraphs";

export type PageEngine = "google" | "ai";
export type PageCommand = { type: "pageTranslate"; action: "toggle" | "off" | PageEngine };

const UI_TAG = "st-page-ui";
const BATCH = { google: { items: 40, chars: 4000 }, ai: { items: 20, chars: 6000 } };
const MAX_IN_FLIGHT = 2;

interface Item {
  el: Element;
  text: string;
  node: HTMLElement;
}

class PageTranslator {
  engine: PageEngine | null = null;
  private items = new Map<Element, Item>();
  private queue: Item[] = [];
  private inFlight = 0;
  private done = 0;
  private failed = 0;
  private lastError = "";
  private generation = 0;
  private flushTimer = 0;
  private scanTimer = 0;
  private target = "zh-CN";
  private io = new IntersectionObserver((entries) => this.onVisible(entries), { rootMargin: "300px 0px" });
  private mo = new MutationObserver((records) => this.onMutations(records));
  private ui = new PanelUi(this);

  async start(engine: PageEngine) {
    if (this.engine === engine) return;
    this.stop();
    const { settings } = await chrome.storage.local.get("settings");
    this.target = (settings as Partial<Settings> | undefined)?.targetLang ?? "zh-CN";
    this.engine = engine;
    this.generation++;
    this.ui.show();
    this.scan(document.body);
    this.mo.observe(document.body, { childList: true, subtree: true });
    this.ui.update();
  }

  /** 移除所有译文，恢复原网页 */
  stop() {
    this.generation++;
    this.engine = null;
    this.io.disconnect();
    this.mo.disconnect();
    clearTimeout(this.flushTimer);
    clearTimeout(this.scanTimer);
    for (const item of this.items.values()) item.node.remove();
    this.items.clear();
    this.queue = [];
    this.done = this.failed = 0;
    this.lastError = "";
    this.ui.hide();
  }

  status() {
    return { engine: this.engine, done: this.done, total: this.items.size, failed: this.failed, error: this.lastError };
  }

  private scan(root: Element) {
    for (const el of collectParagraphs(root)) {
      if (this.items.has(el)) continue;
      const node = document.createElement(TRANSLATION_TAG);
      node.setAttribute("style", NODE_STYLE);
      this.items.set(el, { el, text: paragraphText(el), node });
      this.io.observe(el);
    }
    this.ui.update();
  }

  private onVisible(entries: IntersectionObserverEntry[]) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this.io.unobserve(e.target);
      const item = this.items.get(e.target);
      if (!item) continue;
      item.node.textContent = "…";
      item.node.style.opacity = "0.5";
      e.target.append(item.node);
      this.queue.push(item);
    }
    this.scheduleFlush();
  }

  private onMutations(records: MutationRecord[]) {
    // 忽略自己插入的译文和面板引起的变化
    const ours = `${TRANSLATION_TAG},${UI_TAG}`;
    const relevant = records.some((r) => {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      if (target?.closest(ours)) return false;
      return [...r.addedNodes].some((n) => !(n instanceof Element && n.matches(ours)));
    });
    if (!relevant) return;
    clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      if (this.engine) this.scan(document.body);
    }, 500);
  }

  private scheduleFlush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), 150);
  }

  private flush() {
    const engine = this.engine;
    if (!engine) return;
    while (this.queue.length && this.inFlight < MAX_IN_FLIGHT) {
      const limit = BATCH[engine];
      const batch: Item[] = [];
      let chars = 0;
      while (this.queue.length && batch.length < limit.items && (chars === 0 || chars + this.queue[0].text.length <= limit.chars)) {
        const item = this.queue.shift()!;
        if (!item.el.isConnected) continue;
        chars += item.text.length;
        batch.push(item);
      }
      if (batch.length) void this.translate(engine, batch);
    }
  }

  private async translate(engine: PageEngine, batch: Item[]) {
    const gen = this.generation;
    this.inFlight++;
    try {
      const texts = batch.map((i) => i.text);
      const res =
        engine === "ai"
          ? await bg<string[]>({ type: "aiTranslate", texts, target: this.target, title: document.title })
          : await bg<string[]>({ type: "translate", texts, target: this.target });
      if (gen !== this.generation) return;
      batch.forEach((item, i) => {
        item.node.textContent = res[i] ?? "";
        item.node.style.opacity = "";
      });
      this.done += batch.length;
    } catch (err) {
      if (gen !== this.generation) return;
      this.lastError = (err as Error).message;
      this.failed += batch.length;
      for (const item of batch) {
        item.node.textContent = "翻译失败，点击重试";
        item.node.style.opacity = "";
        item.node.style.cursor = "pointer";
        item.node.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          item.node.onclick = null;
          item.node.style.cursor = "";
          item.node.textContent = "…";
          this.failed--;
          this.queue.push(item);
          this.scheduleFlush();
        };
      }
    } finally {
      if (gen === this.generation) {
        this.inFlight--;
        this.ui.update();
        this.flush();
      }
    }
  }
}

const NODE_STYLE =
  "display:block;margin:0.35em 0 0;padding:0;border:0;font-weight:inherit;font-style:normal;" +
  "opacity:1;color:inherit;filter:opacity(0.82);white-space:normal;";

const PANEL_CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
.panel {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 10px;
  background: rgba(28,28,30,.92); color: #eee; box-shadow: 0 4px 18px rgba(0,0,0,.3);
  font: 13px/1.4 "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.title { font-weight: 600; margin-right: 2px; }
button {
  all: unset; cursor: pointer; padding: 3px 9px; border-radius: 7px; background: #3a3a3c; color: #eee; font-size: 12px;
}
button:hover { background: #48484a; }
button.on { background: #f59e0b; color: #1a1a1a; font-weight: 600; }
.status { color: #aaa; font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status.err { color: #ef9a9a; }
`;

class PanelUi {
  private host: HTMLElement | null = null;
  private google!: HTMLButtonElement;
  private ai!: HTMLButtonElement;
  private statusEl!: HTMLSpanElement;

  constructor(private t: PageTranslator) {}

  show() {
    if (this.host?.isConnected) return;
    const host = document.createElement(UI_TAG);
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const panel = document.createElement("div");
    panel.className = "panel";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "网页翻译";
    this.google = button("Google", "使用 Google 机器翻译", () => void this.t.start("google"));
    this.ai = button("AI 翻译", "使用大模型翻译，更准确", () => void this.t.start("ai"));
    const off = button("显示原文", "移除译文", () => this.t.stop());
    this.statusEl = document.createElement("span");
    this.statusEl.className = "status";
    panel.append(title, this.google, this.ai, off, this.statusEl);
    root.append(style, panel);
    document.documentElement.append(host);
    this.host = host;
  }

  hide() {
    this.host?.remove();
    this.host = null;
  }

  update() {
    if (!this.host) return;
    const s = this.t.status();
    this.google.classList.toggle("on", s.engine === "google");
    this.ai.classList.toggle("on", s.engine === "ai");
    if (s.failed && s.error) {
      this.statusEl.textContent = s.error;
      this.statusEl.title = s.error;
      this.statusEl.className = "status err";
    } else {
      this.statusEl.textContent = s.total ? `已翻译 ${s.done} 段` : "没有找到需要翻译的英文段落";
      this.statusEl.title = "";
      this.statusEl.className = "status";
    }
  }
}

function button(text: string, title: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", onclick);
  return b;
}

declare global {
  interface Window {
    __subtranslatePage?: PageTranslator;
  }
}

// 每次注入都会重新执行本文件，用全局变量保证只初始化一次
if (!window.__subtranslatePage) {
  const translator = new PageTranslator();
  window.__subtranslatePage = translator;
  chrome.runtime.onMessage.addListener((msg: PageCommand, _sender, sendResponse) => {
    if (msg?.type !== "pageTranslate") return;
    const run = async () => {
      if (msg.action === "off") translator.stop();
      else if (msg.action === "toggle") {
        if (translator.engine) translator.stop();
        else {
          const { settings } = await chrome.storage.local.get("settings");
          await translator.start((settings as Partial<Settings> | undefined)?.pageEngine ?? "google");
        }
      } else await translator.start(msg.action);
      return translator.status();
    };
    run().then(sendResponse, (err: Error) => sendResponse({ error: err.message }));
    return true;
  });
}
