// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { collectParagraphs, paragraphText, shouldTranslate, TRANSLATION_TAG } from "../src/page/paragraphs";

describe("shouldTranslate", () => {
  it("英文段落需要翻译", () => {
    expect(shouldTranslate("The quick brown fox jumps.")).toBe(true);
  });
  it("太短、纯数字、主要是中文的不翻译", () => {
    expect(shouldTranslate("OK")).toBe(false);
    expect(shouldTranslate("2024-10-16 12:30")).toBe(false);
    expect(shouldTranslate("这是一段中文内容，里面有 API 这个词")).toBe(false);
  });
  it("标题允许只有一个单词", () => {
    expect(shouldTranslate("Introduction")).toBe(false);
    expect(shouldTranslate("Introduction", true)).toBe(true);
  });
});

describe("collectParagraphs", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article>
        <h1>Introduction</h1>
        <p>This is the <a href="#">first</a> paragraph of the article.</p>
        <div><p>Nested paragraph inside a div wrapper.</p></div>
        <ul><li>First list item text</li><li>Second <b>list</b> item</li></ul>
        <div class="card">Some text directly inside a div element.</div>
        <pre>const code = "should not be translated";</pre>
        <p><code>npm install something here</code></p>
        <p class="notranslate">Brand Name Should Stay</p>
        <p>这是一段中文，不需要翻译。</p>
        <blockquote><p>Quoted paragraph text here.</p></blockquote>
        <table><tr><td>Table cell with words</td><td>42</td></tr></table>
        <button>Click this button now</button>
      </article>`;
  });

  it("只返回最内层的英文段落，跳过代码、按钮、notranslate 和中文", () => {
    const texts = collectParagraphs(document.body).map((el) => paragraphText(el));
    expect(texts).toEqual([
      "Introduction",
      "This is the first paragraph of the article.",
      "Nested paragraph inside a div wrapper.",
      "First list item text",
      "Second list item",
      "Some text directly inside a div element.",
      "Quoted paragraph text here.",
      "Table cell with words",
    ]);
  });

  it("提取文字时排除已插入的译文，已翻译的段落不会再次收集", () => {
    const p = document.querySelector("p")!;
    const tr = document.createElement(TRANSLATION_TAG);
    tr.textContent = "这是文章的第一段。";
    p.append(tr);
    expect(paragraphText(p)).toBe("This is the first paragraph of the article.");
    expect(collectParagraphs(document.body)).not.toContain(p);
  });
});
