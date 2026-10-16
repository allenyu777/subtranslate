import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupWord, translateBatch } from "../src/background/translate";
import { normalizeChinese, simplifyEntry, toSimplified } from "../src/shared/chinese";
import type { VocabEntry } from "../src/shared/types";

describe("繁体转简体", () => {
  it("常见词", () => {
    expect(toSimplified("跑步；運行；經營；麵包店；頭髮")).toBe("跑步；运行；经营；面包店；头发");
  });
  it("只有目标语言是简体中文时才转换", () => {
    expect(normalizeChinese("運行", "zh-CN")).toBe("运行");
    expect(normalizeChinese("運行", "zh-TW")).toBe("運行");
  });
  it("转换已保存的生词", () => {
    const e: VocabEntry = {
      lemma: "run", forms: ["run"], meaning: "名詞 跑步；運行", status: "learning", createdAt: 0, updatedAt: 0,
      examples: [{ id: "1", word: "run", sentence: "Run.", translation: "跑！", videoId: "v", videoTitle: "t", time: 0, addedAt: 0 }],
    };
    expect(simplifyEntry(e).meaning).toBe("名词 跑步；运行");
  });
});

describe("翻译和查词结果统一为简体", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("词典释义中的繁体被转换并去重", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const body = url.includes("dictionaryapi")
        ? [{ phonetic: "/rʌn/" }]
        : url.includes("youdao")
          ? { ec: { word: [{ ukphone: "rʌn", usphone: "rʌn" }] } }
          : { sentences: [{ trans: "跑" }], dict: [{ pos: "名詞", terms: ["跑步", "運行", "运行"] }] };
      return new Response(JSON.stringify(body));
    });
    const d = await lookupWord("runx", "runx", "zh-CN");
    expect(d.entries).toEqual([{ pos: "名词", terms: ["跑步", "运行"] }]);
    expect(d.pron.uk).toBe("rʌn");
    expect(d.pron.us).toBe("rʌn");
  });

  it("批量翻译结果被转换", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(["她經營一家麵包店"])));
    expect(await translateBatch(["She runs a bakery."], "zh-CN")).toEqual(["她经营一家面包店"]);
  });
});
