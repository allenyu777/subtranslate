type Child = Node | string | null | undefined | false;

/** 极简的 DOM 构造函数，所有文本都通过 textContent 写入，避免注入 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; title?: string; onclick?: (ev: MouseEvent) => void; [attr: string]: unknown } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "onclick") el.addEventListener("click", v as EventListener);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}
