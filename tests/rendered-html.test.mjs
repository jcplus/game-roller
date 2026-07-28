import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>暴躁肉团子<\/title>/);
  assert.match(html, /class="game-shell"/);
  assert.match(html, /aria-label="城市破坏游戏画面"/);
  assert.match(html, /A CITY HAS 3 MINUTES LEFT/);
  assert.match(html, />03<!-- -->:<!-- -->00</);
  assert.doesNotMatch(html, /SkeletonPreview|codex-preview|Your site is taking shape/);
});

test("keeps the production entry free of starter-template code", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Game \/>/);
  assert.match(layout, /title:\s*"暴躁肉团子"/);
  assert.doesNotMatch(`${page}\n${layout}\n${packageJson}`, /SkeletonPreview|react-loading-skeleton|site-creator-vinext-starter|drizzle/i);
});
