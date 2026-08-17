import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, inferCategories } from "../scripts/sync-data.mjs";

const fixture = `
### 2026 年 8 月 16 号添加

#### 小明(杭州) - [Github](https://github.com/xiaoming), [博客](https://example.com)
* :white_check_mark: [好工具](https://tool.example.com)：浏览器本地处理的图片工具，免费无需注册 - [源码](https://github.com/xiaoming/tool)
* :clock8: [开发中项目](https://dev.example.com/path_(test))：一个正在开发的 AI 效率工具

### 2026 年 8 月 15 号添加

#### Alice - [GitHub](https://github.com/alice)
* :x: [旧项目](https://old.example.com)：已停止维护
`;

test("parseMarkdown extracts dates, makers, links, status and products", () => {
  const result = parseMarkdown(fixture, "main");
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], {
    id: "main-20260816-xiaoming-haogongju",
    edition: "main",
    addedAt: "2026-08-16",
    maker: "小明",
    city: "杭州",
    makerLinks: [
      { label: "Github", url: "https://github.com/xiaoming" },
      { label: "博客", url: "https://example.com" }
    ],
    name: "好工具",
    url: "https://tool.example.com",
    status: "online",
    description: "浏览器本地处理的图片工具，免费无需注册",
    extraLinks: [{ label: "源码", url: "https://github.com/xiaoming/tool" }],
    categories: ["图片工具", "浏览器扩展", "免费工具"]
  });
  assert.equal(result[1].status, "developing");
  assert.equal(result[1].url, "https://dev.example.com/path_(test)");
  assert.equal(result[2].status, "inactive");
});

test("inferCategories recognizes common product themes", () => {
  assert.deepEqual(
    inferCategories("AI PDF 翻译与 OCR 图片识别效率工具，支持 macOS"),
    ["AI 工具", "图片工具", "文档办公", "效率工具", "开发工具"]
  );
});
