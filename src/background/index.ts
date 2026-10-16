import { simplifyEntry } from "../shared/chinese";
import { lemmatize } from "../shared/lemma";
import { getSettings, isLlmConfigured } from "../shared/settings";
import type { BgRequest, BgResponse } from "../shared/types";
import { getAllEntries, putEntry } from "../shared/vocab-store";
import { analyzeSentence, analyzeWord } from "./llm";
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
      return lookupWord(req.word, req.lemma, req.target);
    case "analyzeWord":
      return analyzeWord(await getSettings(), req.word, req.sentence, req.context);
    case "analyzeSentence":
      return analyzeSentence(await getSettings(), req.sentence, req.context);
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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "update") return;
  const settings = await getSettings();
  if (settings.targetLang !== "zh-CN") return;
  for (const entry of await getAllEntries()) {
    const fixed = simplifyEntry(entry);
    if (JSON.stringify(fixed) !== JSON.stringify(entry)) await putEntry(fixed);
  }
});
