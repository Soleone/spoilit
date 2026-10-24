#!/usr/bin/env node
// Records the README loop and the stills. The extension is the real one, loaded unpacked into the recording browser,
// with the sample topics seeded and a synthetic feed standing in for Reddit. The loop reveals a hidden post, opens a thread
// where a single comment is covered, then opens a thread about a hidden topic where the whole comment section is covered,
// and ends back on the untouched feed. The hero is the feed before any click; popup.png is the real toolbar popup.
// Usage: npm run media:capture. Needs agent-browser (with its browser installed) and FFmpeg on the PATH.
import { readFile } from "node:fs/promises";
import { record } from "@soleone/showcase/capture";
import { browserArgs, extensionId, repoRoot, seedExpression } from "../demo/seed.mjs";
import { startServer } from "../demo/serve.mjs";

const server = await startServer();
const viewport = { width: 1000, height: 700 };
const media = "docs/media";

// agent-browser reads these when it opens the session, so the extension and the host rule apply to every take.
process.env.AGENT_BROWSER_EXTENSIONS = repoRoot;
process.env.AGENT_BROWSER_ARGS = browserArgs(server.port).join(",");

const hidden = `document.querySelectorAll(".spoilit-hit:not(.spoilit-revealed)").length`;

const take = () => record({
  url: "https://www.reddit.com/",
  out: `${media}/demo.webp`,
  viewport,
  width: viewport.width,
  attempts: 5,
  async start(page) {
    // Topics live in the extension's storage, which is empty in a fresh session, so seed them from an extension page.
    await page.run("open", `chrome-extension://${extensionId()}/options.html`);
    await page.eval(seedExpression);

    // The real popup, at its own width.
    await page.run("set", "viewport", "360", "300");
    await page.run("open", `chrome-extension://${extensionId()}/popup.html`);
    await page.waitFor(`document.querySelectorAll(".topic").length === 2`, { timeoutMs: 15_000 });
    await page.sleep(400);
    await page.run("screenshot", `${media}/popup.png`);

    await page.run("set", "viewport", String(viewport.width), String(viewport.height));
    await page.run("open", "https://www.reddit.com/");
    await page.waitFor(`${hidden} === 4`, { timeoutMs: 30_000 });
    await page.sleep(1200);
  },
  async drive(page) {
    await page.sleep(1200);
    await page.run("screenshot", `${media}/hero.png`);

    // 1. A hidden post is one click from visible.
    await page.run("click", "#t3_g7h8i9");
    await page.waitFor(`${hidden} === 3`);
    await page.sleep(2000);

    // 2. In a thread you can read, a single comment that names the topic is covered.
    await page.run("click", `a[href^="/r/movies/comments/j1k2l3"]`);
    await page.waitFor(`document.querySelectorAll("shreddit-comment").length === 4`);
    await page.sleep(2200);
    await page.run("click", ".back");
    await page.waitFor(`${hidden} === 4`);
    await page.sleep(900);

    // 3. A hidden post covers its whole comment section too, since replies rarely name anything.
    await page.run("click", `#t3_a1b2c3`);
    await page.sleep(300);
    await page.run("eval", `history.pushState({}, "", "/r/television/comments/a1b2c3/x/"), dispatchEvent(new PopStateEvent("popstate"))`);
    await page.waitFor(`document.querySelector("shreddit-comment-tree.spoilit-hit") !== null`);
    await page.sleep(2400);
    await page.run("eval", `history.pushState({}, "", "/"), dispatchEvent(new PopStateEvent("popstate"))`);
    await page.waitFor(`${hidden} === 4`);
    await page.sleep(1200);
  },
  async verify(page) {
    if (!(await page.eval(`${hidden} === 4`))) return "the feed did not end with four hidden posts";
  },
});

// Reads the frame count and total length from the WebP's own container, so a short encode is caught before it is kept.
function webpTiming(buffer) {
  let frames = 0;
  let durationMs = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (type === "ANMF") {
      frames += 1;
      durationMs += buffer.readUIntLE(offset + 8 + 12, 3);
    }
    offset += 8 + size + (size % 2);
  }
  return { frames, durationMs };
}

// The stream sometimes sends almost nothing during a take. Retry when the take or the file is too short.
try {
  let result;
  for (let run = 1; !result; run += 1) {
    try {
      const attempt = await take();
      if (attempt.frames < 6) throw new Error(`The take has only ${attempt.frames} stream frames`);
      const timing = webpTiming(await readFile(`${media}/demo.webp`));
      if (timing.frames < 6 || Math.abs(timing.durationMs - attempt.durationMs) > 500) {
        throw new Error(`The loop has ${timing.frames} frames and ${timing.durationMs} ms, not the ${attempt.durationMs} ms take`);
      }
      result = attempt;
    } catch (error) {
      if (run >= 3) throw error;
      console.error(`${error.message}. Recording again.`);
    }
  }
  console.log(`Wrote ${media}/demo.webp (${result.frames} frames, ${(result.durationMs / 1000).toFixed(1)} s). Check the frames in ${result.grid}.`);
  console.log(`Wrote ${media}/hero.png and ${media}/popup.png.`);
} finally {
  await server.close();
}
