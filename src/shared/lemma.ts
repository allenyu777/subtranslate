import lemmatizer from "wink-lemmatizer";
import { normalizeWord } from "./tokenize";

/**
 * 词形还原：ran → run，studies → study，children → child。
 *
 * 没有词性标注的情况下，依次尝试动词、名词、形容词的还原规则，取第一个
 * 发生变化的结果。目的是让同一个词的不同形态在生词本中归并到一起，
 * 所以「稳定」比「绝对正确」更重要。
 */
export function lemmatize(raw: string): string {
  const word = normalizeWord(raw);
  // 缩写（don't）和连字符词（well-known）保持原样
  if (!/^[a-z]+$/.test(word) || word.length <= 2) return word;

  const verb = lemmatizer.verb(word);
  if (verb && verb !== word) return verb;
  const noun = lemmatizer.noun(word);
  if (noun && noun !== word) return noun;
  const adj = lemmatizer.adjective(word);
  // better → good 这类不规则比较级对学习者不友好，只接受同词根的还原（bigger → big）
  if (adj && adj !== word && adj.slice(0, 3) === word.slice(0, 3)) return adj;
  return word;
}
