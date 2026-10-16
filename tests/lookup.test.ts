import { afterEach, describe, expect, it, vi } from "vitest";
import { cached } from "../src/background/cache";
import { firstWithEntries, lookupWord } from "../src/background/translate";
import { parseYoudaoDefs } from "../src/background/youdao";
import type { DictResult } from "../src/shared/types";

const delay = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const result = (word: string, entries: DictResult["entries"], translation = ""): DictResult => ({ word, entries, translation });

describe("parseYoudaoDefs", () => {
  it("解析词性和释义，合并同一词性", () => {
    const data = {
      ec: {
        word: [
          {
            trs: [
              { tr: [{ l: { i: ["n. 面包店；面包烘房"] } }] },
              { tr: [{ l: { i: ["vt. 经营；管理"] } }] },
              { tr: [{ l: { i: ["vi. 跑；奔跑；经营"] } }] },
              { tr: [{ l: { i: ["【医】烘焙"] } }] },
            ],
          },
        ],
      },
    };
    expect(parseYoudaoDefs(data)).toEqual([
      { pos: "名词", terms: ["面包店", "面包烘房"] },
      { pos: "动词", terms: ["经营", "管理", "跑", "奔跑"] },
      { pos: "", terms: ["【医】烘焙"] },
    ]);
  });
  it("没有释义或格式不对时返回空", () => {
    expect(parseYoudaoDefs({})).toEqual([]);
    expect(parseYoudaoDefs({ ec: { word: { trs: [{ tr: [{ l: { i: [{ "#text": "x" }] } }] }] } } })).toEqual([]);
  });
});

describe("firstWithEntries", () => {
  it("采用最先返回且有释义的来源，不等慢的", async () => {
    const start = Date.now();
    const r = await firstWithEntries([
      delay(20, result("a", [{ pos: "名词", terms: ["快"] }])),
      delay(2000, result("a", [{ pos: "名词", terms: ["慢"] }])),
    ]);
    expect(r.entries[0].terms).toEqual(["快"]);
    expect(Date.now() - start).toBeLessThan(500);
  });
  it("快的来源没有释义时等有释义的", async () => {
    const r = await firstWithEntries([delay(5, result("a", [])), delay(30, result("a", [{ pos: "动词", terms: ["跑"] }]))]);
    expect(r.entries[0].terms).toEqual(["跑"]);
  });
  it("一个来源失败不影响另一个；都没有释义时用机器翻译兜底", async () => {
    const r = await firstWithEntries([Promise.reject(new Error("超时")), delay(5, result("a", [], "翻译"))]);
    expect(r.translation).toBe("翻译");
    await expect(firstWithEntries([Promise.reject(new Error("超时"))])).rejects.toThrow("超时");
  });
});

describe("lookupWord", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("有道先返回时直接用有道的释义", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("youdao")) return new Response(JSON.stringify({ ec: { word: [{ trs: [{ tr: [{ l: { i: ["n. 面包店"] } }] }] }] } }));
      await delay(1500, null);
      return new Response(JSON.stringify({ sentences: [{ trans: "面包房" }], dict: [{ pos: "名词", terms: ["面包房"] }] }));
    });
    const start = Date.now();
    const d = await lookupWord("bakeryq", "bakeryq", "zh-CN");
    expect(d.entries).toEqual([{ pos: "名词", terms: ["面包店"] }]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("繁体中文时不用有道", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ sentences: [{ trans: "跑" }], dict: [{ pos: "動詞", terms: ["跑"] }] }));
    });
    const d = await lookupWord("runq", "runq", "zh-TW");
    expect(d.entries[0].pos).toBe("動詞");
    expect(urls.some((u) => u.includes("youdao"))).toBe(false);
  });
});

describe("cached", () => {
  it("同时发起的相同查询只执行一次；失败的不缓存", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await delay(10, null);
      return calls;
    };
    const [a, b] = await Promise.all([cached("k1", fn), cached("k1", fn)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);

    let n = 0;
    await expect(cached("k2", async () => (++n === 1 ? Promise.reject(new Error("x")) : n))).rejects.toThrow();
    expect(await cached("k2", async () => ++n)).toBe(2);
  });
});
