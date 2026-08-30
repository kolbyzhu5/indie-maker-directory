// build.mjs — SSG 静态生成（P0：让搜索引擎与 AI 爬虫能看到全部产品内容）
//
// 职责：
//   1. 读取 data/projects.json，把默认视图（最近收录前 48 个）预渲染进 index.html 的 #projectGrid，
//      让无 JS 的爬虫抓 HTML 源码时也能看到产品卡片（不再是一个空壳 div）。
//   2. 静态化 hero 数字、分类计数、热门标签、ItemList 结构化数据。
//   3. 生成 sitemap.xml（域名 indiemaker.cn）、robots.txt、llms.txt / llms-full.txt（AI 爬虫导航）。
//
// 用法：
//   node scripts/build.mjs            # 生成到项目根目录（供 GitHub Pages）
//   node scripts/build.mjs --sync-dist # 额外同步到 dist/（供 EdgeOne Pages）
//
// 幂等：所有动态区域用 SSG 占位注释包裹，重复运行不会嵌套重复插入。

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://indiemaker.cn";
const PRE_RENDER = 48; // 首页预渲染卡片数（与 app.js 首屏 limit 一致）
const QUICK_TAGS = 9; // 热门分类数（与 app.js slice(0,9) 一致）

const EDITION_LABEL = { main: "大众产品", programmer: "程序员版", game: "独立游戏" };
const STATUS_LABEL = { online: "已上线", developing: "开发中", inactive: "已停止" };

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);

const escapeXML = (value = "") =>
  String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;"
  })[char]);

// 北京时间的 YYYY-MM-DD（构建/更新时间戳统一用国内时区）
function beijingDateISO(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

// 与 app.js 的 cardTemplate 保持一致的静态版本（中文快照）
function cardTemplate(project, index) {
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const tags = (project.categories || []).slice(0, 3).map((t) => `<span>${escapeHTML(t)}</span>`).join("");
  const edition = EDITION_LABEL[project.edition] || "大众产品";
  const url = escapeHTML(project.url);
  const name = escapeHTML(project.name);
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${edition}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${url}" target="_blank" rel="noreferrer">${name}</a></h2>
    <p>${escapeHTML(project.description)}</p>
    <div class="card-tags">${tags}</div>
    <div class="card-footer"><span class="maker">${escapeHTML(project.maker)}${city}</span><a class="visit" href="${url}" target="_blank" rel="noreferrer">去看看 ↗</a></div>
  </article>`;
}

function quickTagTemplate(name, count) {
  return `<button type="button" data-category="${escapeHTML(name)}">${escapeHTML(name)} <small>${count}</small></button>`;
}

function buildItemListJSONLD(projects) {
  const items = projects.slice(0, 10).map((project, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "name": project.name,
    "url": project.url
  }));
  return `<script type="application/ld+json" data-seo="itemlist">
  ${JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", "name": "中国独立开发者产品列表", "itemListElement": items })}
  </script>`;
}

// 幂等替换：占位注释区间的 [\s\S]*? 被新内容替换
function replaceBlock(html, startMarker, endMarker, content) {
  const re = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if (!re.test(html)) throw new Error(`找不到占位符：${startMarker} … ${endMarker}`);
  return html.replace(re, `${startMarker}\n${content}\n    ${endMarker}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const syncDist = process.argv.includes("--sync-dist");
  const data = JSON.parse(await readFile(path.join(ROOT, "data/projects.json"), "utf8"));
  const projects = data.projects || [];
  const counts = data.counts || {};
  const categoryCounts = data.categoryCounts || {};

  // 默认排序：最近收录在前（addedAt 降序）
  const sorted = [...projects].sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  const total = projects.length;
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, QUICK_TAGS);
  const generatedDate = new Date(data.generatedAt || Date.now()).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });

  const cards = sorted.slice(0, PRE_RENDER).map(cardTemplate).join("\n    ");
  const quickTags = topCategories.map(([name, count]) => quickTagTemplate(name, count)).join("");
  const itemList = buildItemListJSONLD(sorted);

  let html = await readFile(path.join(ROOT, "index.html"), "utf8");

  // 1) 预渲染产品卡片
  html = replaceBlock(html, "<!--SSG_PROJECTS_START-->", "<!--SSG_PROJECTS_END-->", cards);
  // 2) 热门分类标签
  html = replaceBlock(html, "<!--SSG_QUICKTAGS_START-->", "<!--SSG_QUICKTAGS_END-->", quickTags);
  // 3) ItemList 结构化数据
  html = replaceBlock(html, "<!--SSG_ITEMLIST_START-->", "<!--SSG_ITEMLIST_END-->", itemList);

  // 4) hero 数字、分类计数、同步时间、结果数（幂等正则替换）
  html = html.replace(/<strong id="heroTotal">[^<]*<\/strong>/, `<strong id="heroTotal">${total.toLocaleString("zh-CN")}</strong>`);
  html = html.replace(/<b id="countAll">[^<]*<\/b>/, `<b id="countAll">${total}</b>`);
  html = html.replace(/<b id="countMain">[^<]*<\/b>/, `<b id="countMain">${counts.main || 0}</b>`);
  html = html.replace(/<b id="countProgrammer">[^<]*<\/b>/, `<b id="countProgrammer">${counts.programmer || 0}</b>`);
  html = html.replace(/<b id="countGame">[^<]*<\/b>/, `<b id="countGame">${counts.game || 0}</b>`);
  html = html.replace(/<time id="syncTime"[^>]*>[^<]*<\/time>/, `<time id="syncTime" data-i18n="heroLoading">更新于 ${generatedDate}</time>`);
  html = html.replace(/<span id="resultCount"[^>]*>[^<]*<\/span>/, `<span id="resultCount" data-i18n="resultsLoading">找到 ${total.toLocaleString("zh-CN")} 件作品</span>`);

  // 5) sitemap.xml
  const lastmod = beijingDateISO();
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

  // 6) robots.txt
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml

