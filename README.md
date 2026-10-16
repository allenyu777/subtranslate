# SubTranslate 字幕学英语

一个 Chrome 扩展：在 YouTube 上看英文视频时，

- **双语字幕**：用可点击的英文字幕替换原生字幕，下方显示中文翻译；也可以关闭自动翻译只看英文，需要时点「解析整句」
- **点词查询**：点击任意单词，弹出英美音标（IPA，与国内教材一致，可点击播放英音/美音）、词典释义和原句
- **生词本**：一键保存「单词 + 所在句子 + 视频时间点」，复习时可以点回视频的那一秒
- **词形还原去重**：`runs / ran / running` 都归到 `run`，同一个词在不同视频里遇到的例句会积累在一起
- **全局高亮**：生词本里「学习中」的词，以后在任何视频的字幕里都会被高亮
- **AI 语境解析**：让大模型判断这个词**在这句话里**到底是什么意思，是不是熟词僻义、是否属于某个短语；也可以解析整句

另外在任意网页上：

- **网页双语翻译**（类似沉浸式翻译）：点扩展图标、右键菜单或按 `Alt+A`，译文显示在每段原文下方；可选 Google 机器翻译或 AI 翻译

## 安装

需要 Node.js 18+。

```bash
npm install
npm run build
```

然后在 Chrome 打开 `chrome://extensions`，打开右上角「开发者模式」，点「加载已解压的扩展程序」，选择项目里的 `dist` 目录。

## 使用

1. 打开任意 YouTube 视频。扩展会自动开启 CC 字幕（可在设置中关闭）。如果字幕没出现，手动点一下播放器的 CC 按钮，并选择英文字幕。
2. 鼠标移到字幕上视频会自动暂停，点击单词弹出卡片：
   - **☆ 加入生词本**：保存单词和这句原句
   - **🤖 AI 解析**：解析这个词在本句中的意思（需要先配置 API Key）
   - **🔊**：朗读
3. 鼠标悬停在字幕上时出现工具栏：上一句 / 重播 / 下一句 / AI 解析整句 / 打开生词本。
4. 翻译网页：在任意网页点扩展图标，选「Google 翻译」或「AI 翻译」；或者在网页上点鼠标右键 →「SubTranslate 网页翻译」；或者按 `Alt+A`（使用上次选择的引擎，再按一次恢复原文，可在 `chrome://extensions/shortcuts` 修改）。页面右下角会出现小面板，可以随时切换引擎或显示原文。只翻译滚动到的部分，代码块和中文内容会自动跳过。
5. 点击浏览器工具栏的扩展图标 →「打开生词本」：可以搜索、筛选、标记已掌握、删除，点「▶ 时间」回到视频原句；支持导出 CSV（可导入 Anki）和 JSON 备份。
6. 从 Language Reactor 迁移：在 Language Reactor 的生词本中导出 JSON（学习阶段选「全部」），然后在本插件生词本点「导入」选择该文件。会保留单词、释义、原句、句子翻译、视频链接和时间点，跳过音频和截图；按单词原形和已有生词合并去重，重复导入也不会产生重复。

### 配置 AI 解析

在扩展设置页选择服务商并填写 API Key：

| 服务商 | 说明 |
|---|---|
| Anthropic Claude | 默认使用 Claude Opus 5.5，也可以选 Sonnet 5.5 / Haiku 5.5 降低成本 |
| OpenAI 兼容接口 | DeepSeek、通义千问、Kimi、OpenAI 等，填写 Base URL、Key 和模型名。国内网络直连建议用这个 |

API Key 只保存在本机浏览器（`chrome.storage.local`），请求由扩展后台直接发往服务商。默认需要手动点击才会调用 AI，可以在设置里开启「点开单词时自动解析」。

## 实现原理

```
YouTube 播放器发出 /api/timedtext 请求
        │  inject.js（页面主环境）hook fetch / XHR，旁听响应
        ▼
content.js（内容脚本）
  解析 json3 / XML 字幕 → 自动字幕按标点和停顿重新断句
  Shadow DOM 渲染可点击字幕，隐藏原生字幕
  requestAnimationFrame 按 video.currentTime 找当前句
        │  chrome.runtime 消息
        ▼
background.js（Service Worker）
  词形还原（wink-lemmatizer，基于 WordNet）
  Google 翻译网页接口：批量翻译字幕、查词典释义
  大模型：结构化 JSON 输出的单词 / 整句解析
        │
        ▼
chrome.storage.local：设置 + 生词本（每个 lemma 一条记录，含所有例句）
```

几个要点：

- **为什么旁听播放器请求而不是自己请求字幕**：YouTube 的字幕接口需要播放器生成的校验参数，扩展直接请求经常拿到空结果。所以需要字幕处于打开状态（扩展会自动点 CC）。
- **自动字幕断句**：自动生成的字幕是逐词滚动的，没有句子边界。扩展把所有词按时间排好，再按句末标点、超过 1.2 秒的停顿、过长（16 个词）等规则重新切成句子，这样翻译和 AI 解析都有完整的上下文。
- **生词本数据结构**：以词形还原后的 `lemma` 为主键，`forms` 记录见过的形态，`examples` 记录每个例句（句子、翻译、视频 ID、标题、时间点、AI 解析）。
- **AI 解析**：把目标词、所在句子和前后两句字幕发给模型，要求返回固定 JSON 结构（语境义、词性、解释、是否常用义、常见义、所属短语、整句翻译）。

## 开发

```bash
npm run watch      # 监听源码变化自动重新构建（改了 HTML/CSS/manifest 需重新运行）
npm test           # 单元测试
npm run typecheck  # TypeScript 类型检查
```

修改代码后在 `chrome://extensions` 点扩展卡片上的刷新按钮，再刷新 YouTube 页面。

```
src/
  manifest.json
  inject/main-world.ts   页面主环境：拦截字幕请求、自动开 CC、切换英文字幕轨
  content/
    index.ts             内容脚本主逻辑：字幕加载、渲染、翻译调度、暂停控制
    captions.ts          字幕解析与断句
    card.ts              单词卡片 / 整句解析卡片
    styles.ts, dom.ts
  background/
    index.ts             消息路由
    translate.ts         翻译与词典
    llm.ts               大模型调用（Claude SDK / OpenAI 兼容）
    pronunciation.ts     英美音标与发音
  page/
    page-translate.ts    网页双语翻译（按需注入当前标签页）
    paragraphs.ts        找出需要翻译的段落
  shared/                类型、分词、词形还原、设置、生词本存储、导出
  pages/                 生词本、设置、弹出窗口
tests/                   单元测试
```

## 已知限制

- 只支持 YouTube 的英文字幕（`/watch` 页面，不含 Shorts）。
- 网页翻译只翻译纯文本，译文中不保留原文的链接和加粗等格式；Chrome 应用商店、`chrome://` 等浏览器内部页面无法翻译。
- 翻译和词典释义使用 Google 翻译的公开网页接口，属于非官方接口，可能被限流；需要能访问 Google 的网络。
- 查词释义同时请求有道词典和 Google，谁先返回用谁；英美音标和发音来自有道，有道查不到时用 dictionaryapi.dev（Wiktionary）补充，都失败时用浏览器语音合成。查询结果在浏览器关闭前会一直缓存。
- YouTube 改版可能导致字幕拦截或播放器选择器失效。
- 词形还原没有结合词性，少数歧义词可能归错（如 `leaves` 归到 `leave`），不影响使用。
