import type { Pronunciation } from "../shared/types";
import { fetchJson, fetchYoudao } from "./youdao";

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

export async function lookupPronunciation(word: string): Promise<Pronunciation> {
  const yd = await fetchYoudao(word)
    .then(parseYoudao)
    .catch(() => ({ uk: "", us: "" }));
  const youdaoAudio = { ukAudio: youdaoVoice(word, "uk"), usAudio: youdaoVoice(word, "us") };
  // 有道有英美音标就直接用，不再等海外的 dictionaryapi.dev（国内访问常常要好几秒）
  if (yd.uk && yd.us) return { ...yd, ...youdaoAudio };
  const da = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, 3000)
    .then(parseDictionaryApi)
    .catch(() => ({ ...EMPTY_PRON }));
  return {
    uk: yd.uk || da.uk,
    us: yd.us || da.us,
    ukAudio: da.ukAudio || youdaoAudio.ukAudio,
    usAudio: da.usAudio || youdaoAudio.usAudio,
  };
}