# AI 爬虫显式放行（默认 Allow: / 已覆盖，此处列明便于未来精细控制）
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: Bytespider
Allow: /
`;

  // 7) llms.txt（AI 爬虫导航，遵循 llmstxt.org 规范）
  const categoryLines = topCategories.map(([name, count]) => `- ${name}（${count}）`).join("\n");
  const llms = `# 独立制造所（Indie Maker）

> 中国独立开发者产品导航：发现独立开发者创造的网站、应用、工具与游戏。每日从 GitHub 自动同步，收录 ${total} 个产品，无竞价排名。

## 关于本站
- 名称：独立制造所（Indie Maker）
- 一句话：好产品，不该埋在几千行 README 里。
- 数据源：https://github.com/1c7/chinese-independent-developer
- 更新时间：${lastmod}（北京时间）
- 语言：中文 / English（双语切换）

## 热门分类
${categoryLines}

## 完整数据
- [全部产品清单](${SITE_URL}/llms-full.txt)：${total} 个产品的名称、链接、开发者、分类、状态与简介（供 AI 索引全文）
- [产品导航首页](${SITE_URL}/)：可交互的浏览 / 搜索 / 筛选界面

## 分版
- 大众产品：${counts.main || 0}
- 程序员版：${counts.programmer || 0}
- 独立游戏：${counts.game || 0}
`;

  // 8) llms-full.txt（全部产品，按 edition 分组，每个产品一行 + 简介）
  const editionGroups = [
    ["main", "大众产品"],
    ["programmer", "程序员版"],
    ["game", "独立游戏"]
  ];
  const sections = editionGroups.map(([edition, label]) => {
    const list = sorted.filter((p) => p.edition === edition);
    const items = list.map((p) => {
      const cats = (p.categories || []).join(" / ");
      const status = STATUS_LABEL[p.status] || p.status;
      const city = p.city ? `（${p.city}）` : "";
      return `- **[${p.name}](${p.url})** — 开发者 ${p.maker}${city} · ${cats || "未分类"} · ${status} · 收录 ${p.addedAt}\n  ${p.description || ""}`;
    }).join("\n\n");
    return `## ${label}（${list.length}）\n\n${items}`;
  }).join("\n\n");

  const llmsFull = `# 独立制造所 · 全部产品清单（${total}）

> 数据源：https://github.com/1c7/chinese-independent-developer
> 更新时间：${lastmod}（北京时间）
> 说明：本清单供 AI 搜索引擎与爬虫全文索引；人类读者请访问 ${SITE_URL}/ 使用交互式浏览。

${sections}
`;

  // 写入根目录
  const targets = [
    ["index.html", html],
    ["sitemap.xml", sitemap],
    ["robots.txt", robots],
    ["llms.txt", llms],
    ["llms-full.txt", llmsFull]
  ];
  for (const [file, content] of targets) {
    await writeFile(path.join(ROOT, file), content, "utf8");
    console.log(`[build] 已生成 ${file}`);
  }

  // 同步到 dist（供 EdgeOne Pages 手动部署）
  if (syncDist) {
    const distDirs = [path.join(ROOT, "dist"), path.join(ROOT, "dist", ".edgeone", "assets")];
    for (const dir of distDirs) {
      await mkdir(dir, { recursive: true });
      for (const [file, content] of targets) {
        await writeFile(path.join(dir, file), content, "utf8");
      }
      // 数据文件同步（app.js 运行时回退数据源）
      await mkdir(path.join(dir, "data"), { recursive: true });
      await copyFile(path.join(ROOT, "data", "projects.json"), path.join(dir, "data", "projects.json"));
      // og:image 用的 PNG（社交分享图）
      await copyFile(path.join(ROOT, "preview.png"), path.join(dir, "preview.png"));
    }
    console.log("[build] 已同步到 dist/（EdgeOne Pages 部署源）");
  }

  console.log(`[build] 完成：${total} 个产品，预渲染 ${Math.min(PRE_RENDER, total)} 张卡片，sitemap/robots/llms 均已生成。`);
}

main().catch((error) => {
  console.error("[build] 失败：", error);
  process.exit(1);
});
