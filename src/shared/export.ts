import type { VocabEntry } from "./types";

export function videoLink(videoId: string, time: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(time))}s`;
}

export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 每个例句一行，便于导入 Anki（字段：单词、释义、例句、例句翻译、语境义、视频链接） */
export function toCsv(items: VocabEntry[]): string {
  const rows = [["word", "meaning", "sentence", "sentence_translation", "context_meaning", "video"]];
  for (const e of items) {
    for (const x of e.examples) {
      rows.push([
        e.lemma,
        e.meaning,
        x.sentence,
        x.translation ?? "",
        x.ai ? `${x.ai.meaningInContext}${x.ai.explanation ? "（" + x.ai.explanation + "）" : ""}` : "",
        videoLink(x.videoId, x.time),
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
