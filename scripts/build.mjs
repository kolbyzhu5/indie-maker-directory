// build.mjs — SSG 静态生成（P0 + P1：让搜索引擎与 AI 爬虫能看到全部产品内容）
//
// 职责：
//   1. 读取 data/projects.json，把默认视图（最近收录前 48 个）预渲染进 index.html 的 #projectGrid，
//      让无 JS 的爬虫抓 HTML 源码时也能看到产品卡片（不再是一个空壳 div）。
//   2. 静态化 hero 数字、分类计数、热门标签、ItemList 结构化数据。
//   3. 生成 sitemap.xml（域名 indiemaker.cn）、robots.txt、llms.txt / llms-full.txt（AI 爬虫导航）。
//   4. [P1] 为每个产品生成独立详情页（/p/{slug}.html，含 SoftwareApplication 结构化数据），
//      为每个分类生成落地页（/c/{slug}.html，含 CollectionPage + ItemList 结构化数据）。
//   5. [P1] sitemap 扩展到全量 URL（首页 + 12 分类 + 全部产品详情页）。
//
// 用法：
//   node scripts/build.mjs            # 生成到项目根目录（供 GitHub Pages）
//   node scripts/build.mjs --sync-dist # 额外同步到 dist/（供 EdgeOne Pages）
//
// 幂等：所有动态区域用 SSG 占位注释包裹，重复运行不会嵌套重复插入。
//
// ⚠️ slug 生成逻辑（asciiSlug / hash8 / buildSlugMap）必须与 app.js 中完全一致，
//    否则运行时卡片上的「详情」链接会 404。改这里务必同步改 app.js。

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://indiemaker.cn";
const PRE_RENDER = 48; // 首页预渲染卡片数（与 app.js 首屏 limit 一致）
const QUICK_TAGS = 9; // 热门分类数（与 app.js slice(0,9) 一致）
const RELATED_COUNT = 6; // 详情页「同分类推荐」数量

const EDITION_LABEL = { main: "大众产品", programmer: "程序员版", game: "独立游戏" };
const STATUS_LABEL = { online: "已上线", developing: "开发中", inactive: "已停止" };

// 分类英文 slug 映射（分类页 URL：/c/{slug}.html）
const CATEGORY_SLUGS = {
  "AI 工具": "ai-tools",
  "音视频": "audio-video",
  "生活服务": "lifestyle",
  "游戏娱乐": "games",
  "免费工具": "free-tools",
  "效率工具": "productivity",
  "浏览器扩展": "browser-extensions",
  "社交社区": "social",
  "开发工具": "dev-tools",
  "教育学习": "education",
  "文档办公": "docs-office",
  "图片工具": "image-tools",
  "未分类": "uncategorized"
};

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

