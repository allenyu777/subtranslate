import type { BgRequest, BgResponse } from "./types";

/** 向后台发送请求，失败时抛出带中文说明的错误 */
export async function bg<T>(req: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as BgResponse<T> | undefined;
  if (!res) throw new Error("扩展后台没有响应，请刷新页面重试");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
