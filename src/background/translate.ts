import { normalizeChinese } from "../shared/chinese";
import type { DictResult } from "../shared/types";

/*
 * 使用 Google 翻译的公开网页接口（client=gtx，无需 API Key）。
 * 这是很多翻译插件的通用做法，但属于非官方接口，可能被限流或变更。
 */
const GT = "https://translate.googleapis.com/translate_a";

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`翻译接口返回 ${res.status}`);
  return res.json();
}

/** 解析 translate_a/t 的返回：可能是 "译文"、["译文",...] 或 [["译文","src"],...] */
export function parseBatchResponse(data: unknown, expected: number): string[] | null {
  const arr = typeof data === "string" ? [data] : Array.isArray(data) ? data : null;
  if (!arr || arr.length !== expected) return null;
  const out = arr.map((item) => (typeof item === "string" ? item : Array.isArray(item) ? String(item[0] ?? "") : null));
  return out.every((s) => s !== null) ? (out as string[]) : null;
}

/** 解析 translate_a/single?dj=1 的整句翻译结果 */
export function parseSingleTranslation(data: unknown): string {
  const d = data as { sentences?: { trans?: string }[] };
  return (d.sentences ?? []).map((s) => s.trans ?? "").join("");
}

async function translateOne(text: string, target: string): Promise<string> {
  const url = `${GT}/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
  return parseSingleTranslation(await fetchJson(url));
}

/** 批量翻译字幕，一次请求翻译多句，结果与输入一一对应 */
export async function translateBatch(texts: string[], target: string): Promise<string[]> {
  return (await translateBatchRaw(texts, target)).map((t) => normalizeChinese(t, target));
}

async function translateBatchRaw(texts: string[], target: string): Promise<string[]> {
  if (!texts.length) return [];
  const body = new URLSearchParams();
  for (const t of texts) body.append("q", t);
  try {
    const data = await fetchJson(`${GT}/t?client=gtx&sl=en&tl=${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = parseBatchResponse(data, texts.length);
    if (parsed) return parsed;
  } catch {
    // 落到下面逐句翻译
  }
  const out: string[] = [];
  for (const t of texts) out.push(await translateOne(t, target).catch(() => ""));
  return out;
}

interface GtDictResponse {
  sentences?: { trans?: string; src_translit?: string }[];
  dict?: { pos?: string; terms?: string[] }[];
}

export function parseDictResponse(word: string, data: unknown): DictResult {
  const d = data as GtDictResponse;
  const sentences = d.sentences ?? [];
  return {
    word,
    phonetic: sentences.find((s) => s.src_translit)?.src_translit ?? "",
    entries: (d.dict ?? [])
      .filter((e) => e.terms?.length)
      .map((e) => ({ pos: e.pos ?? "", terms: (e.terms ?? []).slice(0, 6) })),
    translation: parseSingleTranslation(d),
  };
}

async function lookupGoogle(word: string, target: string): Promise<DictResult> {
  const url =
    `${GT}/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&hl=${encodeURIComponent(target)}` +
    `&dt=t&dt=bd&dt=rm&dj=1&q=${encodeURIComponent(word)}`;
  return parseDictResponse(word, await fetchJson(url));
}

/** 从 dictionaryapi.dev 取音标（取不到就算了） */
async function lookupPhonetic(word: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    const data = (await res.json()) as { phonetic?: string; phonetics?: { text?: string }[] }[];
    const first = data[0];
    return first?.phonetic || first?.phonetics?.find((p) => p.text)?.text || "";
  } catch {
    return "";
  }
}

const cache = new Map<string, DictResult>();

/** 查词：优先查词形还原后的 lemma，查不到词典释义再查原词 */
export async function lookupWord(word: string, lemma: string, target: string): Promise<DictResult> {
  const key = `${target}:${lemma}:${word}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [main, phonetic] = await Promise.all([lookupGoogle(lemma, target), lookupPhonetic(lemma)]);
  let result = main;
  if (!main.entries.length && lemma !== word) {
    const alt = await lookupGoogle(word, target).catch(() => null);
    if (alt?.entries.length) result = alt;
  }
  if (phonetic) result = { ...result, phonetic };
  result = {
    ...result,
    entries: result.entries.map((e) => ({
      pos: normalizeChinese(e.pos, target),
      terms: [...new Set(e.terms.map((t) => normalizeChinese(t, target)))],
    })),
    translation: normalizeChinese(result.translation, target),
  };
  cache.set(key, result);
  return result;
}
