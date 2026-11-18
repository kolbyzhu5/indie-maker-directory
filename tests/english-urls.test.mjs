import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEnglishDeepPages } from "../scripts/en-pages.mjs";

const original = "https://example.com/zh/?source=one";
const english = "https://example.com/en/?source=one&language=en";
const project = {id: "one", name: "Example", maker: "Maker", city: "", description: "Example", status: "online", edition: "main", addedAt: "2026-01-01", categories: [], makerLinks: [], url: original};
function render(englishUrlMap) {
  const ctx = {siteUrl: "https://directory.example", umamiScript: "", organizationLd: "{}", projects: [project], slugMap: new Map([["one", "example"]]), categorySlugs: {}, descEnMap: {}, nameEnMap: {}, relatedMap: new Map(), primaryCatMap: new Map(), allCats: [], englishUrlMap};
  return buildEnglishDeepPages(ctx).find(([name]) => name === "en/p/example.html")[1];
}
function destination(html) {
  return html.match(/<a class="btn-primary" href="([^"]+)"/)[1];
}
test("English page uses a same-origin HTTPS override with escaped query", () => {
  const html = render({one: english});
  assert.equal(destination(html), english.replaceAll("&", "&amp;"));
  assert.ok(html.includes('"url":"' + english + '"'));
  assert.ok(html.includes('rel="noreferrer"'));
  assert.equal(project.url, original);
});
for (const candidate of [undefined, "not a URL", "http://example.com/en/", "https://evil.example/en/", "https://user@example.com/en/"]) {
  test(`invalid or absent override falls back: ${candidate}`, () => {
    assert.equal(destination(render({one: candidate})), original);
  });
}
test("configured Bazi Diff URL stays on the original product origin", () => {
  const overrides = JSON.parse(readFileSync(new URL("../data/english-urls.json", import.meta.url)));
  const data = JSON.parse(readFileSync(new URL("../data/projects.json", import.meta.url)));
  const project = data.projects.find(p => p.id === "main-20261117-chilayt-bazi-diff");
  assert.ok(project, "the mapped project ID must exist in synced data");
  assert.equal(new URL(overrides[project.id]).origin, new URL(project.url).origin);
  assert.equal(new URL(overrides[project.id]).searchParams.get("utm_campaign"), "work_style_en");
});
