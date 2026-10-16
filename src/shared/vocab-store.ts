import type { Example, VocabEntry, WordStatus } from "./types";

const PREFIX = "v:";
const keyOf = (lemma: string) => PREFIX + lemma;

export async function getEntry(lemma: string): Promise<VocabEntry | undefined> {
  const res = await chrome.storage.local.get(keyOf(lemma));
  return res[keyOf(lemma)] as VocabEntry | undefined;
}

export async function getAllEntries(): Promise<VocabEntry[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => v as VocabEntry);
}

/** 所有「学习中」的 lemma，用于字幕高亮 */
export async function getLearningLemmas(): Promise<Set<string>> {
  const entries = await getAllEntries();
  return new Set(entries.filter((e) => e.status === "learning").map((e) => e.lemma));
}

export async function putEntry(entry: VocabEntry): Promise<void> {
  await chrome.storage.local.set({ [keyOf(entry.lemma)]: entry });
}

export async function deleteEntry(lemma: string): Promise<void> {
  await chrome.storage.local.remove(keyOf(lemma));
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 保存一个词及其例句。同一 lemma 只有一个条目：新形态追加到 forms，
 * 新句子追加到 examples（同一视频的同一句不重复添加）。
 */
export async function addWord(params: {
  lemma: string;
  phonetic: string;
  meaning: string;
  example: Omit<Example, "id" | "addedAt">;
}): Promise<VocabEntry> {
  const now = Date.now();
  const existing = await getEntry(params.lemma);
  const entry: VocabEntry = existing ?? {
    lemma: params.lemma,
    forms: [],
    phonetic: params.phonetic,
    meaning: params.meaning,
    status: "learning",
    examples: [],
    createdAt: now,
    updatedAt: now,
  };
  const form = params.example.word.toLowerCase();
  if (!entry.forms.includes(form)) entry.forms.push(form);
  if (!entry.phonetic) entry.phonetic = params.phonetic;
  if (!entry.meaning) entry.meaning = params.meaning;
  // 重新收藏一个已掌握的词，说明又不会了
  entry.status = "learning";
  const dup = findExample(entry, params.example.sentence, params.example.videoId);
  if (dup) {
    if (params.example.ai) dup.ai = params.example.ai;
  } else {
    entry.examples.push({ ...params.example, id: newId(), addedAt: now });
  }
  entry.updatedAt = now;
  await putEntry(entry);
  return entry;
}

export function findExample(entry: VocabEntry, sentence: string, videoId: string): Example | undefined {
  return entry.examples.find((e) => e.sentence === sentence && e.videoId === videoId);
}

/** 删除一个例句；没有例句了就删除整个条目 */
export async function removeExample(lemma: string, exampleId: string): Promise<void> {
  const entry = await getEntry(lemma);
  if (!entry) return;
  entry.examples = entry.examples.filter((e) => e.id !== exampleId);
  if (entry.examples.length === 0) {
    await deleteEntry(lemma);
  } else {
    entry.updatedAt = Date.now();
    await putEntry(entry);
  }
}

export async function updateExample(lemma: string, exampleId: string, patch: Partial<Example>): Promise<void> {
  const entry = await getEntry(lemma);
  const ex = entry?.examples.find((e) => e.id === exampleId);
  if (!entry || !ex) return;
  Object.assign(ex, patch);
  await putEntry(entry);
}

export async function setStatus(lemma: string, status: WordStatus): Promise<void> {
  const entry = await getEntry(lemma);
  if (!entry) return;
  entry.status = status;
  entry.updatedAt = Date.now();
  await putEntry(entry);
}

/** 导入备份：同 lemma 的条目合并例句 */
export async function importEntries(entries: VocabEntry[]): Promise<number> {
  let count = 0;
  for (const incoming of entries) {
    if (!incoming?.lemma || !Array.isArray(incoming.examples)) continue;
    const existing = await getEntry(incoming.lemma);
    if (!existing) {
      await putEntry(incoming);
    } else {
      for (const f of incoming.forms ?? []) if (!existing.forms.includes(f)) existing.forms.push(f);
      for (const ex of incoming.examples) {
        if (!findExample(existing, ex.sentence, ex.videoId)) existing.examples.push(ex);
      }
      existing.updatedAt = Math.max(existing.updatedAt, incoming.updatedAt ?? 0);
      await putEntry(existing);
    }
    count++;
  }
  return count;
}

export function isVocabKey(key: string): boolean {
  return key.startsWith(PREFIX);
}
