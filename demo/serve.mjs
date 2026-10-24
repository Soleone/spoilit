// Serves the synthetic feed over HTTPS so the extension's content script runs on the host it matches.
// Browsers are pointed at it with --host-resolver-rules (see seed.mjs), so www.reddit.com resolves here.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture/index.html");

// A throwaway certificate for www.reddit.com, made per run so no private key is committed.
async function makeCertificate() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spoilit-demo-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  await exec("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath,
    "-subj", "/CN=www.reddit.com", "-addext", "subjectAltName=DNS:www.reddit.com",
  ]).catch((error) => {
    throw new Error(`openssl is needed to make the demo certificate: ${error.message}`);
  });
  return { dir, key: await readFile(keyPath), cert: await readFile(certPath) };
}

// Every path returns the page, because the feed routes itself with the History API like the real site does.
export async function startServer({ port = 0 } = {}) {
  const tls = await makeCertificate();
  const page = await readFile(fixture);
  const server = createServer({ key: tls.key, cert: tls.cert }, (request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(tls.dir, { recursive: true, force: true });
    },
  };
}
