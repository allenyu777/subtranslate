import Anthropic from "@anthropic-ai/sdk";
import type { SentenceAnalysis, Settings, WordAnalysis } from "../shared/types";

const WORD_SCHEMA = {
  type: "object",
  properties: {
    lemma: { type: "string", description: "该词的原形（动词原形、名词单数等）" },
    partOfSpeech: { type: "string", description: "在本句中的词性，用中文，如“动词”" },
    meaningInContext: { type: "string", description: "在本句中的具体意思，简短中文释义" },
    explanation: { type: "string", description: "为什么在这里是这个意思，1~3 句中文解释" },
    isCommonMeaning: { type: "boolean", description: "本句用的是否是这个词最常见的意思" },
    commonMeanings: { type: "string", description: "这个词最常见的 1~3 个意思，中文" },
    phrase: { type: "string", description: "如果该词属于短语/固定搭配/习语，给出完整短语和中文意思；否则为空字符串" },
    sentenceTranslation: { type: "string", description: "整句的自然中文翻译" },
  },
  required: [
    "lemma",
    "partOfSpeech",
    "meaningInContext",
    "explanation",
    "isCommonMeaning",
    "commonMeanings",
    "phrase",
    "sentenceTranslation",
  ],
  additionalProperties: false,
} as const;

const SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    translation: { type: "string", description: "整句的自然中文翻译" },
    structure: { type: "string", description: "句子结构/语法分析，中文，简明扼要" },
    keyPoints: {
      type: "array",
      description: "句中值得学习的词、短语、俚语或语法点（最多 5 个）",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "原文中的词或短语" },
          explanation: { type: "string", description: "中文解释，说明在本句中的意思和用法" },
        },
        required: ["text", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["translation", "structure", "keyPoints"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "你是一位耐心的英语老师，学生是中文母语者，正在看 YouTube 英文视频学英语。" +
  "字幕可能来自自动语音识别，可能没有标点或有少量识别错误，请结合上下文理解。" +
  "所有解释都用简体中文，简洁、准确，重点说清楚词语在这句话里的实际意思。";

function wordPrompt(word: string, sentence: string, context: string): string {
  return [
    `请解析单词 “${word}” 在下面这句字幕中的意思。`,
    "",
    `字幕：${sentence}`,
    context ? `上下文（前后几句，仅供参考）：${context}` : "",
    "",
    "特别注意：如果这里用的不是该词最常见的意思（比如熟词僻义、俚语、短语动词的一部分），要明确指出并解释。",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function sentencePrompt(sentence: string, context: string): string {
  return [
    "请解析下面这句字幕，帮助我理解它的意思和结构。",
    "",
    `字幕：${sentence}`,
    context ? `上下文（前后几句，仅供参考）：${context}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function callAnthropic(
  s: Settings,
  prompt: string,
  schema: Record<string, unknown>,
  system: string,
): Promise<unknown> {
  const client = new Anthropic({ apiKey: s.llm.anthropicKey, dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.create({
      model: s.llm.anthropicModel || "claude-opus-5-5",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      // 查词和翻译都需要快速响应，用 low effort
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      // 被安全分类器误拒时由服务端自动换模型重试
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new Error("模型拒绝回答这个请求");
    if (response.stop_reason === "max_tokens") throw new Error("模型输出被截断，请重试");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("模型没有返回内容");
    return JSON.parse(text.text);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("API Key 无效，请在设置中检查");
    if (err instanceof Anthropic.RateLimitError) throw new Error("请求太频繁，请稍后再试");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("无法连接 Anthropic API，请检查网络");
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API 错误 ${err.status}：${err.message}`);
    throw err;
  }
}

/** 从模型输出中取出 JSON（兼容 ```json 代码块） */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型返回的不是 JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

/** OpenAI 兼容接口（DeepSeek、通义千问、Kimi、OpenAI 等） */
async function callOpenAiCompatible(
  s: Settings,
  prompt: string,
  schema: Record<string, unknown>,
  system: string,
): Promise<unknown> {
  const base = s.llm.openaiBaseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.llm.openaiKey}` },
    body: JSON.stringify({
      model: s.llm.openaiModel,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${prompt}\n\n只输出一个 JSON 对象，不要输出其他内容。JSON Schema 如下：\n${JSON.stringify(schema)}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (res.status === 401) throw new Error("API Key 无效，请在设置中检查");
  if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回内容");
  return extractJson(content);
}

function call(s: Settings, prompt: string, schema: Record<string, unknown>, system = SYSTEM): Promise<unknown> {
  if (s.llm.provider === "anthropic") {
    if (!s.llm.anthropicKey) throw new Error("还没有配置 API Key，请先到设置页填写");
    return callAnthropic(s, prompt, schema, system);
  }
  if (!s.llm.openaiKey || !s.llm.openaiBaseUrl) throw new Error("还没有配置 API Key，请先到设置页填写");
  return callOpenAiCompatible(s, prompt, schema, system);
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function normalizeWordAnalysis(raw: unknown, word: string): WordAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    lemma: str(r.lemma) || word,
    partOfSpeech: str(r.partOfSpeech),
    meaningInContext: str(r.meaningInContext),
    explanation: str(r.explanation),
    isCommonMeaning: r.isCommonMeaning !== false,
    commonMeanings: str(r.commonMeanings),
    phrase: str(r.phrase),
    sentenceTranslation: str(r.sentenceTranslation),
  };
}

export function normalizeSentenceAnalysis(raw: unknown): SentenceAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const points = Array.isArray(r.keyPoints) ? r.keyPoints : [];
  return {
    translation: str(r.translation),
    structure: str(r.structure),
    keyPoints: points.map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { text: str(o.text), explanation: str(o.explanation) };
    }),
  };
}

export async function analyzeWord(s: Settings, word: string, sentence: string, context: string) {
  return normalizeWordAnalysis(await call(s, wordPrompt(word, sentence, context), WORD_SCHEMA), word);
}

export async function analyzeSentence(s: Settings, sentence: string, context: string) {
  return normalizeSentenceAnalysis(await call(s, sentencePrompt(sentence, context), SENTENCE_SCHEMA));
}

const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      description: "与输入一一对应的译文，数量和顺序必须与输入完全一致",
      items: { type: "string" },
    },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

const LANG_NAMES: Record<string, string> = { "zh-CN": "简体中文", "zh-TW": "繁體中文" };

/** 用大模型翻译网页段落，返回与输入一一对应的译文 */
export async function translateTexts(s: Settings, texts: string[], target: string, pageTitle: string): Promise<string[]> {
  const lang = LANG_NAMES[target] ?? target;
  const system =
    `你是专业译者，负责把网页内容翻译成${lang}。译文要准确、自然、符合${lang}的表达习惯，` +
    "不要逐词硬译；代码、网址、产品名和人名可以保留原文；不要添加解释或注释。";
  const prompt = [
    pageTitle ? `网页标题：${pageTitle}` : "",
    `请把下面 JSON 数组中的 ${texts.length} 段文字分别翻译成${lang}，它们来自同一个网页，请结合上下文理解。`,
    `返回的 translations 数组必须正好有 ${texts.length} 项，顺序与输入一致。`,
    "",
    JSON.stringify(texts),
  ]
    .filter((l, i) => l !== "" || i > 0)
    .join("\n");
  const raw = (await call(s, prompt, TRANSLATE_SCHEMA, system)) as { translations?: unknown };
  const out = Array.isArray(raw?.translations) ? raw.translations.map((t) => str(t)) : [];
  if (out.length !== texts.length) throw new Error(`AI 返回了 ${out.length} 段译文，应为 ${texts.length} 段`);
  return out;
}
