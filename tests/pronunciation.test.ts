import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPhone, lookupPronunciation, parseDictionaryApi, parseYoudao } from "../src/background/pronunciation";

describe("音标解析", () => {
  it("去掉两侧的斜杠和方括号", () => {
    expect(cleanPhone("/ˈbeɪkəri/")).toBe("ˈbeɪkəri");
    expect(cleanPhone("[ həˈləʊ ]")).toBe("həˈləʊ");
    expect(cleanPhone(undefined)).toBe("");
  });

  it("有道：ec 字段中的英美音标", () => {
    expect(parseYoudao({ ec: { word: [{ ukphone: "ˈbeɪkəri", usphone: "ˈbeɪkəri" }] } })).toEqual({
      uk: "ˈbeɪkəri",
      us: "ˈbeɪkəri",
    });
  });
  it("有道：只有 simple 字段或通用音标", () => {
    expect(parseYoudao({ simple: { word: [{ ukphone: "həˈləʊ", usphone: "həˈloʊ" }] } })).toEqual({
      uk: "həˈləʊ",
      us: "həˈloʊ",
    });
    expect(parseYoudao({ ec: { word: { phone: "rʌn" } } })).toEqual({ uk: "rʌn", us: "rʌn" });
    expect(parseYoudao({})).toEqual({ uk: "", us: "" });
  });

  it("dictionaryapi.dev：按录音文件名区分英美音", () => {
    const p = parseDictionaryApi([
      {
        phonetic: "/ˈwɔːtə/",
        phonetics: [
          { text: "/ˈwɔːtə/", audio: "https://x/media/water-uk.mp3" },
          { text: "/ˈwɔtɚ/", audio: "https://x/media/water-us.mp3" },
        ],
      },
    ]);
    expect(p).toEqual({
      uk: "ˈwɔːtə",
      us: "ˈwɔtɚ",
      ukAudio: "https://x/media/water-uk.mp3",
      usAudio: "https://x/media/water-us.mp3",
    });
  });
  it("dictionaryapi.dev：没有区分时英美都用通用音标", () => {
    expect(parseDictionaryApi([{ phonetics: [{ text: "/rʌn/", audio: "" }] }])).toEqual({
      uk: "rʌn",
      us: "rʌn",
      ukAudio: "",
      usAudio: "",
    });
  });
});

describe("lookupPronunciation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("有道音标优先，Wiktionary 真人录音优先，缺失时用有道发音", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("youdao")
        ? new Response(JSON.stringify({ ec: { word: [{ ukphone: "ˈwɔːtə(r)", usphone: "ˈwɔːtər" }] } }))
        : new Response(JSON.stringify([{ phonetics: [{ text: "/ˈwɔtɚ/", audio: "https://x/water-us.mp3" }] }])),
    );
    expect(await lookupPronunciation("water")).toEqual({
      uk: "ˈwɔːtə(r)",
      us: "ˈwɔːtər",
      ukAudio: "https://dict.youdao.com/dictvoice?audio=water&type=1",
      usAudio: "https://x/water-us.mp3",
    });
  });

  it("有道不可用时退回 dictionaryapi.dev", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("youdao")
        ? new Response("blocked", { status: 403 })
        : new Response(JSON.stringify([{ phonetic: "/rʌn/" }])),
    );
    const p = await lookupPronunciation("run");
    expect([p.uk, p.us]).toEqual(["rʌn", "rʌn"]);
  });
});
