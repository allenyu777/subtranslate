/*
 * 查询结果缓存：
 * - 内存：同一个查询正在进行时直接复用（悬停预取和点击不会重复请求）
 * - chrome.storage.session：后台脚本闲置约 30 秒会被浏览器休眠，内存缓存随之清空，
 *   session 存储能在浏览器关闭前一直保留
 */
const inflight = new Map<string, Promise<unknown>>();

async function readSession<T>(key: string): Promise<T | undefined> {
  try {
    const res = await chrome.storage.session.get(key);
    return res[key] as T | undefined;
  } catch {
    return undefined;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    chrome.storage.session.set({ [key]: value }).catch(() => {});
  } catch {
    // 超出配额或不可用时忽略
  }
}

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    const stored = await readSession<T>(key);
    if (stored !== undefined) return stored;
    const value = await fn();
    writeSession(key, value);
    return value;
  })();
  inflight.set(key, p);
  // 失败的查询不缓存，下次重试
  p.catch(() => inflight.delete(key));
  return p;
}