// ── slug 生成（与 app.js 完全一致） ──────────────────────────────
function asciiSlug(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hash8(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// 生成 id -> slug 映射：name 的 ASCII slug 唯一则直接用，冲突时追加 id 的短 hash 兜底
function buildSlugMap(projects) {
  const baseCount = new Map();
  for (const p of projects) {
    const base = asciiSlug(p.name) || "project";
    baseCount.set(base, (baseCount.get(base) || 0) + 1);
  }
  const map = new Map();
  for (const p of projects) {
    const base = asciiSlug(p.name) || "project";
    map.set(p.id, baseCount.get(base) === 1 ? base : `${base}-${hash8(p.id).slice(0, 6)}`);
  }
  return map;
}
// ───────────────────────────────────────────────────────────────

// 与 app.js 的 cardTemplate 保持一致的静态版本（中文快照），含详情页链接
function cardTemplate(project, index, slugMap) {
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const tags = (project.categories || []).slice(0, 3).map((t) => `<span>${escapeHTML(t)}</span>`).join("");
  const edition = EDITION_LABEL[project.edition] || "大众产品";
  const url = escapeHTML(project.url);
  const name = escapeHTML(project.name);
  const slug = slugMap.get(project.id);
  const detail = slug ? `<span class="card-links"><a class="detail" href="/p/${slug}.html">详情</a><a class="visit" href="${url}" target="_blank" rel="noreferrer">去看看 ↗</a></span>` : `<a class="visit" href="${url}" target="_blank" rel="noreferrer">去看看 ↗</a>`;
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${edition}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${url}" target="_blank" rel="noreferrer">${name}</a></h2>
    <p>${escapeHTML(project.description)}</p>
    <div class="card-tags">${tags}</div>
    <div class="card-footer"><span class="maker">${escapeHTML(project.maker)}${city}</span>${detail}</div>
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

// ── P1：产品详情页 ─────────────────────────────────────────────
function renderProductPage(project, slug, slugMap, related) {
  const name = escapeHTML(project.name);
  const desc = escapeHTML(project.description);
  const maker = escapeHTML(project.maker);
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const edition = EDITION_LABEL[project.edition] || "大众产品";
  const status = STATUS_LABEL[project.status] || escapeHTML(project.status);
  const url = escapeHTML(project.url);
  const categories = project.categories || [];
  const primaryCategory = categories[0] || "未分类";
  const catSlug = CATEGORY_SLUGS[primaryCategory] || "uncategorized";

  const breadcrumb = `<a href="/">首页</a><span class="sep">›</span><a href="/c/${catSlug}.html">${escapeHTML(primaryCategory)}</a><span class="sep">›</span><span class="current">${name}</span>`;
  const tags = categories.map((c) => {
    const cs = CATEGORY_SLUGS[c] || "uncategorized";
    return `<a href="/c/${cs}.html">${escapeHTML(c)}</a>`;
  }).join("");
  const extraLinks = (project.makerLinks || []).map((l) => `<a class="btn-ghost" href="${escapeHTML(l.url)}" target="_blank" rel="noreferrer">${escapeHTML(l.label)}</a>`).join("");

  const relatedCards = related.map((p) => {
    const ps = slugMap.get(p.id);
    return `<article class="project-card">
      <div class="card-top"><span class="edition-badge">${EDITION_LABEL[p.edition] || "大众产品"}</span><time class="card-date">${p.addedAt}</time></div>
      <h2><a href="/p/${ps}.html">${escapeHTML(p.name)}</a></h2>
      <p>${escapeHTML(p.description)}</p>
      <div class="card-footer"><span class="maker">${escapeHTML(p.maker)}</span><a class="visit" href="/p/${ps}.html">详情 ↗</a></div>
    </article>`;
  }).join("");

  const softwareApp = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": project.name,
    "description": project.description,
    "url": project.url,
    "applicationCategory": primaryCategory,
    "operatingSystem": "Web",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "CNY" },
    "author": { "@type": "Person", "name": project.maker },
    "datePublished": project.addedAt,
    "inLanguage": "zh-CN"
  });
  const breadcrumbLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "首页", "item": `${SITE_URL}/` },
      { "@type": "ListItem", "position": 2, "name": primaryCategory, "item": `${SITE_URL}/c/${catSlug}.html` },
      { "@type": "ListItem", "position": 3, "name": project.name }
    ]
  });

  const relatedSection = relatedCards
    ? `<section class="related"><h2>同分类推荐</h2><div class="related-grid">${relatedCards}</div></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name} - 独立制造所</title>
  <meta name="description" content="${desc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/p/${slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="独立制造所">
  <meta property="og:title" content="${name} - 独立制造所">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${SITE_URL}/p/${slug}.html">
  <meta property="og:image" content="${SITE_URL}/preview.png">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${name} - 独立制造所">
  <meta name="twitter:description" content="${desc}">
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${softwareApp}</script>
  <script type="application/ld+json">${breadcrumbLD}</script>
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>独立制造所</strong><small>中国独立开发者产品志</small></span>
    </a>
    <nav class="top-nav" aria-label="主要导航"><a href="/#directory">逛产品</a></nav>
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑">${breadcrumb}</nav>
    <article class="detail-card">
      <div class="detail-head"><span class="edition-badge">${edition}</span><time>${project.addedAt} 收录</time></div>
      <h1>${name}</h1>
      <p class="detail-desc">${desc}</p>
      <div class="detail-meta"><span><b>开发者</b>${maker}${city}</span><span><b>状态</b>${status}</span></div>
      <div class="detail-tags">${tags}</div>
      <div class="detail-actions">
        <a class="btn-primary" href="${url}" target="_blank" rel="noreferrer">访问官网 ↗</a>
        ${extraLinks}
      </div>
    </article>
    ${relatedSection}
  </main>
  <footer class="detail-footer">
    <p>独立制造所 · 让认真做出来的东西被看见</p>
    <p><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
    <p><a href="/">返回产品导航</a></p>
  </footer>
</body>
</html>
`;
}

