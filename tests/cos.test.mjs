import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadToCOS, computeChanges, inferCategories } from "../scripts/sync-data.mjs";

test("COS 未配置时跳过上传（幂等）", async () => {
  delete process.env.COS_SECRET_ID;
  delete process.env.COS_SECRET_KEY;
  delete process.env.COS_BUCKET;
  delete process.env.COS_REGION;
  const result = await uploadToCOS("{}", "data/projects.json");
  assert.equal(result.uploaded, false);
  assert.equal(result.reason, "not-configured");
});

test("增量 diff：新增/更新/移除识别正确", () => {
  const prev = [
    { url: "https://a.com", name: "A", status: "online", description: "a" },
    { url: "https://b.com", name: "B", status: "online", description: "b" },
    { url: "https://c.com", name: "C", status: "online", description: "c" }
  ];
  const curr = [
    { url: "https://a.com", name: "A", status: "online", description: "a" },   // 不变
    { url: "https://b.com", name: "B-新", status: "online", description: "b" }, // 更新
    { url: "https://d.com", name: "D", status: "developing", description: "d" } // 新增
  ];
  const changes = computeChanges(prev, curr);
  assert.equal(changes.added.length, 1);
  assert.equal(changes.added[0].name, "D");
  assert.equal(changes.updated.length, 1);
  assert.equal(changes.updated[0].name, "B-新");
  assert.equal(changes.removed.length, 1);
  assert.equal(changes.removed[0].url, "https://c.com");
});

test("分类推断与人工收录格式兼容", () => {
  const categories = inferCategories("AI PDF 翻译工具 支持 macOS");
  assert.ok(categories.includes("AI 工具"));
  assert.ok(categories.includes("文档办公"));
});
