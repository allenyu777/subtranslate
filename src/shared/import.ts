import type { Example, VocabEntry } from "./types";
import { newId } from "./vocab-store";

/*
 * 生词本导入：支持本插件的 JSON 备份，以及 Language Reactor 导出的 JSON。
 * 导入时按 lemma 去重合并：已有的词只追加新例句，同一视频的同一句不重复添加。
 */

export interface ImportStats {
  /** 新增的单词 */
  added: number;
  /** 合并到已有单词的条目 */
  merged: number;
  examplesAdded: number;
  /** 重复而跳过的例句 */
  examplesSkipped: number;
}

export const emptyStats = (): ImportStats => ({ added: 0, merged: 0, examplesAdded: 0, examplesSkipped: 0 });

const sameExample = (a: Example, b: Example) => a.sentence === b.sentence && a.videoId === b.videoId;

/** 把 incoming 合并进 target（就地修改 target） */
export function mergeEntry(target: VocabEntry, incoming: VocabEntry, stats: ImportStats) {
  for (const f of incoming.forms ?? []) if (!target.forms.includes(f)) target.forms.push(f);
  if (!target.meaning && incoming.meaning) target.meaning = incoming.meaning;
  if (!target.pron && incoming.pron) target.pron = incoming.pron;
  // 任何一边还在学习，就保持「学习中」（继续在字幕里高亮）
  if (incoming.status === "learning") target.status = "learning";
  for (const ex of incoming.examples ?? []) {
    if (target.examples.some((e) => sameExample(e, ex))) {
      stats.examplesSkipped++;
    } else {
      target.examples.push(ex);
      stats.examplesAdded++;
    }
  }
  target.createdAt = Math.min(target.createdAt, incoming.createdAt ?? target.createdAt);
  target.updatedAt = Math.max(target.updatedAt, incoming.updatedAt ?? 0);
}

/**
 * 把导入的条目合并进已有生词本，返回需要写入的条目。
 * existing 会被就地更新；导入文件里 lemma 相同的条目也会互相合并。
 */
export function mergeAll(existing: Map<string, VocabEntry>, incoming: VocabEntry[]) {
  const stats = emptyStats();
  const changed = new Map<string, VocabEntry>();
  const addedLemmas = new Set<string>();
  for (const inc of incoming) {
    if (!inc?.lemma || !Array.isArray(inc.examples)) continue;
    const cur = existing.get(inc.lemma);
    if (cur) {
      if (!addedLemmas.has(inc.lemma)) stats.merged++;
      mergeEntry(cur, inc, stats);
      changed.set(cur.lemma, cur);
    } else {
      const copy: VocabEntry = { ...inc, forms: [...(inc.forms ?? [])], examples: [] };
      mergeEntry(copy, { ...inc, forms: [] }, stats);
      existing.set(copy.lemma, copy);
      changed.set(copy.lemma, copy);
      addedLemmas.add(copy.lemma);
      stats.added++;
    }
  }
  return { changed: [...changed.values()], stats };
}

// ---------- Language Reactor ----------

interface LrToken {
  form?: { text?: string };
  lemma?: { text?: string };
}

interface LrItem {
  key?: string;
  itemType?: string;
  learningStage?: string;
  timeCreated_ms?: number;
  timeModified_ms?: number;
  word?: { text?: string };
  phrase?: { text?: string };
  wordTranslationsArr?: string[];
  context?: {
    wordIndex?: number;
    phrase?: {
      subtitles?: Record<string, string> | string[];
      mTranslations?: Record<string, string> | string[] | null;
      hTranslations?: Record<string, string> | string[] | null;
      subtitleTokens?: Record<string, LrToken[]> | LrToken[][];
      reference?: {
        source?: string;
        diocoDocId?: string;
        diocoDocName?: string;
        startTime_ms?: number;
      };
    };
  };
}

export function isLanguageReactorExport(data: unknown): data is LrItem[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((x) => typeof (x as LrItem)?.key === "string" && /^(WORD|PHRASE)\|/.test((x as LrItem).key!))
  );
}

