import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  showTranslation: true,
  pauseOnHover: true,
  autoEnableCaptions: true,
  autoAnalyze: false,
  fontSize: 22,
  targetLang: "zh-CN",
  pageEngine: "google",
  llm: {
    provider: "anthropic",
    anthropicKey: "",
    anthropicModel: "claude-opus-5-5",
    openaiBaseUrl: "https://api.deepseek.com/v1",
    openaiKey: "",
    openaiModel: "deepseek-chat",
  },
};

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  const s = (settings ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...s, llm: { ...DEFAULT_SETTINGS.llm, ...(s.llm ?? {}) } };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export function isLlmConfigured(s: Settings): boolean {
  return s.llm.provider === "anthropic" ? !!s.llm.anthropicKey : !!(s.llm.openaiKey && s.llm.openaiBaseUrl);
}
