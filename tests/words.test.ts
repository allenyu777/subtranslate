import { describe, expect, it } from "vitest";
import { lemmatize } from "../src/shared/lemma";
import { normalizeWord, tokenize, uniqueWords } from "../src/shared/tokenize";

describe("tokenize", () => {
  it("切分单词与标点，保留缩写和连字符词", () => {
    const toks = tokenize("Don't stop, it's well-known!");
    expect(toks.filter((t) => t.isWord).map((t) => t.text)).toEqual(["Don't", "stop", "it's", "well-known"]);
    expect(toks.map((t) => t.text).join("")).toBe("Don't stop, it's well-known!");
  });
  it("数字和符号不算单词", () => {
    expect(tokenize("[Music] 2024 >> ok").filter((t) => t.isWord).map((t) => t.text)).toEqual(["Music", "ok"]);
  });
});

describe("normalizeWord", () => {
  it("小写、统一撇号、去掉所有格", () => {
    expect(normalizeWord("John’s")).toBe("john");
    expect(normalizeWord("DON'T")).toBe("don't");
  });
});

describe("uniqueWords", () => {
  it("去重", () => {
    expect(uniqueWords(["The cat", "the Cat's toy"]).sort()).toEqual(["cat", "the", "toy"]);
  });
});

describe("lemmatize", () => {
  it.each([
    ["running", "run"],
    ["ran", "run"],
    ["went", "go"],
    ["studies", "study"],
    ["children", "child"],
    ["buses", "bus"],
    ["bigger", "big"],
    ["Looked", "look"],
    ["better", "better"],
    ["don't", "don't"],
    ["well-known", "well-known"],
    ["happily", "happily"],
  ])("%s → %s", (word, lemma) => {
    expect(lemmatize(word)).toBe(lemma);
  });
});