const at = <T>(obj: Record<string, T> | T[] | null | undefined, k: string): T | undefined =>
  obj == null ? undefined : Array.isArray(obj) ? obj[Number(k)] : obj[k];

const keysOf = (obj: Record<string, unknown> | unknown[] | null | undefined): string[] =>
  obj == null ? [] : Array.isArray(obj) ? obj.map((_, i) => String(i)) : Object.keys(obj);

/**
 * Language Reactor 保存的是「前一句 / 本句 / 后一句」三行字幕，wordIndex 是单词在本句分词结果中的位置。
 * 找出单词所在的那一句，以及单词在句子中的原始形态。
 */
function locateSentence(item: LrItem, headword: string): { key: string; form: string } | null {
  const phrase = item.context?.phrase;
  const subs = phrase?.subtitles;
  const keys = keysOf(subs);
  if (!keys.length) return null;
  const idx = item.context?.wordIndex;
  const target = headword.toLowerCase();
  if (typeof idx === "number") {
    for (const k of keys) {
      const tok = at(phrase?.subtitleTokens, k)?.[idx];
      const lemma = tok?.lemma?.text?.toLowerCase();
      const form = tok?.form?.text ?? "";
      if (lemma === target || form.toLowerCase() === target) return { key: k, form };
    }
  }
  // 没有分词信息时：找包含这个词的那一句，否则取中间那句
  const hit = keys.find((k) => (at(subs, k) ?? "").toLowerCase().includes(target));
  return { key: hit ?? (keys.includes("1") ? "1" : keys[0]), form: "" };
}

/** 视频链接只支持 YouTube（diocoDocId 形如 "yt_xxxxxxxxxxx"） */
function youtubeId(docId: string | undefined): string {
  return docId?.startsWith("yt_") ? docId.slice(3) : "";
}

const cleanTranslation = (s: string | undefined) => (s ?? "").replace(/^[\s。，、,.]+/, "").trim();

/**
 * 转换 Language Reactor 导出的条目。lemmaOf 用本插件的词形还原规则统一 lemma，
 * 保证和插件里已有的词能正确合并。
 */
export function fromLanguageReactor(items: LrItem[], lemmaOf: (word: string) => string) {
  const entries: VocabEntry[] = [];
  let skipped = 0;
  for (const item of items) {
    const isPhrase = item.itemType === "PHRASE" || item.key?.startsWith("PHRASE|");
    const headword = (item.word?.text ?? item.phrase?.text ?? item.key?.split("|")[1] ?? "").trim();
    // 只导入英文
    if (!headword || (item.key && !item.key.endsWith("|en"))) {
      skipped++;
      continue;
    }
    const lemma = isPhrase || /\s/.test(headword) ? headword.toLowerCase() : lemmaOf(headword);
    const created = item.timeCreated_ms ?? Date.now();
    const loc = locateSentence(item, headword);
    const phrase = item.context?.phrase;
    const ref = phrase?.reference;
    const examples: Example[] = [];
    const sentence = loc ? (at(phrase?.subtitles, loc.key) ?? "").trim() : "";
    if (loc && sentence) {
      examples.push({
        id: newId(),
        word: loc.form || headword,
        sentence,
        translation: cleanTranslation(at(phrase?.hTranslations, loc.key) ?? at(phrase?.mTranslations, loc.key)) || undefined,
        videoId: youtubeId(ref?.diocoDocId),
        videoTitle: ref?.diocoDocName ?? "",
        time: (ref?.startTime_ms ?? 0) / 1000,
        addedAt: created,
      });
    }
    const forms = [...new Set([headword.toLowerCase(), ...(loc?.form ? [loc.form.toLowerCase()] : [])])];
    entries.push({
      lemma,
      forms,
      meaning: (item.wordTranslationsArr ?? []).filter(Boolean).slice(0, 5).join("；"),
      status: item.learningStage === "KNOWN" ? "mastered" : "learning",
      examples,
      createdAt: created,
      updatedAt: item.timeModified_ms ?? created,
    });
  }
  return { entries, skipped };
}
