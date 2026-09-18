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
const MAKER_LIST_MAX = 6; // 独有内容模块：同作者其他作品最多列几个
const SAME_DATE_LIST_MAX = 8; // 独有内容模块：同日收录最多列几个
const CATEGORY_PAGE_SIZE = 60; // 分类页每页卡片数（分页控制单页体积：692KB → ~50KB，提升爬取效率与 LCP）

const EDITION_LABEL = { main: "大众产品", programmer: "程序员版", game: "独立游戏" };
const STATUS_LABEL = { online: "已上线", developing: "开发中", inactive: "已停止" };

// [P2] Organization 结构化数据（全站复用：首页/详情页/分类页/关于页）
// sameAs 指向站点源码仓库与数据源仓库，供 AI 搜索引擎交叉验证实体一致性
const ORGANIZATION_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "AI 独立制造所",
  "alternateName": "Indie Maker",
  "url": `${SITE_URL}/`,
  "logo": `${SITE_URL}/favicon.svg`,
  "description": "中国独立开发者产品导航：发现独立开发者创造的网站、应用、工具与游戏，每日自动同步更新。",
  "sameAs": [
    "https://github.com/kolbyzhu5/indie-maker-directory",
    "https://github.com/1c7/chinese-independent-developer"
  ]
});

// Umami 访问统计（隐私友好、无 cookie，全站复用）
const UMAMI_SCRIPT = '<script defer src="https://cloud.umami.is/script.js" data-website-id="6febe922-9c29-4dfc-a426-81d6d8bcdb69"></script>';

// 内页（详情页 / 分类页 / 榜单页 / 关于页 / weekly）i18n 运行时。
// 设计：静态 HTML 一律用中文（利于 SEO 抓取与无 JS 场景），JS 就绪后按 locale 替换为英文。
// 海外默认英文：未手动选择过时用 IP 检测修正（country.is，CN→中文、其他→英文）。
// 标记：data-i18n="key"｜data-i18n="key" data-i18n-arg="a|b"（多参）｜data-i18n-cat="中文分类名"。
const INNER_I18N_SCRIPT = `<script type="module">
  import { t, setLocale, getCurrentLocale, getSavedLocale, browserLocale, detectLocaleByIP, categoryName } from "/i18n.js";
  const saved = getSavedLocale();
  setLocale(saved || browserLocale());
  const applyInnerI18n = () => {
    const zh = getCurrentLocale() === "zh";
    document.documentElement.lang = zh ? "zh-CN" : "en";
    if (zh) return;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const argAttr = el.getAttribute("data-i18n-arg");
      const val = argAttr ? t(key, ...argAttr.split("|")) : t(key);
      if (val !== undefined && val !== null && val !== key) el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-cat]").forEach((el) => {
      el.textContent = categoryName(el.getAttribute("data-i18n-cat"));
    });
  };
  applyInnerI18n();
  if (!saved) {
    detectLocaleByIP().then((loc) => {
      if (loc && loc !== getCurrentLocale()) { setLocale(loc); applyInnerI18n(); }
    }).catch(() => {});
  }
</script>`;

// 分类英文 slug 映射（分类页 URL：/c/{slug}.html）
// 详情页/卡片「作品版面」徽章 → i18n key（英文界面下翻译）
const EDITION_I18N_KEY = { "大众产品": "editionMain", "程序员版": "editionProgrammer", "独立游戏": "editionGame" };
// 项目状态中文标签 → i18n key
const STATUS_I18N_KEY = { "已上线": "statusOnline", "开发中": "statusDeveloping", "已停止": "statusInactive" };

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

