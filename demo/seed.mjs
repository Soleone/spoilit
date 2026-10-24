// Shared by the demo launcher, the hosted build and the media capture: sample topics, browser flags and the extension's ID.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Hand-written stand-ins for what a lookup would collect, so the demo works offline. Shaped like a saved topic.
const topic = (name, description, keywords, subreddits) => ({
  id: crypto.randomUUID(),
  name,
  qid: null,
  description,
  added: Date.now(),
  enabled: true,
  keywords,
  subreddits,
  state: "ready",
  note: "Sample terms for the demo",
});

export const sampleTopics = [
  topic(
    "House of the Dragon",
    "HBO fantasy series",
    ["HotD", "Rhaenyra Targaryen", "Rhaenyra", "Daemon Targaryen", "Alicent Hightower", "Alicent", "Otto Hightower", "Aegon II", "Aemond", "Vhagar", "Syrax", "Caraxes", "Dragonstone", "Driftmark"],
    ["houseofthedragon"],
  ),
  topic(
    "Elden Ring",
    "2022 action role-playing game",
    ["Shadow of the Erdtree", "Messmer", "Radahn", "Malenia", "Miquella", "Marika", "Godrick", "Tarnished", "Limgrave", "Leyndell"],
    [],
  ),
];

// Chrome's ID for an unpacked extension: the first 16 bytes of SHA-256 over its absolute path, each nibble written as a to p.
export function extensionId(directory = repoRoot) {
  const digest = createHash("sha256").update(realpathSync(directory)).digest("hex").slice(0, 32);
  return [...digest].map((nibble) => String.fromCharCode("a".charCodeAt(0) + parseInt(nibble, 16))).join("");
}

// Points www.reddit.com at the local server and accepts its throwaway certificate.
export function browserArgs(port) {
  return [`--host-resolver-rules=MAP www.reddit.com:443 127.0.0.1:${port}`, "--ignore-certificate-errors"];
}

// Runs in an extension page, where chrome.storage is available. The content script reads the same keys.
export const seedExpression = `chrome.storage.local.set({ topics: ${JSON.stringify(sampleTopics)}, hideComments: true, paused: false }).then(() => "seeded")`;
