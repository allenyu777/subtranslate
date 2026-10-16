/** 一条字幕（一句话） */
export interface Cue {
  /** 开始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
  text: string;
}

/** AI 对「某个词在这句话里」的解析 */
export interface WordAnalysis {
  lemma: string;
  partOfSpeech: string;
  meaningInContext: string;
  explanation: string;
  isCommonMeaning: boolean;
  commonMeanings: string;
  phrase: string;
  sentenceTranslation: string;
}

/** AI 对整句的解析 */
export interface SentenceAnalysis {
  translation: string;
  structure: string;
  keyPoints: { text: string; explanation: string }[];
}

/** 英美音标（IPA，不含两侧斜杠）和发音音频地址 */
export interface Pronunciation {
  uk: string;
  us: string;
  ukAudio: string;
  usAudio: string;
}

/** 词典查询结果 */
export interface DictResult {
  word: string;
  /** 按词性分组的中文释义，如 { pos: "动词", terms: ["跑", "运行"] } */
  entries: { pos: string; terms: string[] }[];
  /** 机器翻译（词典没有收录时兜底） */
  translation: string;
}

/** 生词本里的一个例句 */
export interface Example {
  id: string;
  /** 在句子中出现的原始形态，如 "ran" */
  word: string;
  sentence: string;
  translation?: string;
  videoId: string;
  videoTitle: string;
  /** 这句字幕在视频中的开始时间（秒） */
  time: number;
  addedAt: number;
  ai?: WordAnalysis;
}

export type WordStatus = "learning" | "mastered";

/** 生词本条目：以词形还原后的 lemma 为主键去重 */
export interface VocabEntry {
  lemma: string;
  /** 见过的所有形态，如 ["ran", "running"] */
  forms: string[];
  /** 旧版本保存的音标（来源不统一，已不再显示） */
  phonetic?: string;
  /** 英美音标；undefined 表示还没查过 */
  pron?: Pronunciation;
  /** 词典释义摘要 */
  meaning: string;
  status: WordStatus;
  examples: Example[];
  createdAt: number;
  updatedAt: number;
}

export type LlmProvider = "anthropic" | "openai";

export interface Settings {
  enabled: boolean;
  showTranslation: boolean;
  pauseOnHover: boolean;
  autoEnableCaptions: boolean;
  /** 打开单词卡片时自动调用 AI 解析 */
  autoAnalyze: boolean;
  fontSize: number;
  targetLang: string;
  /** 快捷键翻译网页时使用的引擎 */
  pageEngine: "google" | "ai";
  llm: {
    provider: LlmProvider;
    anthropicKey: string;
    anthropicModel: string;
    openaiBaseUrl: string;
    openaiKey: string;
    openaiModel: string;
  };
}

/** 内容脚本 → 后台 的消息 */
export type BgRequest =
  | { type: "lemmatize"; words: string[] }
  | { type: "translate"; texts: string[]; target: string }
  | { type: "lookup"; word: string; lemma: string; target: string }
  | { type: "pronounce"; word: string }
  | { type: "analyzeWord"; word: string; sentence: string; context: string }
  | { type: "analyzeSentence"; sentence: string; context: string }
  | { type: "aiTranslate"; texts: string[]; target: string; title: string }
  | { type: "testLlm" }
  | { type: "openPage"; page: "vocab" | "options" };

export type BgResponse<T> = { ok: true; data: T } | { ok: false; error: string };
