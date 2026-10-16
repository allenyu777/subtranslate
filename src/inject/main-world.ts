/*
 * 运行在 YouTube 页面自身的 JS 环境（MAIN world）。
 *
 * YouTube 的字幕接口 /api/timedtext 需要播放器生成的校验参数，扩展自己去请求
 * 经常拿不到内容。所以这里改为「旁听」播放器自己发出的字幕请求：hook fetch 和
 * XMLHttpRequest，拿到响应后通过 postMessage 转交给内容脚本。
 */
export {};

const TAG = "__subtranslate";

type ToPage =
  | { type: "replay"; videoId: string }
  | { type: "enableCaptions" }
  | { type: "preferEnglish"; currentLang: string; currentKind: string };

interface PlayerTrack {
  languageCode?: string;
  kind?: string;
  vss_id?: string;
}

interface YtPlayer extends HTMLElement {
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
  getPlayerResponse?: () => {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: PlayerTrack[] } };
  };
}

const captured = new Map<string, { url: string; text: string }>();

function isTimedtext(url: string): boolean {
  return url.includes("/api/timedtext");
}

function emit(url: string, text: string) {
  if (!text) return;
  const videoId = new URL(url, location.origin).searchParams.get("v") ?? "";
  captured.set(videoId, { url, text });
  window.postMessage({ [TAG]: true, dir: "toContent", type: "timedtext", url, text }, location.origin);
}

const origFetch = window.fetch;
window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  const res = await origFetch.call(this, input, init);
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isTimedtext(url) && res.ok) {
      res
        .clone()
        .text()
        .then((t) => emit(url, t))
        .catch(() => {});
    }
  } catch {
    // 不能影响页面本身
  }
  return res;
} as typeof window.fetch;

const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  xhrUrls.set(this, String(url));
  return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const url = xhrUrls.get(this);
  if (url && isTimedtext(url)) {
    this.addEventListener("load", () => {
      try {
        if (this.status !== 200) return;
        const text =
          this.responseType === "" || this.responseType === "text"
            ? this.responseText
            : this.responseType === "json"
              ? JSON.stringify(this.response)
              : "";
        emit(url, text);
      } catch {
        // ignore
      }
    });
  }
  return origSend.call(this, body);
};

function player(): YtPlayer | null {
  return document.getElementById("movie_player") as YtPlayer | null;
}

/** 打开 CC 字幕（多次重试，因为播放器加载需要时间） */
function enableCaptions(attempt = 0) {
  const btn = document.querySelector<HTMLButtonElement>(".ytp-subtitles-button");
  const visible = btn && btn.offsetParent !== null && btn.style.display !== "none";
  if (visible) {
    if (btn.getAttribute("aria-pressed") === "false") btn.click();
    return;
  }
  if (attempt < 20) setTimeout(() => enableCaptions(attempt + 1), 500);
}

function captionTracks(): PlayerTrack[] {
  const p = player();
  const list = p?.getOption?.("captions", "tracklist");
  if (Array.isArray(list) && list.length) return list as PlayerTrack[];
  return p?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

/** 如果当前字幕不是英文，或者是自动字幕而存在人工英文字幕，就切换过去 */
function preferEnglish(currentLang: string, currentKind: string) {
  const tracks = captionTracks().filter((t) => t.languageCode?.startsWith("en"));
  const manual = tracks.find((t) => t.kind !== "asr");
  const target = manual ?? tracks[0];
  if (!target) return;
  const isEnglish = currentLang.startsWith("en");
  const isAsr = currentKind === "asr";
  if (isEnglish && !(isAsr && manual)) return;
  try {
    player()?.setOption?.("captions", "track", target);
  } catch {
    // ignore
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as ({ [TAG]?: boolean; dir?: string } & ToPage) | null;
  if (!data?.[TAG] || data.dir !== "toPage") return;
  if (data.type === "replay") {
    const hit = captured.get(data.videoId);
    if (hit) emit(hit.url, hit.text);
  } else if (data.type === "enableCaptions") {
    enableCaptions();
  } else if (data.type === "preferEnglish") {
    preferEnglish(data.currentLang, data.currentKind);
  }
});