// [P3] 分类页 title 搜索词化（覆盖长尾词「XX推荐」+「独立开发者XX合集」）
const CATEGORY_TITLES = {
  "AI 工具": "AI 工具推荐 - 独立开发者 AI 产品合集",
  "音视频": "音视频工具推荐 - 独立开发者音视频工具合集",
  "生活服务": "生活工具推荐 - 独立开发者生活服务产品合集",
  "游戏娱乐": "独立游戏推荐 - 独立开发者游戏合集",
  "免费工具": "免费工具推荐 - 独立开发者免费工具合集",
  "效率工具": "效率工具推荐 - 独立开发者效率工具合集",
  "浏览器扩展": "浏览器扩展推荐 - 独立开发者浏览器插件合集",
  "社交社区": "社交产品推荐 - 独立开发者社交社区合集",
  "开发工具": "开发工具推荐 - 独立开发者开发工具合集",
  "教育学习": "学习工具推荐 - 独立开发者教育工具合集",
  "文档办公": "办公工具推荐 - 独立开发者文档办公工具合集",
  "图片工具": "图片工具推荐 - 独立开发者图片工具合集",
  "未分类": "独立开发者产品合集"
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
  const tags = (project.categories || []).slice(0, 3).map((t) => `<span data-i18n-cat="${escapeHTML(t)}">${escapeHTML(t)}</span>`).join("");
  const edition = EDITION_LABEL[project.edition] || "大众产品";
  const url = escapeHTML(project.url);
  const name = escapeHTML(project.name);
  const slug = slugMap.get(project.id);
  const detail = slug ? `<span class="card-links"><a class="detail" href="/p/${slug}.html">详情</a><a class="visit" href="${url}" target="_blank" rel="noreferrer">去看看 ↗</a></span>` : `<a class="visit" href="${url}" target="_blank" rel="noreferrer">去看看 ↗</a>`;
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${edition}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${slug ? `/p/${slug}.html` : url}"${slug ? "" : ' target="_blank" rel="noreferrer"'}>${name}</a></h2>
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
function renderProductPage(project, slug, slugMap, related, ctx = {}) {
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

  const breadcrumb = `<a href="/" data-i18n="backHome">首页</a><span class="sep">›</span><a href="/c/${catSlug}.html" data-i18n-cat="${escapeHTML(primaryCategory)}">${escapeHTML(primaryCategory)}</a><span class="sep">›</span><span class="current">${name}</span>`;
  const tags = categories.map((c) => {
    const cs = CATEGORY_SLUGS[c] || "uncategorized";
    return `<a href="/c/${cs}.html" data-i18n-cat="${escapeHTML(c)}">${escapeHTML(c)}</a>`;
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
    ? `<section class="related" id="related"><h2 data-i18n="relatedTitle">同分类推荐</h2><div class="related-grid">${relatedCards}</div></section>`
    : "";

  // ── 独有内容模块（P1 SEO：只用真实数据重组，不生成虚构内容）──
  const statusChip = (p) => { const sl = STATUS_LABEL[p.status] || escapeHTML(p.status); return `<span class="u-chip s-${p.status}" data-i18n="${STATUS_I18N_KEY[sl] || "statusOnline"}">${sl}</span>`; };
  const miniItem = (p) => `<li><a class="u-name" href="/p/${slugMap.get(p.id)}.html">${escapeHTML(p.name)}</a>${statusChip(p)}<span class="u-desc">${escapeHTML(p.description)}</span></li>`;

  // 模块 1：同作者其他作品
  const sameMaker = (ctx.byMakerIdx?.get(project.maker) || []).filter((x) => x.id !== project.id);
  const sameMakerSection = sameMaker.length
    ? `<section class="unique-block"><h2 data-i18n="sameMakerTitle" data-i18n-arg="${escapeHTML(project.maker)}">「${escapeHTML(project.maker)}」还做了这些</h2>
      <ul class="u-list">${sameMaker.slice(0, MAKER_LIST_MAX).map(miniItem).join("")}</ul>
      ${sameMaker.length > MAKER_LIST_MAX ? `<p class="u-note">该开发者另有 ${sameMaker.length - MAKER_LIST_MAX} 个作品也收录在本站。</p>` : ""}
    </section>`
    : "";

  // 模块 2：同日收录关联
  const sameDate = (ctx.byDateIdx?.get(project.addedAt) || []).filter((x) => x.id !== project.id);
  const sameDateSection = sameDate.length >= 2
    ? `<section class="unique-block"><h2 data-i18n="sameBatchTitle">同一批被收录的还有</h2>
      <p class="u-note">本批（${project.addedAt}）共收录 <b>${sameDate.length + 1}</b> 个作品</p>
      <ul class="u-list">${sameDate.slice(0, SAME_DATE_LIST_MAX).map(miniItem).join("")}</ul>
      ${sameDate.length > SAME_DATE_LIST_MAX ? `<p class="u-note">同批还有 ${sameDate.length - SAME_DATE_LIST_MAX} 个，<a href="/weekly.html">看本周新收录 →</a></p>` : ""}
    </section>`
    : "";

  // 模块 3：分类数据洞察
  const primaryCat = (project.categories || [])[0];
  const catStat = primaryCat ? ctx.byCategoryStat?.get(primaryCat) : null;
  const catIdx = primaryCat ? (ctx.indexInCategory?.get(project.id) || {})[primaryCat] : null;
  const inactivePct = catStat ? Math.round((catStat.inactive || 0) / catStat.total * 100) : 0;
  const catInsightSection = catStat
    ? `<section class="unique-block"><h2 data-i18n="catInsightTitle" data-i18n-arg="${escapeHTML(primaryCat)}">关于「${escapeHTML(primaryCat)}」分类</h2>
      <ul class="u-stats">
        <li><b>${catStat.total}</b><span data-i18n="catStatTotal">共收录</span></li>
        <li><b>${catStat.online || 0}</b><span data-i18n="catStatOnline">已上线</span></li>
        <li><b>${catStat.developing || 0}</b><span data-i18n="catStatDeveloping">开发中</span></li>
        <li><b>${catStat.inactive || 0}</b><span data-i18n="catStatInactive">已停更</span></li>
      </ul>
      ${catIdx ? `<p>本产品是该分类按收录时间排序的 <b>第 ${catIdx} 个</b>作品；该分类中约 <b>${inactivePct}%</b> 的作品已停更。</p>` : ""}
      <p class="u-note"><a href="/c/${CATEGORY_SLUGS[primaryCat] || "uncategorized"}.html" data-i18n="browseAllInCat" data-i18n-arg="${escapeHTML(primaryCat)}">浏览「${escapeHTML(primaryCat)}」全部产品 →</a></p>
    </section>`
    : "";

  // 模块 4：数据来源与纠错（E-E-A-T 透明度信号）
  const sourceSection = `<section class="unique-block"><h2 data-i18n="dataSourceTitle">数据来源</h2>
    <p>本页信息由 AI 独立制造所每日从开源仓库 <a href="https://github.com/1c7/chinese-independent-developer" target="_blank" rel="noreferrer">chinese-independent-developer</a> 自动同步，本产品收录于 <b>${project.addedAt}</b>。</p>
    <p class="u-note">信息有误或想更新？<a href="mailto:kolbyzhu5@gmail.com">告诉我们</a>，或直接向<a href="https://github.com/1c7/chinese-independent-developer" target="_blank" rel="noreferrer">上游仓库提交 PR</a>。</p>
  </section>`;

  const uniqueContent = `${relatedSection}${sameMakerSection}${sameDateSection}${catInsightSection}${sourceSection}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name} - AI 独立制造所</title>
  <meta name="description" content="${desc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/p/${slug}.html">
  <link rel="alternate" hreflang="zh-CN" href="${SITE_URL}/p/${slug}.html">
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}/p/${slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AI 独立制造所">
  <meta property="og:title" content="${name} - AI 独立制造所">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${SITE_URL}/p/${slug}.html">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${name} - AI 独立制造所">
  <meta name="twitter:description" content="${desc}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${softwareApp}</script>
  <script type="application/ld+json">${breadcrumbLD}</script>
  <script type="application/ld+json">${ORGANIZATION_LD}</script>
  ${UMAMI_SCRIPT}
  ${INNER_I18N_SCRIPT}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="AI 独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>AI 独立制造所</strong><small>独立开发者 · AI 工具导航</small></span>
    </a>
    ${BEST_TOP_NAV}
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑">${breadcrumb}</nav>
    <article class="detail-card">
      <div class="detail-head"><span class="edition-badge" data-i18n="${EDITION_I18N_KEY[edition] || "editionMain"}">${edition}</span><time data-i18n="detailAddedAt" data-i18n-arg="${project.addedAt}">${project.addedAt} 收录</time></div>
      <h1>${name}</h1>
      <p class="detail-desc">${desc}</p>
      <div class="detail-meta"><span><b data-i18n="detailMakerLabel">开发者</b>${maker}${city}</span><span><b data-i18n="detailStatusLabel">状态</b><span data-i18n="${STATUS_I18N_KEY[status] || "statusOnline"}">${status}</span></span></div>
      <div class="detail-tags">${tags}</div>
      <div class="detail-actions">
        <a class="btn-primary" href="${url}" target="_blank" rel="noreferrer" data-i18n="detailVisitSite">访问官网 ↗</a>
        ${extraLinks}
        ${relatedCards ? '<a class="btn-ghost" href="#related" data-i18n="detailMoreLikeThis">看同类产品 ↓</a>' : ""}
      </div>
    </article>
    ${uniqueContent}
  </main>
  <footer class="detail-footer">
    <p data-i18n="footerSlogan">AI 独立制造所 · 让认真做出来的东西被看见</p>
    <p class="footer-links"><a href="/about.html" data-i18n="aboutLink">关于本站</a> · <a href="mailto:kolbyzhu5@gmail.com" data-i18n="footerFeedback">反馈建议</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
  </footer>
</body>
</html>
`;
}

// ── P1：分类落地页 ─────────────────────────────────────────────
function renderCategoryPage(category, catSlug, allProducts, slugMap, allCategories, page = 1) {
  const totalCount = allProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / CATEGORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * CATEGORY_PAGE_SIZE;
  const products = allProducts.slice(start, start + CATEGORY_PAGE_SIZE);
  const count = products.length;
  const pagePath = safePage === 1 ? `/c/${catSlug}.html` : `/c/${catSlug}/${safePage}.html`;
  const pageUrl = SITE_URL + pagePath;
  const pageSuffix = safePage > 1 ? `（第 ${safePage} 页）` : "";
  const catNav = allCategories.map(([c, n]) => {
    const cs = CATEGORY_SLUGS[c];
    const active = c === category ? ' class="active"' : "";
    return `<a href="/c/${cs}.html"${active}><span data-i18n-cat="${escapeHTML(c)}">${escapeHTML(c)}</span>（${n}）</a>`;
  }).join("");
  const paginationNav = totalPages > 1 ? `<nav class="pagination" aria-label="分页导航">
    ${safePage > 1 ? `<a class="page-btn" href="${safePage === 2 ? `/c/${catSlug}.html` : `/c/${catSlug}/${safePage - 1}.html`}" data-i18n="paginationPrev">← 上一页</a>` : `<span class="page-btn is-disabled" data-i18n="paginationPrev">← 上一页</span>`}
    <span class="page-info" data-i18n="paginationInfo" data-i18n-arg="${safePage}|${totalPages}">第 <b>${safePage}</b> / ${totalPages} 页</span>
    ${safePage < totalPages ? `<a class="page-btn" href="/c/${catSlug}/${safePage + 1}.html" data-i18n="paginationNext">下一页 →</a>` : `<span class="page-btn is-disabled" data-i18n="paginationNext">下一页 →</span>`}
  </nav>` : "";

  const cards = products.map((p) => {
    const slug = slugMap.get(p.id);
    const city = p.city ? ` · ${escapeHTML(p.city)}` : "";
    const tags = (p.categories || []).slice(0, 3).map((t) => `<a href="/c/${CATEGORY_SLUGS[t] || "uncategorized"}.html" data-i18n-cat="${escapeHTML(t)}">${escapeHTML(t)}</a>`).join("");
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
    "name": `${CATEGORY_TITLES[category] || category} | AI 独立制造所`,
    "url": pageUrl,
    "description": `AI 独立制造所「${category}」分类，共收录 ${totalCount} 个中国独立开发者产品，每日同步更新。`,
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
  <title>${escapeHTML(CATEGORY_TITLES[category] || category)}${pageSuffix} | AI 独立制造所</title>
  <meta name="description" content="AI 独立制造所「${escapeHTML(category)}」分类：共收录 ${totalCount} 个中国独立开发者产品${safePage > 1 ? `，当前第 ${safePage} 页（共 ${totalPages} 页）` : ""}，每日同步更新。">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${pageUrl}">
  <link rel="alternate" hreflang="zh-CN" href="${pageUrl}">
  <link rel="alternate" hreflang="x-default" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AI 独立制造所">
  <meta property="og:title" content="${escapeHTML(CATEGORY_TITLES[category] || category)}${pageSuffix} | AI 独立制造所">
  <meta property="og:description" content="共收录 ${totalCount} 个中国独立开发者产品">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${collectionLD}</script>
  <script type="application/ld+json">${ORGANIZATION_LD}</script>
  ${UMAMI_SCRIPT}
  ${INNER_I18N_SCRIPT}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="AI 独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>AI 独立制造所</strong><small>独立开发者 · AI 工具导航</small></span>
    </a>
    ${BEST_TOP_NAV}
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/" data-i18n="backHome">首页</a><span class="sep">›</span><span class="current" data-i18n-cat="${escapeHTML(category)}">${escapeHTML(category)}</span></nav>
    <div class="category-head">
      <h1>${escapeHTML(category)}</h1>
      <p class="category-count"><span data-i18n="catCountLabel">共收录</span> <b>${totalCount}</b> <span data-i18n="catCountUnit">个产品</span>${safePage > 1 ? `（第 ${safePage} 页）` : ""}</p>
      <nav class="category-nav" aria-label="分类导航">${catNav}</nav>
    </div>
    <div class="category-grid">${cards}</div>
    ${paginationNav}
  </main>
  <footer class="detail-footer">
    <p data-i18n="footerSlogan">AI 独立制造所 · 让认真做出来的东西被看见</p>
    <p class="footer-links"><a href="/about.html" data-i18n="aboutLink">关于本站</a> · <a href="mailto:kolbyzhu5@gmail.com" data-i18n="footerFeedback">反馈建议</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
  </footer>
</body>
</html>
`;
}

// ── P2：关于页 + FAQPage ─────────────────────────────────────
function renderAboutPage() {
  const faqs = [
    {
      q: "AI 独立制造所是什么？",
      a: "一个收录中国独立开发者作品的产品导航站。我们把散落在 GitHub README 里的网站、应用、工具与游戏，整理成真正好逛、好搜、好发现的目录。"
    },
    {
      q: "数据从哪里来？",
      a: "每日自动从开源仓库 chinese-independent-developer 同步，产品名称、介绍、开发者与状态均以原仓库为准，不虚构、不篡改。"
    },
    {
      q: "如何提交我的产品？",
      a: "向数据源仓库 chinese-independent-developer 提交 Pull Request，下一次同步时就会收录。也可以点击首页底部的「反馈建议」联系我。"
    },
    {
      q: "有竞价排名吗？",
      a: "没有。这里是纯收录目录，没有任何付费排序或广告位——只有创造本身。"
    }
  ];

  const faqLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map((f) => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  });

  const faqHTML = faqs.map((f) => `
    <div class="faq-item">
      <h2 class="faq-q">${f.q}</h2>
      <p class="faq-a">${f.a}</p>
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>关于AI 独立制造所 - AI 独立制造所</title>
  <meta name="description" content="了解AI 独立制造所：一个收录中国独立开发者作品的产品导航站，每日从 GitHub 自动同步，无竞价排名。">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/about.html">
  <link rel="alternate" hreflang="zh-CN" href="${SITE_URL}/about.html">
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}/about.html">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AI 独立制造所">
  <meta property="og:title" content="关于AI 独立制造所">
  <meta property="og:description" content="中国独立开发者产品导航，每日自动同步，无竞价排名。">
  <meta property="og:url" content="${SITE_URL}/about.html">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${faqLD}</script>
  <script type="application/ld+json">${ORGANIZATION_LD}</script>
  ${UMAMI_SCRIPT}
  ${INNER_I18N_SCRIPT}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="AI 独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>AI 独立制造所</strong><small>独立开发者 · AI 工具导航</small></span>
    </a>
    ${BEST_TOP_NAV}
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/" data-i18n="backHome">首页</a><span class="sep">›</span><span class="current" data-i18n="aboutBreadcrumb">关于</span></nav>
    <article class="detail-card">
      <div class="detail-head"><span class="edition-badge">关于</span></div>
      <h1>AI 独立制造所</h1>
      <p class="detail-desc">好产品，不该埋在几千行 README 里。我们做一件小事：把独立开发者的AI作品，做成真正好逛、好搜、好发现的目录。</p>
      <div class="detail-meta">
        <span><b>数据源</b><a href="https://github.com/1c7/chinese-independent-developer" target="_blank" rel="noreferrer">chinese-independent-developer ↗</a></span>
        <span><b>源码</b><a href="https://github.com/kolbyzhu5/indie-maker-directory" target="_blank" rel="noreferrer">indie-maker-directory ↗</a></span>
        <span><b>反馈建议</b><a href="mailto:kolbyzhu5@gmail.com">kolbyzhu5@gmail.com</a></span>
        <span><b>备案</b><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></span>
      </div>
    </article>
    <section class="faq-list">
      <h2 class="faq-title" data-i18n="faqTitle">常见问题</h2>
      ${faqHTML}
    </section>
  </main>
  <footer class="detail-footer">
    <p data-i18n="footerSlogan">AI 独立制造所 · 让认真做出来的东西被看见</p>
    <p class="footer-links"><a href="/about.html" data-i18n="aboutLink">关于本站</a> · <a href="mailto:kolbyzhu5@gmail.com" data-i18n="footerFeedback">反馈建议</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
  </footer>
</body>
</html>
`;
}

// ── GEO：精选榜单引擎（AI 搜索引擎友好：给「答案」而非「目录」）──────────
// AI 回答「推荐 XX」类问题时偏好「榜单/精选」型页面（答案密度高、可提取）。
// 新增榜单只需在 RANKINGS 里加一条配置。
const BEST_TOP_NAV = `<nav class="top-nav" aria-label="主要导航"><a href="/#directory" data-i18n="navBrowse">逛产品</a><a href="/best-ai-tools.html" data-i18n="navBestAI">AI 工具精选</a><a href="/best-indie-games.html" data-i18n="navBestGames">独立游戏精选</a></nav>`;

const RANKINGS = [
  {
    slug: "best-ai-tools",
    navLabel: "AI 工具精选",
    title: "2026 好用的免费 AI 工具推荐",
    countLabel: "从 2900+ 个中国独立开发者作品中精选",
    descTemplate: "从 2900+ 个中国独立开发者作品中精选 {n} 个免费 AI 工具，覆盖 AI 抠图、AI 视频、AI 字幕转录、AI 开发助手等，全部可在线使用，每日更新，无竞价排名。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。评选标准：<b>免费或提供免费额度</b>、<b>可在线直接使用</b>、<b>解决真实需求</b>。所有产品均来自中国独立开发者的个人或小团队作品，每日自动同步，无竞价排名。",
    groups: [
      { group: "AI 图片与设计", names: ["1980s AI Photo", "Erase Background Pro", "PicEditor", "CubistAI", "unblurry", "StitchCraft", "HelloGen", "YourArt"] },
      { group: "AI 视频与音频", names: ["C2Anime", "ScribeToAny", "Thumbrix", "Video Text Remover", "Seadanse", "Toonflow"] },
      { group: "AI 效率与办公", names: ["AIradar · AI 订阅价格雷达", "ReadGZH", "薯小二", "慧报价", "WorkGround2"] },
      { group: "AI 开发工具", names: ["TideLink", "RepoAtlas", "DeliverKit", "RunWhale", "Wake"] },
      { group: "AI 有趣玩法", names: ["PicLocation", "神算阁 / Shen Suan Ge", "BaziCalculator.ai", "SeichiGo 圣地巡礼", "FishCare AI", "LoveComic"] },
      { group: "AI 学习与专业", names: ["IELTS Writing Practice", "法脉 LawPulse", "BeatDesign"] },
    ],
    faq: [
      { q: "有哪些免费又好用的 AI 工具？", a: "AI 独立制造所从 2900+ 个中国独立开发者作品中精选了 33 个免费 AI 工具，覆盖 AI 图片处理（抠图、去模糊、文生图）、AI 视频音频（字幕转录、缩略图生成、视频去字）、效率办公与开发工具，全部可在线直接使用，多数无需注册。" },
      { q: "免费 AI 抠图工具哪个好用？", a: "Erase Background Pro 支持秒级输出边缘干净的透明 PNG，可处理电商人像与发丝细节，支持 4K 高清；PicEditor 支持用自然语言描述改图（例如「把背景换成海边」）。两者都能在浏览器内直接使用。" },
      { q: "AI 工具去哪个网站找？", a: "AI 独立制造所（indiemaker.cn）收录 2900+ 个中国独立开发者创造的 AI 工具、效率工具与独立游戏，支持分类浏览、全文搜索与状态筛选，每日从 GitHub 自动更新，无竞价排名，只收录真实作品。" },
      { q: "中国独立开发者做了哪些 AI 工具？", a: "本站收录的 AI 工具类产品超过 880 个，覆盖 AI 图片生成、AI 视频创作、AI 字幕转录、AI 写作文案、AI 开发助手、AI 命理娱乐等方向，全部来自中国独立开发者的个人或小团队作品。" },
      { q: "这些 AI 工具收费吗？", a: "本榜单优先收录免费或提供免费额度的工具。部分采用「免费 + 增值」模式（基础功能免费、高级功能付费），具体以各工具官网说明为准。" },
    ],
  },
  {
    slug: "best-indie-games",
    navLabel: "独立游戏精选",
    title: "2026 好玩的免费独立游戏推荐",
    countLabel: "从中国独立开发者作品中精选",
    descTemplate: "精选 {n} 个免费独立游戏与游戏工具，含休闲小游戏、专注力训练、派对联机、音乐创作、沙盒建造，浏览器打开即玩、免下载，全部来自中国独立开发者。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。评选标准：<b>免费可玩</b>、<b>浏览器打开即玩或提供免费版本</b>、<b>有原创玩法</b>。全部来自中国独立开发者的个人或小团队作品，每日自动同步。",
    groups: [
      { group: "休闲摸鱼小游戏", names: ["wqnlll 游戏中心", "摸鱼解压玩具", "幸运硬币", "摸鱼竞技大厅", "SZ Games", "随机游戏生成器"] },
      { group: "脑力与专注训练", names: ["Concentration Games", "Focus Game", "ToonTones", "Toon Tone", "Songless"] },
      { group: "派对与联机", names: ["DoodleGuesser", "playcharades.fun", "Mimic Party Online"] },
      { group: "音乐创作游戏", names: ["Sprunki Incredibox", "Sprunked", "Sprunki Corruptbox 3"] },
      { group: "沙盒与角色扮演", names: ["方块世界 3D", "IdleOn Online", "AIRI", "Adventext & 千屿引擎"] },
      { group: "游戏工具与辅助", names: ["Pixel Art Base", "Gamepad Tester", "Block Skin Lab", "Codex Asset Forge", "ky3 Launcher", "Cursemark Builds"] },
    ],
    faq: [
      { q: "有哪些免费又好玩的独立游戏？", a: "AI 独立制造所从中国独立开发者的作品中精选了 27 个免费独立游戏与游戏工具，涵盖休闲摸鱼小游戏（如 wqnlll 游戏中心、摸鱼解压玩具）、专注力训练（Concentration Games）、派对联机（DoodleGuesser 你画我猜）、音乐创作（Sprunki Incredibox）、沙盒建造（方块世界 3D）等，浏览器打开即玩，多数无需注册。" },
      { q: "免费的网页小游戏去哪里玩？", a: "本站精选的独立游戏大多支持浏览器直接打开、免下载免注册，例如 wqnlll 游戏中心（6 款原创小游戏，含背单词打砖块）、SZ Games（1000+ 免费在线游戏）、幸运硬币、摸鱼解压玩具等。" },
      { q: "有什么适合和朋友一起玩的在线游戏？", a: "DoodleGuesser 是免费在线画图猜词派对游戏，创建房间分享链接即可与朋友即时畅玩；playcharades.fun 提供 500+ 词汇的线上你画我猜，支持 8 种语言；Mimic Party Online 则是用声音模仿比拼相似度的趣味游戏。" },
      { q: "中国独立开发者做了哪些游戏？", a: "本站收录的游戏娱乐类作品超过 160 个，包含休闲小游戏、音乐创作、沙盒建造、文字冒险、游戏工具等多种类型，全部来自中国独立开发者的个人或小团队作品。" },
      { q: "这些游戏收费吗？", a: "本榜单优先收录免费可玩的作品。部分完全免费（含开源），部分提供免费版本或免费额度，具体以各游戏官方说明为准。" },
    ],
  },
  {
    slug: "best-free-tools",
    navLabel: "免费工具精选",
    title: "2026 免费 AI 工具网站推荐",
    countLabel: "从中国独立开发者作品中精选",
    descTemplate: "精选 {n} 个免安装、浏览器打开即用的免费在线工具，覆盖图片处理、音视频、格式转换、订阅管理、设备检测等，无需下载注册，全部来自中国独立开发者。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。收录标准：<b>完全免费</b>、<b>免安装免注册</b>、<b>浏览器内直接运行</b>。适合不想装软件、随手要处理个文件或图片的场景。",
    groups: [
      { group: "图片与文档处理", names: ["Image to ASCII", "PicPermit", "PdfCompare", "MailMergeOnline", "Create PDF from Sheet"] },
      { group: "音视频处理", names: ["Find Key & BPM", "剪蛋 Jiandan", "VoiceCloner", "SubtitleGenerator", "Video to Text"] },
      { group: "格式转换与分享", names: ["Formatho", "HTMLShare", "CrossTool"] },
      { group: "效率与省钱", names: ["Trim 订阅扫雷器", "Interval Timers", "Invoice Downloader", "热摸爽", "摸鱼助手"] },
      { group: "设备检测", names: ["Dead Pixel Test", "SubnetDesk"] },
    ],
    faq: [
      { q: "有哪些免费又好用的在线工具？", a: "AI 独立制造所精选了 20 个免安装的免费在线工具，涵盖图片转字符画（Image to ASCII）、证件照制作（PicPermit）、PDF 对比与合并、批量生成 PDF、音频调性检测、视频转文字、订阅账单分析、屏幕坏点检测等，全部在浏览器内运行，无需下载软件或注册账号。" },
      { q: "不装软件能处理图片和 PDF 吗？", a: "可以。PicPermit 支持 500+ 官方证件照规格与 ICAO 生物识别线辅助；PdfCompare 基于浏览器 WebAssembly 做 PDF 对比与文本转换；MailMergeOnline 内置证书、合同、工资单模板批量生成 PDF。文件均在本地处理，不上传服务器。" },
      { q: "免费在线工具安全吗？会上传我的文件吗？", a: "本榜单优先收录「浏览器本地处理」的工具，例如 Image to ASCII、Find Key & BPM 等均声明文件不上传、在浏览器内本地完成处理；部分工具还开源可查代码。涉及敏感文件时建议优先选择这类本地处理工具。" },
      { q: "怎么查自己有多少自动续费订阅？", a: "用 Trim 订阅扫雷器：导入支付宝或微信账单，自动识别自动续费项、算出年度订阅总支出与可省金额，帮你在涨价前发现不用的订阅。" },
      { q: "这些工具收费吗？", a: "本榜单收录的全部是免费工具（部分开源），无需付费即可使用核心功能。少数可能提供付费增值项，但不影响免费使用。" },
    ],
  },
  {
    slug: "best-dev-tools",
    navLabel: "开发者工具精选",
    title: "2026 好用的 AI 编程与开发者工具推荐",
    countLabel: "从中国独立开发者作品中精选",
    descTemplate: "精选 {n} 个面向开发者的工具，覆盖 AI 编程 Agent、模型 API 网关、市场调研、安全监控与开发辅助，全部来自中国独立开发者。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。面向开发者与独立创作者，覆盖 <b>AI 编程 Agent 平台</b>、<b>模型 API 网关</b>、<b>调研与曝光</b>、<b>安全与取证</b>、<b>开发辅助资源</b>五类。",
    groups: [
      { group: "AI 编程与 Agent 平台", names: ["hippoxOS", "vibepanel", "MOVO", "FlowWeaver", "WebCode", "BitFun"] },
      { group: "模型 API 与路由", names: ["TeamoRouter", "Sub2API", "XiuRouter"] },
      { group: "市场调研与曝光", names: ["SiteHunter", "Vibe Coding 首切片", "cc8.cc"] },
      { group: "安全与取证", names: ["哪吒网络安全", "小辣椒", "灵取证"] },
      { group: "开发资源与插件", names: ["DSH Quality", "DSH Meme Hub", "Awesome Codex Skin", "OctoCounts", "TomlJump", "mv3migrate"] },
    ],
    faq: [
      { q: "有哪些好用的 AI 编程工具？", a: "本榜单收录了 hippoxOS（LLM 操作系统）、vibepanel（自托管 AI 编程会话面板，可在浏览器和手机上管理多个 Claude Code 会话）、MOVO（企业级 Agent 平台）、WebCode（浏览器内运行 Claude Code / Codex）、BitFun（开源跨平台桌面 AI Agent）等开发者工具。" },
      { q: "多个 AI 模型的 API 怎么统一调用？", a: "可以用 API 中转网关：TeamoRouter 支持一个 key 调用 GPT-6 Astra / Claude / Gemini 等多个模型；TideLink 让已有 OpenAI SDK 代码无需改动即可切换模型；Sub2API 与 XiuRouter 则面向个人到商业规模提供多档方案。" },
      { q: "独立开发者怎么找产品点子？", a: "SiteHunter 是面向独立开发者和创业者的市场调研平台，通过数据而非直觉找 SaaS 创业方向；Vibe Coding 首切片 帮助把模糊需求拆成可运行、可验收的核心切片；cc8.cc 则是面向独立开发者的公开曝光榜。" },
      { q: "中国独立开发者做了哪些开发者工具？", a: "本站收录的开发工具类产品超过 530 个，覆盖 AI 编程、API 网关、CI/CD、监控运维、安全取证、代码统计等方向，全部来自中国独立开发者的个人或小团队作品。" },
      { q: "这些开发者工具收费吗？", a: "本榜单包含免费开源工具与商业工具。例如 hippoxOS、BitFun、mv3migrate、OctoCounts 为开源项目；商业工具多提供免费额度或试用，具体以官网说明为准。" },
    ],
  },
  {
    slug: "best-productivity-tools",
    navLabel: "效率工具精选",
    title: "2026 好用的 AI 效率工具推荐",
    countLabel: "从中国独立开发者作品中精选",
    descTemplate: "精选 {n} 个提升日常效率的工具，覆盖 AI 会话管理、专注习惯、笔记知识、社媒营销、语言学习与内容创作，全部来自中国独立开发者。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。面向需要管理多线任务、维护知识库、持续产出的个人。覆盖 <b>AI 会话与用量管理</b>、<b>专注与习惯</b>、<b>笔记与知识</b>、<b>社媒与翻译</b>、<b>学习与创作</b>五类。",
    groups: [
      { group: "AI 会话与用量管理", names: ["TokenTracker / 纸账", "MaxUsage", "豆包超级助手"] },
      { group: "专注与习惯养成", names: ["Dopastep", "MoveToZero"] },
      { group: "笔记与知识管理", names: ["NotePP", "Vault Keeper", "EchoWord"] },
      { group: "社媒与翻译", names: ["SocialEcho", "TwiFlux", "Duo Translator"] },
      { group: "学习与语言", names: ["EngABC", "JoyRead 双语绘本"] },
      { group: "内容创作", names: ["AI 小说作家", "UI Design Agent Kit", "BokeBox"] },
      { group: "其他实用工具", names: ["CardShopDir", "海克斯小秘书"] },
    ],
    faq: [
      { q: "同时订阅多个 AI 套餐怎么管理额度？", a: "MaxUsage 帮助同时订阅多个 AI 编程套餐的用户充分利用每个套餐额度，根据剩余额度和重置时间给出使用建议；TokenTracker / 纸账 则是 Mac 菜单栏的 Agent 状态工具与本地用量账本，可查看 Claude Code 等工具的用量。" },
      { q: "有什么工具能帮我专注、改掉拖延？", a: "Dopastep 把你一直不想动的事拆成小到不用下决心就能开始的第一步，并进入实时专注房与他人同步专注；MoveToZero（iPhone 久坐提醒）通过步数目标和完成记录帮你安排起身走动。" },
      { q: "知识库和笔记工具推荐哪些？", a: "NotePP 是 macOS 平台的 Notepad++ 替代方案；Vault Keeper 是 Obsidian 自动运维插件，定时检测断链、孤儿笔记并生成报告；EchoWord 提供查词、划词翻译与 TTS 朗读，在语境中记单词。" },
      { q: "做自媒体/出海营销有什么效率工具？", a: "SocialEcho 面向出海企业和跨境卖家，在一个工作区统一管理 11 个海外社交平台；TwiFlux 提供超过 40 个 Twitter 下载与管理工具；Duo Translator 支持网页双语翻译、划词翻译与写作增强。" },
      { q: "这些效率工具收费吗？", a: "本榜单以免费或提供免费额度的工具为主，部分是开源项目。商业工具多提供免费试用或基础免费档，具体以官网说明为准。" },
    ],
  },
  {
    slug: "best-browser-extensions",
    navLabel: "浏览器扩展精选",
    title: "2026 免费好用的浏览器扩展与 AI 插件推荐",
    countLabel: "从中国独立开发者作品中精选",
    descTemplate: "精选 {n} 个浏览器扩展与网页内工具，覆盖书签标签管理、网页媒体下载、阅读翻译、创意娱乐与格式转换，全部来自中国独立开发者。",
    intro: "本榜单由中国独立开发者产品导航「AI 独立制造所」整理。收录 <b>浏览器扩展插件</b> 与 <b>浏览器内直接运行的工具</b>，覆盖书签标签管理、网页媒体下载、阅读翻译、创意娱乐、格式转换五类。",
    groups: [
      { group: "书签与标签管理", names: ["BookmarkHell", "LazyTabs"] },
      { group: "网页媒体与下载", names: ["FlowPick", "网页视频港 WebVideoHarbor", "FluxDown"] },
      { group: "阅读与理解", names: ["Kindly-Web", "沉淀记 Loamery"] },
      { group: "创意与娱乐", names: ["YiBoard", "Synthesizer Flow", "LiveFaceSwap AI", "0trace", "TempCanvas"] },
      { group: "格式转换与开发辅助", names: ["Chrome Renamer", "ImageToSTL.online", "Semaphore", "AiXian", "Next BConvert"] },
    ],
    faq: [
      { q: "有哪些好用的浏览器扩展推荐？", a: "本榜单收录了 FlowPick（自动检测并下载网页中的视频、音频和图片，免费开源）、网页视频港 WebVideoHarbor（识别并保存网页媒体）、Kindly-Web（开源 Chrome 插件，自动扫描 B 站评论区调用大模型分析）、BookmarkHell（书签去重分类）、LazyTabs（Chrome 标签页收纳）等实用扩展。" },
      { q: "怎么下载网页里的视频和图片？", a: "FlowPick 是免费开源的浏览器扩展，可自动检测并下载网页中的视频、音频和图片等媒体资源；网页视频港 WebVideoHarbor 通过 Chrome 扩展识别 MP4、WebM 等格式；FluxDown 则是支持 HTTP/FTP、BT 磁力、HLS 的多协议下载管理器。" },
      { q: "浏览器里能把图片转成 3D 模型吗？", a: "可以。ImageToSTL.online 是免费的 PNG/JPG 转 STL 在线工具，在浏览器本地生成可 3D 打印的模型，支持高度调整等参数；文件不上传服务器。" },
      { q: "有什么不用注册的浏览器小工具？", a: "TempCanvas 是免费、无需注册的临时在线白板，可快速画图、手写记录并导出 PNG；0trace 提供纯 P2P 浏览器端对端聊天与文件传输，无服务器中转、无需注册；Semaphore 把图片拖进浏览器即变 ASCII 字符画。" },
      { q: "这些扩展收费吗？", a: "本榜单以免费、开源扩展为主，绝大多数无需付费即可使用全部功能，具体以各项目说明为准。" },
    ],
  },
];

function renderRankingPage(cfg, allProjects, slugMap) {
  const byName = new Map(allProjects.map((p) => [p.name, p]));
  const groups = cfg.groups.map(({ group, names }) => ({ group, items: names.map((n) => byName.get(n)).filter(Boolean) })).filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  const pageUrl = `${SITE_URL}/${cfg.slug}.html`;
  const desc = cfg.descTemplate.replace("{n}", total);

  const groupsHTML = groups.map(({ group, items }) => `<section class="best-group">
      <h2>${escapeHTML(group)}</h2>
      <ol class="best-list">${items.map((p) => `<li>
        <a class="best-name" href="/p/${slugMap.get(p.id)}.html">${escapeHTML(p.name)}</a>
        <span class="best-desc">${escapeHTML(p.description)}</span>
        <span class="best-meta">开发者 ${escapeHTML(p.maker)}${p.city ? " · " + escapeHTML(p.city) : ""}</span>
      </li>`).join("")}</ol>
    </section>`).join("");

  const faqHTML = cfg.faq.map(({ q, a }) => `<details class="faq-item"><summary>${escapeHTML(q)}</summary><p>${escapeHTML(a)}</p></details>`).join("");

  // 榜单间互链（帮助用户与爬虫发现全部榜单）
  const otherRankings = RANKINGS.filter((r) => r.slug !== cfg.slug);
  const moreRankingsHTML = `<section class="more-rankings">
    <h2 data-i18n="moreRankingsTitle">更多精选榜单</h2>
    <ul>${otherRankings.map((r) => `<li><a href="/${r.slug}.html">${escapeHTML(r.title)}</a></li>`).join("")}</ul>
  </section>`;

  const listLD = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList",
    "name": cfg.title,
    "description": desc,
    "numberOfItems": total,
    "itemListElement": groups.flatMap((g) => g.items).map((p, i) => ({ "@type": "ListItem", "position": i + 1, "name": p.name, "url": `${SITE_URL}/p/${slugMap.get(p.id)}.html` }))
  });
  const faqLD = JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": cfg.faq.map(({ q, a }) => ({ "@type": "Question", "name": q, "acceptedAnswer": { "@type": "Answer", "text": a } }))
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(cfg.title)}（${total} 个） | AI 独立制造所</title>
  <meta name="description" content="${escapeHTML(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${pageUrl}">
  <link rel="alternate" hreflang="zh-CN" href="${pageUrl}">
  <link rel="alternate" hreflang="x-default" href="${pageUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AI 独立制造所">
  <meta property="og:title" content="${escapeHTML(cfg.title)}（${total} 个）">
  <meta property="og:description" content="${escapeHTML(desc)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${listLD}</script>
  <script type="application/ld+json">${faqLD}</script>
  <script type="application/ld+json">${ORGANIZATION_LD}</script>
  ${UMAMI_SCRIPT}
  ${INNER_I18N_SCRIPT}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="AI 独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>AI 独立制造所</strong><small>独立开发者 · AI 工具导航</small></span>
    </a>
    ${BEST_TOP_NAV}
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/" data-i18n="backHome">首页</a><span class="sep">›</span><span class="current" data-i18n-cat="${escapeHTML(cfg.navLabel)}">${escapeHTML(cfg.navLabel)}</span></nav>
    <div class="category-head">
      <h1>${escapeHTML(cfg.title)}</h1>
      <p class="category-count">${cfg.countLabel} <b>${total}</b> 个 · 更新于 ${today}</p>
    </div>
    <p class="best-intro">${cfg.intro}</p>
    ${groupsHTML}
    <section class="faq-list">
      <h2 class="faq-title" data-i18n="faqTitle">常见问题</h2>
      ${faqHTML}
    </section>
    ${moreRankingsHTML}
  </main>
  <footer class="detail-footer">
    <p data-i18n="footerSlogan">AI 独立制造所 · 让认真做出来的东西被看见</p>
    <p class="footer-links"><a href="/about.html" data-i18n="aboutLink">关于本站</a> · <a href="mailto:kolbyzhu5@gmail.com" data-i18n="footerFeedback">反馈建议</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
  </footer>
</body>
</html>
`;
}

// ── P3：本周新收录榜单页 ─────────────────────────────────────
function renderWeeklyPage(weekProducts, slugMap, startDate, endDate) {
  const count = weekProducts.length;
  const cards = weekProducts.map((p) => {
    const slug = slugMap.get(p.id);
    const city = p.city ? ` · ${escapeHTML(p.city)}` : "";
    const tags = (p.categories || []).slice(0, 3).map((t) => `<a href="/c/${CATEGORY_SLUGS[t] || "uncategorized"}.html" data-i18n-cat="${escapeHTML(t)}">${escapeHTML(t)}</a>`).join("");
    return `<article class="project-card">
      <div class="card-top"><span class="edition-badge">${EDITION_LABEL[p.edition] || "大众产品"}</span><time class="card-date">${p.addedAt}</time></div>
      <h2><a href="/p/${slug}.html">${escapeHTML(p.name)}</a></h2>
      <p>${escapeHTML(p.description)}</p>
      <div class="card-tags">${tags}</div>
      <div class="card-footer"><span class="maker">${escapeHTML(p.maker)}${city}</span><span class="card-links"><a class="detail" href="/p/${slug}.html">详情</a><a class="visit" href="${escapeHTML(p.url)}" target="_blank" rel="noreferrer">去看看 ↗</a></span></div>
    </article>`;
  }).join("");

  const itemListLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "本周新收录的独立开发者产品",
    "numberOfItems": count,
    "itemListElement": weekProducts.slice(0, 30).map((p, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": p.name,
      "url": `${SITE_URL}/p/${slugMap.get(p.id)}.html`
    }))
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>本周新收录的独立开发者产品 - AI 独立制造所</title>
  <meta name="description" content="最近 7 天新收录的 ${count} 个独立开发者 AI 工具与产品，每日自动同步，无竞价排名。">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE_URL}/weekly.html">
  <link rel="alternate" hreflang="zh-CN" href="${SITE_URL}/weekly.html">
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}/weekly.html">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AI 独立制造所">
  <meta property="og:title" content="本周新收录的独立开发者产品">
  <meta property="og:description" content="最近 7 天新收录的 ${count} 个独立开发者产品">
  <meta property="og:url" content="${SITE_URL}/weekly.html">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  <script type="application/ld+json">${itemListLD}</script>
  <script type="application/ld+json">${ORGANIZATION_LD}</script>
  ${UMAMI_SCRIPT}
  ${INNER_I18N_SCRIPT}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/" aria-label="AI 独立制造所首页">
      <span class="brand-seal">独立</span>
      <span><strong>AI 独立制造所</strong><small>独立开发者 · AI 工具导航</small></span>
    </a>
    ${BEST_TOP_NAV}
  </header>
  <main class="detail-main">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/" data-i18n="backHome">首页</a><span class="sep">›</span><span class="current" data-i18n="weeklyBreadcrumb">本周新收录</span></nav>
    <div class="category-head">
      <h1>本周新收录</h1>
      <p class="category-count">${startDate} ~ ${endDate} · 共 <b>${count}</b> 个新作品</p>
    </div>
    <div class="category-grid">${cards || '<p class="category-count">最近 7 天暂无新收录，请稍后再来。</p>'}</div>
  </main>
  <footer class="detail-footer">
    <p data-i18n="footerSlogan">AI 独立制造所 · 让认真做出来的东西被看见</p>
    <p class="footer-links"><a href="/about.html" data-i18n="aboutLink">关于本站</a> · <a href="mailto:kolbyzhu5@gmail.com" data-i18n="footerFeedback">反馈建议</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
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
  sitemapUrls.push(`  <url><loc>${SITE_URL}/about.html</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
  sitemapUrls.push(`  <url><loc>${SITE_URL}/weekly.html</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`);
  for (const cfg of RANKINGS) {
    sitemapUrls.push(`  <url><loc>${SITE_URL}/${cfg.slug}.html</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`);
  }
  for (const [cat, catSlug] of Object.entries(CATEGORY_SLUGS)) {
    sitemapUrls.push(`  <url><loc>${SITE_URL}/c/${catSlug}.html</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
    // 分类页分页（第 2 页起，分组逻辑与 categoryEntries 保持一致）
    const catCount = cat === "未分类"
      ? sorted.filter((p) => !p.categories || p.categories.length === 0).length
      : sorted.filter((p) => (p.categories || []).includes(cat)).length;
    const catTotalPages = Math.max(1, Math.ceil(catCount / CATEGORY_PAGE_SIZE));
    for (let page = 2; page <= catTotalPages; page++) {
      sitemapUrls.push(`  <url><loc>${SITE_URL}/c/${catSlug}/${page}.html</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.5</priority></url>`);
    }
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

# 中文搜索引擎爬虫（默认 Allow: / 已覆盖，显式列出便于未来精细控制）
User-agent: Baiduspider
Allow: /

User-agent: Sogou web spider
Allow: /

User-agent: 360Spider
Allow: /

User-agent: YisouSpider
Allow: /
`;

  // 7) llms.txt（AI 爬虫导航，遵循 llmstxt.org 规范）
  const categoryLines = Object.entries(CATEGORY_SLUGS).map(([name, catSlug]) => {
    const count = categoryCounts[name] || 0;
    return `- [${name}](${SITE_URL}/c/${catSlug}.html)：${count} 个产品`;
  }).join("\n");
  const llms = `# AI 独立制造所（Indie Maker）

> 中国独立开发者产品导航：发现独立开发者创造的网站、应用、工具与游戏。每日从 GitHub 自动同步，收录 ${total} 个产品，无竞价排名。

## 关于本站
- 名称：AI 独立制造所（Indie Maker）
- 一句话：好产品，不该埋在几千行 README 里。
- 数据源：https://github.com/1c7/chinese-independent-developer
- 更新时间：${lastmod}（北京时间）
- 语言：中文 / English（双语切换）
- 关于页：${SITE_URL}/about.html（站点介绍 + 常见问题 FAQ）
- 本周新收录：${SITE_URL}/weekly.html（最近 7 天新收录的产品，每日更新）
- AI 工具精选榜单：${SITE_URL}/best-ai-tools.html（最值得用的免费 AI 工具，含分类说明与 FAQ，适合回答「推荐 AI 工具」类问题）
- 独立游戏精选榜单：${SITE_URL}/best-indie-games.html（值得一玩的免费独立游戏与游戏工具，适合回答「推荐游戏 / 网页小游戏」类问题）

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

  const llmsFull = `# AI 独立制造所 · 全部产品清单（${total}）

> 数据源：https://github.com/1c7/chinese-independent-developer
> 更新时间：${lastmod}（北京时间）
> 说明：本清单供 AI 搜索引擎与爬虫全文索引；人类读者请访问 ${SITE_URL}/ 使用交互式浏览。

${sections}
`;

  // 写入根目录（根文件）
  const aboutPage = renderAboutPage();
  // [P3] 本周新收录榜单（最近 7 天 addedAt 的产品）
  const weekStart = beijingDateISO(-7);
  const weekEnd = beijingDateISO();
  const weekProducts = sorted.filter((p) => p.addedAt >= weekStart);
  const weeklyPage = renderWeeklyPage(weekProducts, slugMap, weekStart, weekEnd);
  // [GEO] 精选榜单页（给 AI 搜索引擎「可引用的答案」）
  const rankingTargets = RANKINGS.map((cfg) => [`${cfg.slug}.html`, renderRankingPage(cfg, sorted, slugMap)]);
  const targets = [
    ["index.html", html],
    ["about.html", aboutPage],
    ["weekly.html", weeklyPage],
    ...rankingTargets,
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
  let generatedCategoryPages = 0;
  for (const [cat, catSlug, productsInCat] of categoryEntries) {
    const totalPages = Math.max(1, Math.ceil(productsInCat.length / CATEGORY_PAGE_SIZE));
    for (let page = 1; page <= totalPages; page++) {
      const html = renderCategoryPage(cat, catSlug, productsInCat, slugMap, allCategoryCounts, page);
      if (page === 1) {
        await writeFile(path.join(ROOT, "c", `${catSlug}.html`), html, "utf8");
      } else {
        const dir = path.join(ROOT, "c", catSlug);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${page}.html`), html, "utf8");
      }
      generatedCategoryPages++;
    }
  }
  console.log(`[build] 已生成 ${generatedCategoryPages} 个分类页（${categoryEntries.length} 个分类，含分页）`);

  // ── 详情页「独有内容」索引（P1 SEO：破除 thin content，全部基于真实数据重组，不生成虚构内容）──
  const byMakerIdx = new Map();
  const byDateIdx = new Map();
  const byCategoryStat = new Map();
  for (const p of sorted) {
    if (p.maker) {
      if (!byMakerIdx.has(p.maker)) byMakerIdx.set(p.maker, []);
      byMakerIdx.get(p.maker).push(p);
    }
    if (p.addedAt) {
      if (!byDateIdx.has(p.addedAt)) byDateIdx.set(p.addedAt, []);
      byDateIdx.get(p.addedAt).push(p);
    }
    for (const c of (p.categories || [])) {
      if (!byCategoryStat.has(c)) byCategoryStat.set(c, { total: 0, online: 0, developing: 0, inactive: 0, list: [] });
      const s = byCategoryStat.get(c);
      s.total++;
      if (p.status === "online") s.online++;
      else if (p.status === "developing") s.developing++;
      else if (p.status === "inactive") s.inactive++;
      s.list.push(p);
    }
  }
  // 分类内收录序号（按收录时间升序，序号稳定不抖动）
  const indexInCategory = new Map();
  for (const [cat, s] of byCategoryStat) {
    s.list.sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || "")));
    s.list.forEach((p, i) => {
      if (!indexInCategory.has(p.id)) indexInCategory.set(p.id, {});
      indexInCategory.get(p.id)[cat] = i + 1;
    });
  }
  const uniqueCtx = { byMakerIdx, byDateIdx, byCategoryStat, indexInCategory };

  // 产品详情页
  let generatedProducts = 0;
  for (const p of sorted) {
    const slug = slugMap.get(p.id);
    const cat = (p.categories && p.categories[0]) || "未分类";
    const siblings = byPrimaryCategory.get(cat) || [];
    const related = siblings.filter((x) => x.id !== p.id).slice(0, RELATED_COUNT);
    const page = renderProductPage(p, slug, slugMap, related, uniqueCtx);
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
    await copyFile(path.join(ROOT, "og.png"), path.join(dist, "og.png")).catch(() => console.log("[build] og.png 不存在，跳过（本地可选资源）"));
    await copyFile(path.join(ROOT, "detail.css"), path.join(dist, "detail.css"));
    // 运行时静态资源（index.html 直接引用的 JS/CSS/图标，必须与根目录保持一致）
    for (const asset of ["app.js", "i18n.js", "styles.css", "favicon.svg"]) {
      await copyFile(path.join(ROOT, asset), path.join(dist, asset));
    }
    // IndexNow key 验证文件（Bing 站点所有权验证，必须部署到站点根目录）
    await copyFile(path.join(ROOT, "9082f4b3a3a9450894ffdb0861c74a65.txt"), path.join(dist, "9082f4b3a3a9450894ffdb0861c74a65.txt"));
    // EdgeOne Pages 平台配置（域名级 301：www → 非 www，避免重复内容）
    await copyFile(path.join(ROOT, "edgeone.json"), path.join(dist, "edgeone.json")).catch(() => console.log("[build] edgeone.json 不存在，跳过"));
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
