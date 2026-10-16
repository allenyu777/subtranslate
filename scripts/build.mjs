import { context, build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { makeIcon } from "./icons.mjs";

const watch = process.argv.includes("--watch");
const out = "dist";

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/pages`, { recursive: true });
mkdirSync(`${out}/icons`, { recursive: true });

cpSync("src/manifest.json", `${out}/manifest.json`);
for (const f of ["vocab.html", "vocab.css", "options.html", "popup.html", "common.css"]) {
  cpSync(`src/pages/${f}`, `${out}/pages/${f}`);
}
for (const size of [16, 48, 128]) writeFileSync(`${out}/icons/${size}.png`, makeIcon(size));

const common = { bundle: true, target: "chrome111", sourcemap: watch ? "inline" : false, minify: !watch, logLevel: "info" };
const configs = [
  { ...common, entryPoints: { inject: "src/inject/main-world.ts", content: "src/content/index.ts" }, outdir: out, format: "iife" },
  { ...common, entryPoints: { background: "src/background/index.ts" }, outdir: out, format: "esm" },
  {
    ...common,
    entryPoints: { vocab: "src/pages/vocab.ts", options: "src/pages/options.ts", popup: "src/pages/popup.ts" },
    outdir: `${out}/pages`,
    format: "iife",
  },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log("watching…（修改 HTML/CSS/manifest 后需重新运行）");
} else {
  await Promise.all(configs.map((c) => build(c)));
}
