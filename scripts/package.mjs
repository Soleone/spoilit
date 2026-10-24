#!/usr/bin/env node
// `npm run package`: zips only the files the extension needs, ready to upload to the Chrome Web Store.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const out = path.join(root, "dist", `spoilit-${version}.zip`);

mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync(
  "zip",
  ["-r", "-q", out, "manifest.json", "background.js", "content.js", "content.css", "match.js", "sources.js", "words.js", "popup.html", "popup.css", "popup.js", "options.html", "options.js", "ui.css", "icons"],
  { cwd: root },
);
console.log(`Wrote ${path.relative(root, out)}`);