// ── P1：分类落地页 ─────────────────────────────────────────────
function renderCategoryPage(category, catSlug, products, slugMap, allCategories) {
  const count = products.length;
  const catNav = allCategories.map(([c, n]) => {
    const cs = CATEGORY_SLUGS[c];
    const active = c === category ? ' class="active"' : "";
    return `<a href="/c/${cs}.html"${active}>${escapeHTML(c)}（${n}）</a>`;
  }).join("");

  const cards = products.map((p) => {
    const slug = slugMap.get(p.id);
    const city = p.city ? ` · ${escapeHTML(p.city)}` : "";
    const tags = (p.categories || []).slice(0, 3).map((t) => `<span>${escapeHTML(t)}</span>`).join("");
    return `<article class="project-card">
      <div class="card-top"><span class="edition-badge">${EDITION_LABEL[p.edition] || "大众产品"}</span><time class="card-date">${p.addedAt}</time></div>
      <h2><a href="/p/${slug}.html">${escapeHTML(p.name)}</a></h2>
      <p>${escapeHTML(p.description)}</p>
      <div class="card-tags">${tags}</div>
      <div class="card-footer"><span class="maker">${escapeHTML(p.maker)}${city}</span><span class="card-links"><a class="detail" href="/p/${slug}.html">详情</a><a class="visit" href="${escapeHTML(p.url)}" target="_blank" rel="noreferrer">去看看 ↗</a></span></div>
    </article>`;
  }).join("");

  const collectionLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": `${category} - 独立制造所`,
    "url": `${SITE_URL}/c/${catSlug}.html`,
    "description": `独立制造所「${category}」分类，共收录 ${count} 个中国独立开发者产品，每日同步更新。`,
    "mainEntity": {
      "@type": "ItemList",
      "name": `${category}产品列表`,
      "numberOfItems": count,
      "itemListElement": products.slice(0, 20).map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "name": p.name,
        "url": `${SITE_URL}/p/${slugMap.get(p.id)}.html`
      }))
    }
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(category)} - 独立制造所</title>
  <meta name="description" content="独立制造所「${escapeHTML(category)}」分类：共收录 ${count} 个中国独立开发者产品，每日同步更新。">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/c/${catSlug}.html">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="独立制造所">
  <meta property="og:title" content="${escapeHTML(category)} - 独立制造所">
  <meta property="og:description" content="共收录 ${count} 个中国独立开发者产品">
  <meta property="og:url" content="${SITE_URL}/c/${catSlug}.html">
  <meta property="og:image" content="${SITE_URL}/preview.png">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary">
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${collectionLD}</script>
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>独立制造所</strong><small>中国独立开发者产品志</small></span>
    </a>
    <nav class="top-nav" aria-label="主要导航"><a href="/#directory">逛产品</a></nav>
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/">首页</a><span class="sep">›</span><span class="current">${escapeHTML(category)}</span></nav>
    <div class="category-head">
      <h1>${escapeHTML(category)}</h1>
      <p class="category-count">共收录 <b>${count}</b> 个产品</p>
      <nav class="category-nav" aria-label="分类导航">${catNav}</nav>
    </div>
    <div class="category-grid">${cards}</div>
  </main>
  <footer class="detail-footer">
    <p>独立制造所 · 让认真做出来的东西被看见</p>
    <p><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
    <p><a href="/">返回产品导航</a></p>
  </footer>
