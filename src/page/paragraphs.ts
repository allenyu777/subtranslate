/** 插入译文用的自定义标签（不会被网页自身的 CSS 选择器命中） */
export const TRANSLATION_TAG = "st-translation";

/** 可以承载一段译文的块级元素 */
const CANDIDATE = "p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,figcaption,caption,summary,div,section,article,label";

/** 块级元素：候选元素里如果还包含这些，就交给更内层的元素处理 */
const BLOCK =
  "p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,figcaption,caption,summary,div,section,article,main,aside," +
  "header,footer,nav,ul,ol,dl,table,tr,form,fieldset,pre,figure,details,address,hr";

/** 这些区域里的内容不翻译 */
const SKIP =
  "script,style,noscript,template,code,pre,textarea,select,option,button,svg,math,kbd,samp,var," +
  '[contenteditable="true"],[contenteditable=""],[translate="no"],.notranslate,' +
  `${TRANSLATION_TAG},st-page-ui,.st-host`;

const MAX_CHARS = 5000;

/** 提取段落文字（不含已插入的译文），并压缩空白 */
export function paragraphText(el: Element, proseOnly = false): string {
  let text = "";
  const exclude = `${TRANSLATION_TAG},script,style,noscript${proseOnly ? ",code,kbd,samp,var" : ""}`;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(exclude) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.nodeValue ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/** 判断一段文字是否值得翻译：主要是英文（拉丁字母），且不是太短 */
export function shouldTranslate(text: string, isHeading = false): boolean {
  if (!text || text.length > MAX_CHARS) return false;
  const words = text.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length < (isHeading ? 1 : 2)) return false;
  const latin = words.join("").length;
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length;
  // 已经主要是中日韩文字的不翻译
  return cjk * 2 < latin;
}

/** 找出 root 下所有需要翻译的「叶子段落」 */
export function collectParagraphs(root: Element): Element[] {
  const out: Element[] = [];
  const candidates = root.matches(CANDIDATE) ? [root, ...root.querySelectorAll(CANDIDATE)] : [...root.querySelectorAll(CANDIDATE)];
  for (const el of candidates) {
    if (el.closest(SKIP)) continue;
    if (el.querySelector(BLOCK)) continue;
    if (el.querySelector(TRANSLATION_TAG)) continue;
    // 用去掉行内代码后的文字判断（只有代码的段落不翻译），翻译时仍带上代码
    if (shouldTranslate(paragraphText(el, true), /^H[1-6]$/.test(el.tagName))) out.push(el);
  }
  return out;
}
