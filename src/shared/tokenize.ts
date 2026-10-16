export interface Token {
  text: string;
  /** 是否是可点击的英文单词 */
  isWord: boolean;
}

// 字母开头，允许中间出现撇号或连字符：don't / it's / well-known
const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

/** 把一句字幕切分成「单词」和「其他字符」交替的 token 序列 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ text: text.slice(last, idx), isWord: false });
    tokens.push({ text: m[0], isWord: true });
    last = idx + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), isWord: false });
  return tokens;
}

/** 统一大小写和撇号，并去掉所有格 's：John's → john */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/'s$/, "");
}

/** 提取一段文本中所有（去重后的）规范化单词 */
export function uniqueWords(texts: string[]): string[] {
  const set = new Set<string>();
  for (const t of texts) {
    for (const tok of tokenize(t)) if (tok.isWord) set.add(normalizeWord(tok.text));
  }
  return [...set];
}
