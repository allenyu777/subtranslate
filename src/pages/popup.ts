import { getSettings, saveSettings } from "../shared/settings";
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

$("vocab").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("pages/vocab.html") }));
$("options").addEventListener("click", () => void chrome.runtime.openOptionsPage());

void init();
