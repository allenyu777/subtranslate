import { bg } from "../shared/messaging";
import { getSettings, saveSettings } from "../shared/settings";
import type { LlmProvider, Settings, WordAnalysis } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checkbox = (id: string) => $<HTMLInputElement>(id);
const input = (id: string) => $<HTMLInputElement | HTMLSelectElement>(id);
const statusEl = $<HTMLSpanElement>("status");

const BOOLS = ["enabled", "showTranslation", "pauseOnHover", "autoEnableCaptions", "autoAnalyze"] as const;
const LLM_FIELDS = ["anthropicKey", "anthropicModel", "openaiBaseUrl", "openaiKey", "openaiModel"] as const;

function setStatus(text: string, cls = "") {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function toggleProvider() {
  const p = input("provider").value;
  $("anthropic-fields").hidden = p !== "anthropic";
  $("openai-fields").hidden = p !== "openai";
}

function fill(s: Settings) {
  for (const k of BOOLS) checkbox(k).checked = s[k];
  input("targetLang").value = s.targetLang;
  input("fontSize").value = String(s.fontSize);
  $("fontSizeVal").textContent = String(s.fontSize);
  input("provider").value = s.llm.provider;
  for (const k of LLM_FIELDS) input(k).value = s.llm[k];
  toggleProvider();
}

function read(base: Settings): Settings {
  const s: Settings = { ...base, llm: { ...base.llm } };
  for (const k of BOOLS) s[k] = checkbox(k).checked;
  s.targetLang = input("targetLang").value;
  s.fontSize = Number(input("fontSize").value);
  s.llm.provider = input("provider").value as LlmProvider;
  for (const k of LLM_FIELDS) s.llm[k] = input(k).value.trim();
  return s;
}

/** 自定义的 OpenAI 兼容地址需要先申请访问权限 */
async function ensureHostPermission(s: Settings): Promise<boolean> {
  if (s.llm.provider !== "openai" || !s.llm.openaiBaseUrl) return true;
  let origin: string;
  try {
    origin = new URL(s.llm.openaiBaseUrl).origin + "/*";
  } catch {
    setStatus("Base URL 格式不正确", "err");
    return false;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) setStatus("没有获得访问该地址的权限，AI 解析将无法使用", "err");
  return granted;
}

async function save(): Promise<boolean> {
  const s = read(await getSettings());
  if (!(await ensureHostPermission(s))) return false;
  await saveSettings(s);
  setStatus("已保存 ✓", "ok");
  return true;
}

$("save").addEventListener("click", () => void save());
$("test").addEventListener("click", async () => {
  if (!(await save())) return;
  setStatus("测试中…");
  try {
    const res = await bg<WordAnalysis>({ type: "testLlm" });
    setStatus(`连接成功 ✓ 示例：“runs a bakery” 中 run = ${res.meaningInContext}`, "ok");
  } catch (err) {
    setStatus(`失败：${(err as Error).message}`, "err");
  }
});
input("provider").addEventListener("change", toggleProvider);

// 字幕相关的开关改动后立即生效，不需要点「保存」
async function saveDisplayOptions() {
  const cur = await getSettings();
  const s: Settings = { ...cur };
  for (const k of BOOLS) s[k] = checkbox(k).checked;
  s.targetLang = input("targetLang").value;
  s.fontSize = Number(input("fontSize").value);
  await saveSettings(s);
  setStatus("已保存 ✓", "ok");
}
for (const id of [...BOOLS, "targetLang", "fontSize"]) input(id).addEventListener("change", () => void saveDisplayOptions());
input("fontSize").addEventListener("input", () => ($("fontSizeVal").textContent = input("fontSize").value));

void getSettings().then(fill);
