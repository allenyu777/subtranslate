import { describe, expect, it } from "vitest";
import { extractJson, normalizeSentenceAnalysis, normalizeWordAnalysis } from "../src/background/llm";
import { parseBatchResponse, parseDictResponse, parseSingleTranslation } from "../src/background/translate";
import { csvCell, toCsv, videoLink } from "../src/shared/export";
import type { VocabEntry } from "../src/shared/types";

describe("Google 翻译返回解析", () => {
  it("批量接口的几种返回形态", () => {
    expect(parseBatchResponse(["你好", "世界"], 2)).toEqual(["你好", "世界"]);
    expect(parseBatchResponse([["你好", "hello"], ["世界", "world"]], 2)).toEqual(["你好", "世界"]);
    expect(parseBatchResponse("你好", 1)).toEqual(["你好"]);
    expect(parseBatchResponse(["你好"], 2)).toBeNull();
    expect(parseBatchResponse({ error: 1 }, 1)).toBeNull();
  });
  it("整句翻译", () => {
    expect(parseSingleTranslation({ sentences: [{ trans: "你好。" }, { trans: "再见。" }] })).toBe("你好。再见。");
  });
  it("词典释义", () => {
    const d = parseDictResponse("run", {
      sentences: [{ trans: "跑", orig: "run" }, { src_translit: "rən" }],
      dict: [
        { pos: "动词", terms: ["跑", "运行", "经营", "竞选", "流", "开", "播放"] },
        { pos: "名词", terms: [] },
      ],
    });
    expect(d).toEqual({
      word: "run",
      entries: [{ pos: "动词", terms: ["跑", "运行", "经营", "竞选", "流", "开"] }],
      translation: "跑",
    });
  });
});

describe("LLM 输出解析", () => {
  it("从代码块中取出 JSON", () => {
    expect(extractJson('好的：\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a": {"b": 2}}')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("no json")).toThrow();
  });
  it("补全缺失字段", () => {
    const a = normalizeWordAnalysis({ meaningInContext: "经营", isCommonMeaning: false }, "runs");
    expect(a.lemma).toBe("runs");
    expect(a.meaningInContext).toBe("经营");
    expect(a.isCommonMeaning).toBe(false);
    expect(a.phrase).toBe("");
    expect(normalizeSentenceAnalysis({ translation: "x", keyPoints: [{ text: "a" }] })).toEqual({
      translation: "x",
      structure: "",
      keyPoints: [{ text: "a", explanation: "" }],
    });
  });
});

describe("导出", () => {
  it("视频链接带时间戳", () => {
    expect(videoLink("abc", 83.7)).toBe("https://www.youtube.com/watch?v=abc&t=83s");
  });
  it("CSV 转义", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("每个例句一行", () => {
    const entry: VocabEntry = {
      lemma: "run",
      forms: ["runs"],
      meaning: "动词 跑；经营",
      status: "learning",
      createdAt: 0,
      updatedAt: 0,
      examples: [
        { id: "1", word: "runs", sentence: "She runs a shop.", translation: "她经营一家店。", videoId: "v", videoTitle: "t", time: 10, addedAt: 0 },
        { id: "2", word: "run", sentence: "Run!", videoId: "v", videoTitle: "t", time: 20, addedAt: 0 },
      ],
    };
    const lines = toCsv([entry]).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("run,动词 跑；经营,She runs a shop.,她经营一家店。,,https://www.youtube.com/watch?v=v&t=10s");
  });
});

describe("AI 网页翻译", () => {
  it("返回数量不一致时报错", async () => {
    const { translateTexts } = await import("../src/background/llm");
    const { vi } = await import("vitest");
    const settings = (await import("../src/shared/settings")).DEFAULT_SETTINGS;
    const s = { ...settings, llm: { ...settings.llm, provider: "openai" as const, openaiKey: "k" } };
    const reply = (translations: string[]) =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations }) } }] }));
    vi.stubGlobal("fetch", async () => reply(["一", "二"]));
    expect(await translateTexts(s, ["one", "two"], "zh-CN", "t")).toEqual(["一", "二"]);
    vi.stubGlobal("fetch", async () => reply(["一"]));
    await expect(translateTexts(s, ["one", "two"], "zh-CN", "t")).rejects.toThrow("应为 2 段");
    vi.unstubAllGlobals();
  });
});
