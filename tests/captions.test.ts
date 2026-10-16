import { describe, expect, it } from "vitest";
import { decodeEntities, findCueIndex, groupAsrWords, parseCaptions, parseTrackUrl } from "../src/content/captions";

describe("parseTrackUrl", () => {
  it("提取视频 ID、语言、字幕类型", () => {
    const info = parseTrackUrl("/api/timedtext?v=abc123&lang=en&kind=asr&fmt=json3&pot=xyz");
    expect(info).toEqual({ videoId: "abc123", lang: "en", kind: "asr", tlang: "" });
  });
  it("识别机器翻译轨", () => {
    expect(parseTrackUrl("https://www.youtube.com/api/timedtext?v=a&lang=en&tlang=zh-Hans").tlang).toBe("zh-Hans");
  });
});

describe("parseCaptions json3（人工字幕）", () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1000 },
      { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: "Hello there,\nmy friend." }] },
      { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: "How " }, { utf8: "are you?" }] },
      { tStartMs: 6000, dDurationMs: 100, segs: [{ utf8: "\n" }] },
    ],
  });
  it("每个事件一条字幕，换行合并为空格，跳过空事件", () => {
    expect(parseCaptions(body, false)).toEqual([
      { start: 1, end: 3.5, text: "Hello there, my friend." },
      { start: 4, end: 6, text: "How are you?" },
    ]);
  });
});

describe("parseCaptions json3（自动字幕）", () => {
  const body = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: "so" }, { utf8: " today", tOffsetMs: 300 }, { utf8: " we're", tOffsetMs: 700 }] },
      { tStartMs: 1400, dDurationMs: 10, aAppend: 1, segs: [{ utf8: "\n" }] },
      { tStartMs: 1500, dDurationMs: 4000, segs: [{ utf8: "going" }, { utf8: " to", tOffsetMs: 200 }, { utf8: " cook.", tOffsetMs: 400 }] },
      { tStartMs: 3000, dDurationMs: 3000, segs: [{ utf8: "First" }, { utf8: " we", tOffsetMs: 300 }] },
    ],
  });
  it("逐词合并，并在句末标点处断句", () => {
    const cues = parseCaptions(body, true);
    expect(cues.map((c) => c.text)).toEqual(["so today we're going to cook.", "First we"]);
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBe(3); // 下一句开始
  });
});

describe("groupAsrWords", () => {
  it("长停顿时断句", () => {
    const words = ["a", "b", "c", "d"].map((text, i) => ({ text, start: i < 3 ? i * 0.3 : 5 }));
    expect(groupAsrWords(words).map((c) => c.text)).toEqual(["a b c", "d"]);
  });
  it("过长时强制断句", () => {
    const words = Array.from({ length: 20 }, (_, i) => ({ text: `w${i}`, start: i * 0.2 }));
    const cues = groupAsrWords(words);
    expect(cues[0].text.split(" ")).toHaveLength(16);
    expect(cues[1].text.split(" ")).toHaveLength(4);
  });
});

describe("parseCaptions XML", () => {
  it("srv1 格式并解码实体", () => {
    const xml = `<?xml version="1.0"?><transcript><text start="1.5" dur="2">I&#39;m here &amp; ready</text></transcript>`;
    expect(parseCaptions(xml, false)).toEqual([{ start: 1.5, end: 3.5, text: "I'm here & ready" }]);
  });
  it("srv3 格式", () => {
    const xml = `<timedtext><body><p t="1000" d="2000"><s>Hi</s><s> there</s></p></body></timedtext>`;
    expect(parseCaptions(xml, false)).toEqual([{ start: 1, end: 3, text: "Hi there" }]);
  });
  it("decodeEntities", () => {
    expect(decodeEntities("&quot;a&quot; &#x27;b&#x27; &lt;c&gt;")).toBe(`"a" 'b' <c>`);
  });
});

describe("findCueIndex", () => {
  const cues = [
    { start: 0, end: 2, text: "a" },
    { start: 2, end: 4, text: "b" },
    { start: 6, end: 8, text: "c" },
  ];
  it("返回当前时间的字幕", () => {
    expect(findCueIndex(cues, 0)).toBe(0);
    expect(findCueIndex(cues, 3.9)).toBe(1);
    expect(findCueIndex(cues, 7)).toBe(2);
  });
  it("间隙中返回 -1", () => {
    expect(findCueIndex(cues, 5)).toBe(-1);
    expect(findCueIndex(cues, 9)).toBe(-1);
  });
});
