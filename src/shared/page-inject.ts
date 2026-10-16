import type { PageCommand } from "../page/page-translate";

export interface PageStatus {
  engine: "google" | "ai" | null;
  done: number;
  total: number;
  failed: number;
  error: string;
}

/**
 * 把网页翻译脚本注入当前标签页并发送指令。
 * 依赖 activeTab 权限：只有用户点击扩展图标或按快捷键时才能注入。
 */
export async function translateActiveTab(action: PageCommand["action"]): Promise<PageStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("这个页面不支持翻译");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-translate.js"] });
  const res = (await chrome.tabs.sendMessage(tab.id, { type: "pageTranslate", action } satisfies PageCommand)) as
    | PageStatus
    | { error: string };
  if ("error" in res && !("engine" in res)) throw new Error(res.error);
  return res as PageStatus;
}
