/** 注入到页面（light DOM）的样式：定位宿主元素、隐藏原生字幕 */
export const PAGE_CSS = `
.st-host { position: absolute; inset: 0; pointer-events: none; z-index: 60; --st-bottom: 28px; }
#movie_player:not(.ytp-autohide) > .st-host { --st-bottom: 72px; }
#movie_player.st-active .ytp-caption-window-container { display: none !important; }
`;

/** Shadow DOM 内部样式，与 YouTube 的样式完全隔离 */
export const SHADOW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: absolute; left: 50%; bottom: var(--st-bottom); transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
  max-width: 92%; pointer-events: auto;
  font-family: "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: bottom .2s ease;
}
.wrap.empty { pointer-events: none; }
.toolbar {
  display: flex; gap: 4px; margin-bottom: 4px; opacity: 0; transition: opacity .15s;
  background: rgba(20,20,20,.85); border-radius: 8px; padding: 3px;
}
.wrap:hover .toolbar { opacity: 1; }
.wrap.empty .toolbar { display: none; }
.toolbar button {
  all: unset; cursor: pointer; color: #eee; font-size: 12px; line-height: 1;
  padding: 5px 8px; border-radius: 6px; white-space: nowrap;
}
.toolbar button:hover { background: rgba(255,255,255,.15); }
.toolbar button.on { color: #ffd54f; }
.line {
  background: rgba(8,8,8,.78); border-radius: 8px; padding: 6px 14px 7px;
  text-align: center; color: #fff;
}
.en {
  font-size: calc(var(--st-font, 22px) * var(--st-scale, 1)); line-height: 1.4; font-weight: 500;
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
.zh {
  font-size: calc(var(--st-font, 22px) * var(--st-scale, 1) * .78); line-height: 1.4;
  color: #e6e6e6; margin-top: 2px;
}
.zh.pending { color: #999; }
.w { cursor: pointer; border-radius: 4px; padding: 0 1px; transition: background .1s; }
.w:hover { background: rgba(255,213,79,.35); }
.w.saved { color: #ffd54f; border-bottom: 2px solid rgba(255,213,79,.8); }
.w.active { background: rgba(66,165,245,.55); }
.hint {
  background: rgba(8,8,8,.78); color: #ddd; font-size: 13px; padding: 6px 12px; border-radius: 8px;
}

.card {
  position: absolute; bottom: calc(100% + 8px); width: 380px; max-width: 90vw;
  background: #1f1f1f; color: #eee; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.5);
  font-size: 14px; line-height: 1.55; overflow-y: auto; text-align: left;
  border: 1px solid #333; padding: 12px 14px 14px;
  scrollbar-width: thin; scrollbar-color: #555 transparent;
}
.card .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card .word { font-size: 22px; font-weight: 700; color: #fff; }
.card .lemma { color: #aaa; font-size: 13px; }
.card .phon { color: #90caf9; font-size: 13px; }
.card .spacer { flex: 1; }
.card button {
  all: unset; cursor: pointer; border-radius: 6px; padding: 3px 8px; font-size: 13px;
  background: #2e2e2e; color: #eee;
}
.card button:hover { background: #3a3a3a; }
.card button.primary { background: #f9a825; color: #1a1a1a; font-weight: 600; }
.card button.primary:hover { background: #fbc02d; }
.card button.saved { background: #2e7d32; color: #fff; }
.card button.icon { background: transparent; padding: 2px 6px; color: #aaa; }
.card button.icon:hover { color: #fff; background: #333; }
.card button.ai { background: #5e35b1; color: #fff; }
.card button.ai:hover { background: #7e57c2; }
.card .sec { margin-top: 10px; }
.card .label { color: #888; font-size: 12px; margin-bottom: 2px; }
.card .pos { color: #ffb74d; margin-right: 6px; font-size: 13px; }
.card .def { margin: 2px 0; }
.card .sent { color: #ddd; }
.card .sent b { color: #ffd54f; }
.card .muted { color: #888; }
.card .err { color: #ef9a9a; }
.card .ai-box { background: #262335; border: 1px solid #3d3560; border-radius: 8px; padding: 8px 10px; }
.card .ai-meaning { font-size: 16px; font-weight: 600; color: #fff; }
.card .tag {
  display: inline-block; font-size: 12px; padding: 0 6px; border-radius: 4px; margin-left: 6px;
  background: #b71c1c; color: #fff; vertical-align: middle;
}
.card .tag.ok { background: #2e7d32; }
.card .kp { margin: 4px 0; }
.card .kp b { color: #ffd54f; }
.card a { color: #90caf9; }
@keyframes st-spin { to { transform: rotate(360deg); } }
.spin {
  display: inline-block; width: 12px; height: 12px; border: 2px solid #777; border-top-color: transparent;
  border-radius: 50%; animation: st-spin .8s linear infinite; vertical-align: -2px; margin-right: 6px;
}
`;
