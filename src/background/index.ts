import { normalizeChinese, simplifyEntry } from "../shared/chinese";
import { translateActiveTab, translateTab } from "../shared/page-inject";
import { lemmatize } from "../shared/lemma";
import { getSettings, isLlmConfigured, saveSettings } from "../shared/settings";
import type { BgRequest, BgResponse } from "../shared/types";
import { getAllEntries, putEntry } from "../shared/vocab-store";
import { analyzeSentence, analyzeWord, translateTexts } from "./llm";
import { cached } from "./cache";
import { lookupPronunciation } from "./pronunciation";
import { lookupWord, translateBatch } from "./translate";

async function handle(req: BgRequest): Promise<unknown> {
  switch (req.type) {
    case "lemmatize": {
      const map: Record<string, string> = {};
      for (const w of req.words) map[w] = lemmatize(w);
      return map;
    }
    case "translate":
      return translateBatch(req.texts, req.target);
    case "lookup":
      return cached(`dict:${req.target}:${req.lemma}:${req.word}`, () => lookupWord(req.word, req.lemma, req.target));
    case "pronounce":
      return cached(`pron:${req.word}`, () => lookupPronunciation(req.word));
    case "analyzeWord":
      return analyzeWord(await getSettings(), req.word, req.sentence, req.context);
    case "analyzeSentence":
      return analyzeSentence(await getSettings(), req.sentence, req.context);
    case "aiTranslate": {
      const out = await translateTexts(await getSettings(), req.texts, req.target, req.title);
      return out.map((t) => normalizeChinese(t, req.target));
    }
    case "testLlm": {
      const s = await getSettings();
      if (!isLlmConfigured(s)) throw new Error("还没有填写 API Key");
      return analyzeWord(s, "run", "She runs a small bakery downtown.", "");
    }
    case "openPage":
      await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/${req.page}.html`) });
      return null;
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, _sender, sendResponse) => {
  handle(req).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResponse<unknown>),
    (err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies BgResponse<unknown>),
  );
  return true; // 异步响应
});

// 右键菜单：翻译当前网页
const MENU = {
  "st-page-google": "google",
  "st-page-ai": "ai",
  "st-page-off": "off",
} as const;

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    const common = {
      contexts: ["page", "selection", "link", "image"] as [chrome.contextMenus.ContextType, ...chrome.contextMenus.ContextType[]],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    };
    chrome.contextMenus.create({ id: "st-root", title: "SubTranslate 网页翻译", ...common });
    chrome.contextMenus.create({ id: "st-page-google", parentId: "st-root", title: "Google 翻译此网页", ...common });
    chrome.contextMenus.create({ id: "st-page-ai", parentId: "st-root", title: "AI 翻译此网页", ...common });
    chrome.contextMenus.create({ id: "st-page-off", parentId: "st-root", title: "显示原文", ...common });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = MENU[info.menuItemId as keyof typeof MENU];
  if (!action) return;
  if (action !== "off") {
    // 记住选择，快捷键也用这个引擎
    const s = await getSettings();
    if (s.pageEngine !== action) await saveSettings({ ...s, pageEngine: action });
  }
  // 页面上会显示翻译面板和错误信息；浏览器内部页面等无法注入时忽略
  await translateTab(tab, action).catch(() => {});
});

// 每次后台启动都重建一次菜单（removeAll 保证不会重复），不依赖 onInstalled 事件
createMenus();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "update") return;
  const settings = await getSettings();
  if (settings.targetLang !== "zh-CN") return;
  for (const entry of await getAllEntries()) {
    const fixed = simplifyEntry(entry);
    if (JSON.stringify(fixed) !== JSON.stringify(entry)) await putEntry(fixed);
  }
});

// 快捷键（默认 Alt+A）：翻译当前网页 / 恢复原文
chrome.commands.onCommand.addListener((command) => {
  if (command === "translate-page") void translateActiveTab("toggle").catch(() => {});
});
