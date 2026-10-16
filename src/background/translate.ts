import { normalizeChinese } from "../shared/chinese";
import type { DictResult } from "../shared/types";
import { fetchJson as fetchWithTimeout, fetchYoudao, parseYoudaoDefs } from "./youdao";

/*
 * 使用 Google 翻译的公开网页接口（client=gtx，无需 API Key）。
 * 这是很多翻译插件的通用做法，但属于非官方接口，可能被限流或变更。
 */
const GT = "https://translate.googleapis.com/translate_a";

/** 字幕批量翻译文本较多，超时时间长一些 */
function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  return fetchWithTimeout(url, 15000, init);
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
  sentences?: { trans?: string }[];
  dict?: { pos?: string; terms?: string[] }[];
}

export function parseDictResponse(word: string, data: unknown): DictResult {
  const d = data as GtDictResponse;
  return {
    word,
    entries: (d.dict ?? [])
      .filter((e) => e.terms?.length)
      .map((e) => ({ pos: e.pos ?? "", terms: (e.terms ?? []).slice(0, 6) })),
    translation: parseSingleTranslation(d),
  };
}

async function lookupGoogle(word: string, target: string): Promise<DictResult> {
  const url =
    `${GT}/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&hl=${encodeURIComponent(target)}` +
    `&dt=t&dt=bd&dj=1&q=${encodeURIComponent(word)}`;
  return parseDictResponse(word, await fetchWithTimeout(url, 6000));
}

async function lookupYoudao(word: string): Promise<DictResult> {
  const entries = parseYoudaoDefs(await fetchYoudao(word));
  return { word, entries, translation: entries[0]?.terms[0] ?? "" };
}

/** 多个来源同时查询，采用最先返回且有释义的结果；都没有释义时用返回的机器翻译兜底 */
export function firstWithEntries(sources: Promise<DictResult>[]): Promise<DictResult> {
  return new Promise((resolve, reject) => {
    let left = sources.length;
    let fallback: DictResult | null = null;
    let lastError: unknown = new Error("查询失败");
    for (const src of sources) {
      src
        .then(
          (r) => {
            if (r.entries.length) resolve(r);
            else if (!fallback || (!fallback.translation && r.translation)) fallback = r;
          },
          (err) => (lastError = err),
        )
        .finally(() => {
          if (--left === 0) (fallback ? resolve(fallback) : reject(lastError));
        });
    }
  });
}

/** 查词：有道和 Google 同时查，谁先返回释义用谁；Google 查不到 lemma 时再查原词 */
export async function lookupWord(word: string, lemma: string, target: string): Promise<DictResult> {
  const google = lookupGoogle(lemma, target).then(async (r) => {
    if (r.entries.length || lemma === word) return r;
    const alt = await lookupGoogle(word, target).catch(() => null);
    return alt?.entries.length ? alt : r;
  });
  // 有道只提供简体中文释义
  const sources = target === "zh-CN" ? [lookupYoudao(lemma), google] : [google];
  const result = await firstWithEntries(sources);
  return {
    ...result,
    entries: result.entries.map((e) => ({
      pos: normalizeChinese(e.pos, target),
      terms: [...new Set(e.terms.map((t) => normalizeChinese(t, target)))],
    })),
    translation: normalizeChinese(result.translation, target),
  };
}
