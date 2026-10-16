import type { Cue } from "../shared/types";

/** 从 timedtext 请求 URL 中提取的信息 */
export interface TrackInfo {
  videoId: string;
  lang: string;
  /** "asr" 表示自动生成的字幕 */
  kind: string;
  /** 非空表示这是 YouTube 的机器翻译轨 */
  tlang: string;
}

export function parseTrackUrl(url: string): TrackInfo {
  const u = new URL(url, "https://www.youtube.com");
  const p = u.searchParams;
  return {
    videoId: p.get("v") ?? "",
    lang: p.get("lang") ?? "",
    kind: p.get("kind") ?? "",
    tlang: p.get("tlang") ?? "",
  };
}

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}

interface Word {
  text: string;
  start: number;
}

/** 解析 timedtext 返回体（json3 或 XML），得到按句的字幕 */
export function parseCaptions(body: string, isAsr: boolean): Cue[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed) as { events?: Json3Event[] };
    const events = data.events ?? [];
    return isAsr || looksLikeAsr(events) ? groupAsrWords(asrWords(events)) : json3Cues(events);
  }
  return xmlCues(trimmed);
}

/** 自动字幕的事件里，一个事件包含多个带 tOffsetMs 的逐词片段 */
function looksLikeAsr(events: Json3Event[]): boolean {
  let withOffsets = 0;
  for (const e of events) if (e.segs?.some((s) => (s.tOffsetMs ?? 0) > 0)) withOffsets++;
  return withOffsets > 3;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function json3Cues(events: Json3Event[]): Cue[] {
  const cues: Cue[] = [];
  for (const e of events) {
    if (!e.segs || e.aAppend) continue;
    const text = cleanText(e.segs.map((s) => s.utf8 ?? "").join(""));
    if (!text) continue;
    const start = (e.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (e.dDurationMs ?? 2000) / 1000, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function asrWords(events: Json3Event[]): Word[] {
  const words: Word[] = [];
  for (const e of events) {
    if (!e.segs || e.aAppend) continue;
    for (const s of e.segs) {
      const text = cleanText(s.utf8 ?? "");
      if (!text) continue;
      words.push({ text, start: ((e.tStartMs ?? 0) + (s.tOffsetMs ?? 0)) / 1000 });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

const MAX_WORDS = 16;
const SOFT_MAX_WORDS = 10;
const PAUSE_SEC = 1.2;

/**
 * 自动字幕是逐词滚动出现的，没有明确的句子边界。按以下规则重新断句：
 * 遇到句末标点、停顿较长、或者词数过多时断开。
 */
export function groupAsrWords(words: Word[]): Cue[] {
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = (nextStart?: number) => {
    if (!cur.length) return;
    const last = cur[cur.length - 1];
    const naturalEnd = last.start + 0.8;
    const end = nextStart !== undefined && nextStart - last.start < 2 ? nextStart : naturalEnd;
    cues.push({ start: cur[0].start, end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const endsSentence = /[.?!]["')\]]?$/.test(prev.text);
      const endsClause = /[,;:]$/.test(prev.text);
      const paused = w.start - prev.start > PAUSE_SEC && cur.length >= 3;
      if (
        endsSentence ||
        paused ||
        cur.length >= MAX_WORDS ||
        (endsClause && cur.length >= SOFT_MAX_WORDS)
      ) {
        flush(w.start);
      }
    }
    cur.push(w);
  }
  flush();
  return cues;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** srv1：<text start="1.2" dur="3">...</text>；srv3：<p t="1200" d="3000">...</p> */
function xmlCues(xml: string): Cue[] {
  const cues: Cue[] = [];
  const srv1 = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  const srv3 = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
  const attr = (attrs: string, name: string) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? parseFloat(m[1]) : NaN;
  };
  const push = (start: number, dur: number, inner: string) => {
    const text = cleanText(decodeEntities(inner.replace(/<[^>]+>/g, "")));
    if (text && Number.isFinite(start)) cues.push({ start, end: start + (Number.isFinite(dur) ? dur : 2), text });
  };
  for (const m of xml.matchAll(srv1)) push(attr(m[1], "start"), attr(m[1], "dur"), m[2]);
  if (!cues.length) {
    for (const m of xml.matchAll(srv3)) push(attr(m[1], "t") / 1000, attr(m[1], "d") / 1000, m[2]);
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** 找到时间 t 时应显示的字幕下标（重叠时取最后开始的那条） */
export function findCueIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0 && t < cues[found].end) return found;
  return -1;
}

/** 当前没有字幕显示时，找到 t 之前最近的一条（用于「上一句」等操作） */
export function findPrevCueIndex(cues: Cue[], t: number): number {
  let found = -1;
  for (let i = 0; i < cues.length && cues[i].start <= t; i++) found = i;
  return found;
}
