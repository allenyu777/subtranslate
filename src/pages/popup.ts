import { translateActiveTab } from "../shared/page-inject";
import { getSettings, isLlmConfigured, saveSettings } from "../shared/settings";
import { getAllEntries } from "../shared/vocab-store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await getSettings();
  const enabled = $<HTMLInputElement>("enabled");
  const showTr = $<HTMLInputElement>("showTranslation");
  enabled.checked = s.enabled;
  showTr.checked = s.showTranslation;
  const update = async () => {
    const cur = await getSettings();
    await saveSettings({ ...cur, enabled: enabled.checked, showTranslation: showTr.checked });
  };
  enabled.addEventListener("change", () => void update());
  showTr.addEventListener("change", () => void update());

  const entries = await getAllEntries();
  const learning = entries.filter((e) => e.status === "learning").length;
  $("count").textContent = `生词本：${entries.length} 个词（学习中 ${learning}）`;
}

async function pageTranslate(action: "google" | "ai" | "off") {
  const status = $("page-status");
  status.className = "muted";
  if (action === "ai" && !isLlmConfigured(await getSettings())) {
    status.className = "err";
    status.textContent = "请先在设置中配置大模型 API Key";
    return;
  }
  status.textContent = action === "off" ? "" : "翻译中…";
  try {
    if (action !== "off") {
      // 记住选择，快捷键也用这个引擎
      const cur = await getSettings();
      await saveSettings({ ...cur, pageEngine: action });
    }
    await translateActiveTab(action);
    if (action !== "off") window.close();
  } catch (err) {
    status.className = "err";
    status.textContent = (err as Error).message.includes("Cannot access")
      ? "浏览器不允许在这个页面运行扩展"
      : (err as Error).message;
  }
}

$("page-google").addEventListener("click", () => void pageTranslate("google"));
$("page-ai").addEventListener("click", () => void pageTranslate("ai"));
$("page-off").addEventListener("click", () => void pageTranslate("off"));
void chrome.commands.getAll().then((cmds) => {
  const key = cmds.find((c) => c.name === "translate-page")?.shortcut;
  $("shortcut").textContent = key || "未设置";
});

$("vocab").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("pages/vocab.html") }));
$("options").addEventListener("click", () => void chrome.runtime.openOptionsPage());

void init();
