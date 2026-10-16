import type { Pronunciation } from "../shared/types";

/*
 * 英美音标与真人发音。
 * 1. 有道词典：音标与国内教材一致的 IPA，国内可直接访问
 * 2. dictionaryapi.dev（Wiktionary 数据）：补充有道没有的音标，以及真人录音
 */

export const EMPTY_PRON: Pronunciation = { uk: "", us: "", ukAudio: "", usAudio: "" };

/** 去掉音标两侧的 / / 或 [ ] */
export function cleanPhone(p: string | undefined): string {
  return (p ?? "").trim().replace(/^[/[\s]+|[/\]\s]+$/g, "");
}

interface YoudaoWord {
  ukphone?: string;
  usphone?: string;
  phone?: string;
}

/** 解析 dict.youdao.com/jsonapi 的返回（ec 或 simple 字段里的 ukphone / usphone） */
export function parseYoudao(data: unknown): { uk: string; us: string } {
  const d = data as { ec?: { word?: YoudaoWord[] | YoudaoWord }; simple?: { word?: YoudaoWord[] | YoudaoWord } };
  const pick = (w: YoudaoWord[] | YoudaoWord | undefined): YoudaoWord | undefined => (Array.isArray(w) ? w[0] : w);
  const words = [pick(d?.ec?.word), pick(d?.simple?.word)].filter((w): w is YoudaoWord => !!w);
  const uk = words.map((w) => cleanPhone(w.ukphone)).find(Boolean) ?? "";
  const us = words.map((w) => cleanPhone(w.usphone)).find(Boolean) ?? "";
  const general = words.map((w) => cleanPhone(w.phone)).find(Boolean) ?? "";
  return { uk: uk || general, us: us || general };
}

interface DictApiEntry {
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
}

/** 解析 dictionaryapi.dev：录音文件名以 -uk.mp3 / -us.mp3 结尾，可据此区分英美音 */
export function parseDictionaryApi(data: unknown): Pronunciation {
  const entries = Array.isArray(data) ? (data as DictApiEntry[]) : [];
  const out: Pronunciation = { ...EMPTY_PRON };
  let general = "";
  for (const e of entries) {
    general ||= cleanPhone(e.phonetic);
    for (const p of e.phonetics ?? []) {
      const text = cleanPhone(p.text);
      const audio = p.audio ?? "";
      general ||= text;
      if (/-uk\.mp3$/i.test(audio)) {
        out.uk ||= text;
        out.ukAudio ||= audio;
      } else if (/-us\.mp3$/i.test(audio)) {
        out.us ||= text;
        out.usAudio ||= audio;
      }
    }
  }
  out.uk ||= general;
  out.us ||= general;
  return out;
}

export function youdaoVoice(word: string, accent: "uk" | "us"): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${accent === "uk" ? 1 : 2}`;
}

async function getJson(url: string, ms = 4000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupPronunciation(word: string): Promise<Pronunciation> {
  const [yd, da] = await Promise.all([
    getJson(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`)
      .then(parseYoudao)
      .catch(() => ({ uk: "", us: "" })),
    getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      .then(parseDictionaryApi)
      .catch(() => ({ ...EMPTY_PRON })),
  ]);
  return {
    uk: yd.uk || da.uk,
    us: yd.us || da.us,
    // 优先用 Wiktionary 的真人录音，没有就用有道的发音
    ukAudio: da.ukAudio || youdaoVoice(word, "uk"),
    usAudio: da.usAudio || youdaoVoice(word, "us"),
  };
}
