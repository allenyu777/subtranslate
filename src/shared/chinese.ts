import { Converter } from "opencc-js/t2cn";
import type { VocabEntry } from "./types";

let converter: ((s: string) => string) | null = null;

/** 繁体 → 简体（Google 词典接口有时会混入繁体释义） */
export function toSimplified(text: string): string {
  if (!text) return text;
  converter ??= Converter({ from: "t", to: "cn" });
  return converter(text);
}

/** 目标语言是简体中文时，把文本统一转换成简体 */
export function normalizeChinese(text: string, target: string): string {
  return target === "zh-CN" ? toSimplified(text) : text;
}

/** 把已保存生词里的繁体释义统一转成简体（旧版本可能存进了繁体） */
export function simplifyEntry(e: VocabEntry): VocabEntry {
  return {
    ...e,
    meaning: toSimplified(e.meaning),
    examples: e.examples.map((x) => ({
      ...x,
      translation: x.translation && toSimplified(x.translation),
      ai: x.ai && {
        ...x.ai,
        partOfSpeech: toSimplified(x.ai.partOfSpeech),
        meaningInContext: toSimplified(x.ai.meaningInContext),
        explanation: toSimplified(x.ai.explanation),
        commonMeanings: toSimplified(x.ai.commonMeanings),
        phrase: toSimplified(x.ai.phrase),
        sentenceTranslation: toSimplified(x.ai.sentenceTranslation),
      },
    })),
  };
}