</body>
</html>
`;
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

  // [P1] slug 映射 + 按主分类分组（用于详情页「同分类推荐」）
  const slugMap = buildSlugMap(projects);
  const byPrimaryCategory = new Map();
  for (const p of projects) {
    const cat = (p.categories && p.categories[0]) || "未分类";
    if (!byPrimaryCategory.has(cat)) byPrimaryCategory.set(cat, []);
    byPrimaryCategory.get(cat).push(p);
  }
  for (const list of byPrimaryCategory.values()) {
    list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  const cards = sorted.slice(0, PRE_RENDER).map((p, i) => cardTemplate(p, i, slugMap)).join("\n    ");
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

  // 5) sitemap.xml（全量 URL：首页 + 分类 + 产品详情页）
  const lastmod = beijingDateISO();
  const sitemapUrls = [];
  sitemapUrls.push(`  <url><loc>${SITE_URL}/</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`);
  for (const [cat, catSlug] of Object.entries(CATEGORY_SLUGS)) {
    sitemapUrls.push(`  <url><loc>${SITE_URL}/c/${catSlug}.html</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  }
  for (const p of sorted) {
    const slug = slugMap.get(p.id);
    sitemapUrls.push(`  <url><loc>${SITE_URL}/p/${slug}.html</loc><lastmod>${p.addedAt}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join("\n")}
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
  const categoryLines = Object.entries(CATEGORY_SLUGS).map(([name, catSlug]) => {
    const count = categoryCounts[name] || 0;
    return `- [${name}](${SITE_URL}/c/${catSlug}.html)：${count} 个产品`;
  }).join("\n");
  const llms = `# 独立制造所（Indie Maker）

> 中国独立开发者产品导航：发现独立开发者创造的网站、应用、工具与游戏。每日从 GitHub 自动同步，收录 ${total} 个产品，无竞价排名。

## 关于本站
- 名称：独立制造所（Indie Maker）
- 一句话：好产品，不该埋在几千行 README 里。
- 数据源：https://github.com/1c7/chinese-independent-developer
- 更新时间：${lastmod}（北京时间）
- 语言：中文 / English（双语切换）

## 分类导航
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
      const detailUrl = `${SITE_URL}/p/${slugMap.get(p.id)}.html`;
      return `- **[${p.name}](${p.url})** — 开发者 ${p.maker}${city} · ${cats || "未分类"} · ${status} · 收录 ${p.addedAt} · [详情页](${detailUrl})\n  ${p.description || ""}`;
    }).join("\n\n");
    return `## ${label}（${list.length}）\n\n${items}`;
  }).join("\n\n");

  const llmsFull = `# 独立制造所 · 全部产品清单（${total}）

> 数据源：https://github.com/1c7/chinese-independent-developer
> 更新时间：${lastmod}（北京时间）
> 说明：本清单供 AI 搜索引擎与爬虫全文索引；人类读者请访问 ${SITE_URL}/ 使用交互式浏览。

${sections}
`;

  // 写入根目录（根文件）
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

  // [P1] 生成产品详情页（/p/）与分类页（/c/）
  await mkdir(path.join(ROOT, "p"), { recursive: true });
  await mkdir(path.join(ROOT, "c"), { recursive: true });

  // 分类页
  const categoryEntries = Object.entries(CATEGORY_SLUGS).map(([cat, catSlug]) => {
    const productsInCat = cat === "未分类"
      ? sorted.filter((p) => !p.categories || p.categories.length === 0)
      : sorted.filter((p) => (p.categories || []).includes(cat));
    return [cat, catSlug, productsInCat];
  });
  // 分类导航计数（含「未分类」），用于每个分类页顶部的导航条
  const allCategoryCounts = categoryEntries.map(([cat, , productsInCat]) => [cat, productsInCat.length])
    .sort((a, b) => b[1] - a[1]);
  for (const [cat, catSlug, productsInCat] of categoryEntries) {
    const page = renderCategoryPage(cat, catSlug, productsInCat, slugMap, allCategoryCounts);
    await writeFile(path.join(ROOT, "c", `${catSlug}.html`), page, "utf8");
  }
  console.log(`[build] 已生成 ${categoryEntries.length} 个分类页`);

  // 产品详情页
  let generatedProducts = 0;
  for (const p of sorted) {
    const slug = slugMap.get(p.id);
    const cat = (p.categories && p.categories[0]) || "未分类";
    const siblings = byPrimaryCategory.get(cat) || [];
    const related = siblings.filter((x) => x.id !== p.id).slice(0, RELATED_COUNT);
    const page = renderProductPage(p, slug, slugMap, related);
    await writeFile(path.join(ROOT, "p", `${slug}.html`), page, "utf8");
    generatedProducts++;
  }
  console.log(`[build] 已生成 ${generatedProducts} 个产品详情页`);

  // 同步到 dist（供 EdgeOne Pages 手动部署）
  if (syncDist) {
    const dist = path.join(ROOT, "dist");
    await mkdir(dist, { recursive: true });
    for (const [file, content] of targets) {
      await writeFile(path.join(dist, file), content, "utf8");
    }
    // 数据文件 + 静态资源同步
    await mkdir(path.join(dist, "data"), { recursive: true });
    await copyFile(path.join(ROOT, "data", "projects.json"), path.join(dist, "data", "projects.json"));
    await copyFile(path.join(ROOT, "preview.png"), path.join(dist, "preview.png"));
    await copyFile(path.join(ROOT, "detail.css"), path.join(dist, "detail.css"));
    // 运行时静态资源（index.html 直接引用的 JS/CSS/图标，必须与根目录保持一致）
    for (const asset of ["app.js", "i18n.js", "styles.css", "favicon.svg"]) {
      await copyFile(path.join(ROOT, asset), path.join(dist, asset));
    }
    // 详情页 / 分类页目录
    await copyDir(path.join(ROOT, "p"), path.join(dist, "p"));
    await copyDir(path.join(ROOT, "c"), path.join(dist, "c"));
    console.log("[build] 已同步到 dist/（EdgeOne Pages 部署源）");
  }

  console.log(`[build] 完成：${total} 个产品，预渲染 ${Math.min(PRE_RENDER, total)} 张卡片，sitemap ${sitemapUrls.length} 条 URL，详情页/分类页已生成。`);
}

// 递归复制目录（用于把 p/、c/ 同步到 dist）
async function copyDir(src, dest) {
  const { readdir, stat } = await import("node:fs/promises");
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const s = await stat(srcPath);
    if (s.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

main().catch((error) => {
  console.error("[build] 失败：", error);
  process.exit(1);
});
