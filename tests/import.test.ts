import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromLanguageReactor, isLanguageReactorExport, mergeAll } from "../src/shared/import";
import { lemmatize } from "../src/shared/lemma";
import type { VocabEntry } from "../src/shared/types";

// 真实的 Language Reactor 导出（去掉了音频和缩略图数据）。导出时这两个词是「已忽略」，
// 这里改成「学习中」来测试正常的导入流程
const raw = JSON.parse(readFileSync(new URL("./fixtures/language-reactor.json", import.meta.url), "utf8"));
const fixture = raw.map((x: object) => ({ ...x, learningStage: "LEARNING" }));

const entry = (lemma: string, over: Partial<VocabEntry> = {}): VocabEntry => ({
  lemma,
  forms: [lemma],
  meaning: "",
  status: "learning",
  examples: [],
  createdAt: 100,
  updatedAt: 100,
  ...over,
});
const ex = (sentence: string, videoId = "v") => ({
  id: sentence,
  word: "w",
  sentence,
  videoId,
  videoTitle: "t",
  time: 0,
  addedAt: 0,
});

describe("Language Reactor 导入", () => {
  it("识别导出格式", () => {
    expect(isLanguageReactorExport(fixture)).toBe(true);
    expect(isLanguageReactorExport([entry("run")])).toBe(false);
    expect(isLanguageReactorExport([])).toBe(false);
  });

  it("转换真实导出：单词、所在句子、翻译、视频和时间", () => {
    const { entries, skipped } = fromLanguageReactor(fixture, lemmatize);
    expect(skipped).toBe(0);
    const acre = entries.find((e) => e.lemma === "acre")!;
    expect(acre.forms).toEqual(["acre", "acres"]);
    expect(acre.meaning).toBe("英亩；亩；公亩");
    expect(acre.examples).toHaveLength(1);
    expect(acre.examples[0]).toMatchObject({
      word: "acres",
      sentence: "McGregor, Texas. It's 4,000 acres. Thank you for having us. Thank you for hosting",
      translation: "占地4000英亩。 谢谢 你们的款待。 感谢",
      videoId: "qt5p-_tE8d0",
      videoTitle: "Roadster Event",
      time: 47.68,
    });
    const raptor = entries.find((e) => e.lemma === "raptor")!;
    expect(raptor.examples[0].word).toBe("Raptor");
    expect(raptor.examples[0].sentence).toBe("enjoyed our little pre-show Raptor static fire over there.");
    expect(raptor.status).toBe("learning");
  });

  it("跳过在 Language Reactor 中被忽略（SKIPPED）的词", () => {
    const { entries, skipped } = fromLanguageReactor(raw, lemmatize);
    expect(entries).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("用本插件的规则统一原形；KNOWN 视为已掌握；跳过非英语；短语不做词形还原", () => {
    const items = [
      { key: "WORD|extradited|en", word: { text: "extradited" }, learningStage: "KNOWN", wordTranslationsArr: ["引渡"] },
      { key: "WORD|bonjour|fr", word: { text: "bonjour" } },
      { key: "PHRASE|at a loss|en", itemType: "PHRASE", phrase: { text: "At a loss" } },
    ];
    const { entries, skipped } = fromLanguageReactor(items, lemmatize);
    expect(skipped).toBe(1);
    expect(entries.map((e) => [e.lemma, e.status])).toEqual([
      ["extradite", "mastered"],
      ["at a loss", "learning"],
    ]);
  });

  it("没有分词信息时按包含这个词的句子定位", () => {
    const items = [
      {
        key: "WORD|cat|en",
        word: { text: "cat" },
        context: { phrase: { subtitles: { "0": "A dog barks.", "1": "The cat sleeps.", "2": "Birds sing." }, reference: { diocoDocId: "nf_123" } } },
      },
    ];
    const ex0 = fromLanguageReactor(items, lemmatize).entries[0].examples[0];
    expect(ex0.sentence).toBe("The cat sleeps.");
    // 非 YouTube 来源没有视频链接
    expect(ex0.videoId).toBe("");
  });
});

describe("合并去重", () => {
  it("新词直接添加，已有的词合并例句，重复例句跳过", () => {
    const existing = new Map([["run", entry("run", { examples: [ex("I run.")], meaning: "跑" })]]);
    const { changed, stats } = mergeAll(existing, [
      entry("run", { forms: ["ran"], examples: [ex("I run."), ex("She ran.")], meaning: "奔跑" }),
      entry("acre", { examples: [ex("4,000 acres.")] }),
    ]);
    expect(stats).toEqual({ added: 1, merged: 1, examplesAdded: 2, examplesSkipped: 1 });
    const run = existing.get("run")!;
    expect(run.forms).toEqual(["run", "ran"]);
    expect(run.examples.map((e) => e.sentence)).toEqual(["I run.", "She ran."]);
    expect(run.meaning).toBe("跑"); // 保留已有释义
    expect(changed.map((e) => e.lemma).sort()).toEqual(["acre", "run"]);
  });

  it("同一视频的同一句才算重复，不同视频的相同句子都保留", () => {
    const existing = new Map([["go", entry("go", { examples: [ex("Let's go.", "a")] })]]);
    const { stats } = mergeAll(existing, [entry("go", { examples: [ex("Let's go.", "b")] })]);
    expect(stats.examplesAdded).toBe(1);
    expect(existing.get("go")!.examples).toHaveLength(2);
  });

  it("生词本里已有的词保持原来的学习状态（已掌握的不会因重新导入变回学习中）", () => {
    const existing = new Map([["go", entry("go", { status: "mastered" })]]);
    mergeAll(existing, [entry("go", { status: "learning", examples: [ex("Go now.")] })]);
    expect(existing.get("go")!.status).toBe("mastered");
    expect(existing.get("go")!.examples).toHaveLength(1);
  });

  it("导入文件内同一 lemma 的条目互相合并，任一条是学习中则为学习中", () => {
    const fresh = new Map<string, VocabEntry>();
    const { stats } = mergeAll(fresh, [
      entry("go", { forms: ["went"], status: "mastered", examples: [ex("He went.")] }),
      entry("go", { forms: ["gone"], examples: [ex("It's gone.")] }),
    ]);
    expect(stats.added).toBe(1);
    expect(stats.merged).toBe(0);
    expect(fresh.get("go")!.forms).toEqual(["went", "gone"]);
    expect(fresh.get("go")!.examples).toHaveLength(2);
    expect(fresh.get("go")!.status).toBe("learning");
  });

  it("再次导入同一个文件不会产生重复", () => {
    const existing = new Map<string, VocabEntry>();
    const first = fromLanguageReactor(fixture, lemmatize).entries;
    mergeAll(existing, first);
    const { stats } = mergeAll(existing, fromLanguageReactor(fixture, lemmatize).entries);
    expect(stats).toEqual({ added: 0, merged: 2, examplesAdded: 0, examplesSkipped: 2 });
  });
});
