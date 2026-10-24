// `npm run demo:web`: builds the hosted demo into dist/web. The synthetic feed from demo/fixture gets the extension's
// own match.js, content.js and content.css inline, after a small chrome.* stand-in seeded with the sample topics, so
// the real hiding code runs in any browser. A control strip stands in for the toolbar popup.
// Every path serves index.html (see vercel.json), because the feed routes itself with the History API.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, sampleTopics } from "../seed.mjs";

const out = path.join(repoRoot, "dist/web");
const read = (file) => readFile(path.join(repoRoot, file), "utf8");
// Keeps a "</script>" inside a source file from closing the inline tag.
const inline = (code) => code.replaceAll("</script", "<\\/script");

// chrome.storage.local, chrome.runtime.sendMessage and the badge count, kept in localStorage so a reload keeps your topics.
const chromeStandIn = `
(() => {
  const KEY = "spoilit-demo";
  const seed = { topics: ${JSON.stringify(sampleTopics)}, hideComments: true, paused: false };
  const load = () => { try { return { ...seed, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...seed }; } };
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const data = load();
          const result = Object.fromEntries([].concat(keys).map((key) => [key, data[key]]));
          setTimeout(() => callback(result));
        },
        set(values) {
          const before = load();
          try { localStorage.setItem(KEY, JSON.stringify({ ...before, ...values })); } catch {}
          const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: before[key], newValue }]));
          setTimeout(() => listeners.forEach((listener) => listener(changes, "local")));
          return Promise.resolve();
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
    runtime: {
      // The content script reports its hidden count to the background worker for the toolbar badge; here it feeds the strip.
      sendMessage(message) { if (message.type === "count") { window.spoilitCount = message.count; dispatchEvent(new CustomEvent("spoilit-count", { detail: message.count })); } },
    },
  };
})();`;

const style = `
  #demo-banner { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; justify-content: center; padding: 10px 16px;
    background: #f2f2ef; color: #17181a; font: 14px/1.4 system-ui, sans-serif; text-align: center; }
  #demo-banner a { color: inherit; font-weight: 600; }
  #demo-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 10px 20px; background: #101316;
    border-bottom: 1px solid #23282d; font: 13px/1.3 system-ui, sans-serif; color: #c3c9cf; }
  #demo-controls .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  #demo-controls button, #demo-controls input:not([type=checkbox]) { font: inherit; color: inherit; border: 1px solid #2f353b; border-radius: 999px; background: #181c20; padding: 5px 12px; }
  #demo-controls button { cursor: pointer; }
  #demo-controls button:hover { border-color: #5a626b; }
  #demo-controls button[aria-pressed=true] { background: #e6e8ea; color: #101316; border-color: #e6e8ea; }
  #demo-controls .add { display: flex; gap: 6px; }
  #demo-controls .add input { border-radius: 8px; width: 190px; }
  #demo-controls .add button { border-radius: 8px; }
  #demo-controls .side { display: flex; align-items: center; gap: 12px; margin-left: auto; }
  #demo-controls .check { display: flex; align-items: center; gap: 6px; }
  #demo-controls .count { color: #8b939b; font-variant-numeric: tabular-nums; }
  @media (max-width: 640px) { #demo-controls { padding: 10px 16px; } #demo-controls .side { margin-left: 0; } }`;

const banner = `
  <div id="demo-banner">
    <span><strong>Spoilit live demo.</strong> A simulated feed with invented posts, not Reddit. The extension's own code does the hiding, and nothing leaves your browser. Click a dark bar to reveal it, open a post to see its comments covered, or add your own keyword.</span>
    <a href="https://github.com/Soleone/spoilit">Get the extension</a>
  </div>
  <div id="demo-controls"></div>`;

// In the extension, content scripts run at document_start, before the page; the head is the closest a page can get.
const extensionScripts = `
  <style>
${await read("content.css")}
  </style>
  <script>${chromeStandIn}</script>
  <script>
${inline(await read("match.js"))}
  </script>
  <script>
// The extension runs this in its own isolated world; the wrapper keeps it apart from the page script the same way.
(() => {
${inline(await read("content.js"))}
})();
  </script>`;

let page = await read("demo/fixture/index.html");
page = page
  .replace("<title>Demo feed</title>", "<title>Spoilit live demo</title>")
  .replace("</style>\n</head>", `</style>\n  <style>${style}\n  </style>${extensionScripts}\n</head>`)
  .replace("<body>", `<body>${banner}`)
  .replace("</body>", `  <script>\n${inline(await read("demo/web/panel.js"))}\n  </script>\n</body>`);

await mkdir(out, { recursive: true });
await writeFile(path.join(out, "index.html"), page);
await writeFile(path.join(out, "vercel.json"), JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }, null, 2));
console.log(`Wrote ${path.relative(repoRoot, out)}: index.html, vercel.json`);
