/*
 * 有道词典 jsonapi：一次请求同时拿到中文释义和英美音标，国内访问快。
 * 查词和音标都会用到同一个请求，这里合并重复请求。
 */
const pending = new Map<string, Promise<unknown>>();

export async function fetchJson(url: string, ms: number, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`接口返回 ${res.status}`);
    return await res.json();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("请求超时");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchYoudao(word: string): Promise<unknown> {
  const hit = pending.get(word);
  if (hit) return hit;
  const p = fetchJson(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, 5000);
  pending.set(word, p);
  // 只用来合并短时间内的重复请求，结果的长期缓存由上层负责
  const clear = () => setTimeout(() => pending.delete(word), 30_000);
  p.then(clear, () => pending.delete(word));
  return p;
}

const POS_NAMES: Record<string, string> = {
  "n.": "名词",
  "v.": "动词",
  "vt.": "动词",
  "vi.": "动词",
  "adj.": "形容词",
  "a.": "形容词",
  "adv.": "副词",
  "prep.": "介词",
  "conj.": "连词",
  "pron.": "代词",
  "int.": "感叹词",
  "interj.": "感叹词",
  "num.": "数词",
  "art.": "冠词",
  "abbr.": "缩写",
  "aux.": "助动词",
  "modal.": "情态动词",
};

type YoudaoWord = { trs?: { tr?: { l?: { i?: unknown[] } }[] }[] };

/** 解析有道释义，如 "n. 面包店；面包烘房" → { pos: "名词", terms: ["面包店", "面包烘房"] } */
export function parseYoudaoDefs(data: unknown): { pos: string; terms: string[] }[] {
  const d = data as { ec?: { word?: YoudaoWord[] | YoudaoWord } };
  const w = Array.isArray(d?.ec?.word) ? d.ec.word[0] : d?.ec?.word;
  const out: { pos: string; terms: string[] }[] = [];
  for (const trs of w?.trs ?? []) {
    for (const tr of trs.tr ?? []) {
      for (const line of tr.l?.i ?? []) {
        if (typeof line !== "string") continue;
        const m = /^((?:[a-z]+\.\s*(?:&|,)?\s*)+)(.*)$/i.exec(line.trim());
        const rawPos = m ? m[1].trim().split(/\s*[&,]\s*|\s+/)[0].toLowerCase() : "";
        const pos = POS_NAMES[rawPos] ?? rawPos;
        const terms = (m ? m[2] : line)
          .split(/[；;]/)
          .map((t) => t.trim())
          .filter(Boolean);
        if (!terms.length) continue;
        const same = out.find((e) => e.pos === pos);
        if (same) same.terms.push(...terms.filter((t) => !same.terms.includes(t)));
        else out.push({ pos, terms });
      }
    }
  }
  return out.map((e) => ({ pos: e.pos, terms: e.terms.slice(0, 6) }));
}
