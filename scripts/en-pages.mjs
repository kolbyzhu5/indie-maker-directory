/**
 * 英文版页面构建（/en/*）
 *
 * ── 设计前提（2026-09-20 实测确认）──────────────────────────
 * 上游数据源 1c7/chinese-independent-developer **只有中文**：
 * README-en.md / README-EN.md / README.en.md / .github/pages/README-En.md 均 404，
 * 仓库里只有 4 个中文文件。站内 2949 个产品的名称与描述也都是中文。
 *
 * ── 因此英文版是「英文原创目录层」+「目录镜像」（2026-10-05 路线升级）──────
 * 做：英文界面 + 英文编辑内容（站点定义 / 榜单说明 / FAQ / 数据报告解读）
 *     + 英文深层页 en/p/ en/c/（用户 2026-10-05 拍板，替代早期「不翻数据」路线）：
 *   描述用 data/descriptions-en.json（scripts/translate.mjs 机翻，中文原文一字不动）；
 *   缺翻译条目 fallback 中文原文 + 明确标注；产品名保留原文（66% 本身就是英文）。
 *   每页带「原文折叠块」保证透明与内容增量，缓解近似重复内容问题。
 * 早期不翻数据的三个理由（①篡改上游 ②重复内容 ③英文搜索缺的是入口）中：
 *   ①已由「中文版零改动」消除；③入口已有但海外访客 20% 落在深层中文页才是真痛点；
 *   ②由原文折叠块 + 英文界面 + 英文导航缓解。
 *
 * ── 为什么必须有独立 URL ─────────────────────────────────
 * 原英文版只在浏览器里（localStorage + JS 切换同一 URL），Google 抓到的永远是
 * 中文静态 HTML → **英文版无法被索引**。而站内海外访客已占 20%（US/HK/SG/JP），
 * 有机搜索却只有 1%。这两个数字放在一起就是：需求在，入口是关着的。
 *
 * ── 实现约定 ────────────────────────────────────────────
 * - 复用与中文页完全相同的 CSS 类（styles.css / detail.css），视觉保持一致
 * - 英文页**不加载** app.js / i18n.js（它们是静态英文，避免 JS 把界面切回中文）
 * - hreflang 三向声明：en(自指) / zh-CN(中文对应页) / x-default(中文页)
 * - 分组与产品清单由 build.mjs 解析后传入，保证中英两版内容完全一致
 */

// ── 分类名中 → 英（与 i18n.js 的 CATEGORY_I18N 保持一致）──
export const EN_CATEGORY = {
  "AI 工具": "AI Tools",
  "音视频": "Audio & Video",
  "生活服务": "Lifestyle",
  "游戏娱乐": "Games",
  "免费工具": "Free Tools",
  "效率工具": "Productivity",
  "浏览器扩展": "Browser Extensions",
  "社交社区": "Social",
  "开发工具": "Dev Tools",
  "教育学习": "Education",
  "文档办公": "Docs & Office",
  "图片工具": "Image Tools",
  "未分类": "Uncategorized"
};

// ── 榜单子分组名 中 → 英（34 个）──
export const EN_GROUP = {
  "AI 图片与设计": "AI Image & Design",
  "AI 视频与音频": "AI Video & Audio",
  "AI 效率与办公": "AI Productivity & Office",
  "AI 开发工具": "AI Developer Tools",
  "AI 有趣玩法": "AI Fun & Play",
  "AI 学习与专业": "AI Learning & Professional",
  "休闲摸鱼小游戏": "Casual & Idle Games",
  "脑力与专注训练": "Brain & Focus Training",
  "派对与联机": "Party & Multiplayer",
  "音乐创作游戏": "Music Creation Games",
  "沙盒与角色扮演": "Sandbox & RPG",
  "游戏工具与辅助": "Game Tools & Utilities",
  "图片与文档处理": "Image & Document Processing",
  "音视频处理": "Audio & Video Processing",
  "格式转换与分享": "Format Conversion & Sharing",
  "效率与省钱": "Productivity & Saving Money",
  "设备检测": "Device Diagnostics",
  "AI 编程与 Agent 平台": "AI Coding & Agent Platforms",
  "模型 API 与路由": "Model APIs & Gateways",
  "市场调研与曝光": "Market Research & Visibility",
  "安全与取证": "Security & Forensics",
  "开发资源与插件": "Dev Resources & Plugins",
  "AI 会话与用量管理": "AI Session & Usage Management",
  "专注与习惯养成": "Focus & Habits",
  "笔记与知识管理": "Notes & Knowledge Management",
  "社媒与翻译": "Social Media & Translation",
  "学习与语言": "Learning & Language",
  "内容创作": "Content Creation",
  "其他实用工具": "Other Utilities",
  "书签与标签管理": "Bookmarks & Tab Management",
  "网页媒体与下载": "Web Media & Downloads",
  "阅读与理解": "Reading & Comprehension",
  "创意与娱乐": "Creative & Entertainment",
  "格式转换与开发辅助": "Conversion & Dev Helpers",
  // 场景页的子分组
  "PDF 格式转换": "Convert to PDF",
  "PDF 批量生成（证书 / 合同 / 发票）": "Batch generation (certificates, contracts, invoices)",
  "PDF 编辑、合并与压缩": "Edit, merge & compress",
  "PDF 识别、对比与解析": "OCR, compare & parse",
  "更多相关工具": "More related tools",
  "字幕与视频翻译": "Subtitles & video translation",
  "文档、论文与 PDF 翻译": "Documents, papers & PDF translation",
  "浏览器划词与双语网页": "Select-to-translate & bilingual pages",
  "实时语音与对话翻译": "Live speech & conversation translation",
  "翻译 API 与开发工具": "Translation APIs & dev tools"
};

const esc = (v = "") =>
  String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);

// ═══════════════════════════════════════════════════════════
// 各页面的英文文案
// ═══════════════════════════════════════════════════════════

const SITE_NAME = "AI 独立制造所";
const BRAND_EN = "Indie Maker";
// 对外英文品牌全名（页脚 / <title> / og:site_name 统一用它；中文品牌名只出现在语言切换的中文侧）
const BRAND_EN_FULL = "AI Indie Maker";

// 英文页统一的「描述为机翻」声明（2026-10-05 起英文深层页上线，替代旧「不翻数据」声明）
const ORIGINAL_LANG_NOTE =
  "Product descriptions are machine-translated from the developers' original Chinese (the original text stays untouched on every product's Chinese page). Every listing links to our English product page, which in turn links to the product's official site.";

export const EN_RANKINGS = {
  "best-ai-tools": {
    navLabel: "AI Tools",
    title: "Best free AI tools from Chinese indie developers (2026)",
    desc: "A hand-picked list of {n} free AI tools built by Chinese indie developers — image and design, video and audio, productivity, developer tools, learning and more. Many run in the browser with no signup.",
    intro: "China's indie developers ship a lot of AI tools, but most of them never get covered in English. This page collects <b>{n} of them</b>, grouped by what you actually want to do — generate images, edit video, speed up office work, code faster, or just play. Every entry is free or has a free tier, and links to its own page on this directory.",
    faq: [
      { q: "What are the best free AI tools made by Chinese developers?", a: "This list covers image and design, video and audio, productivity and office, developer tools, learning, and playful experiments. Each entry is free or offers a free tier, and can be used online without installing anything." },
      { q: "Do I need to read Chinese to use these tools?", a: "Most of them have an English interface or work with English prompts, but a few are Chinese-only. We keep every product's original description in Chinese so you can see exactly what the developer wrote, and each listing links to the product's official site where you can check the interface before signing up." },
      { q: "Are these tools really free?", a: "Most are free or have a generous free tier. A few use a free-plus-paid model — that pricing belongs to the individual product, not to this directory. This directory itself is completely free, with no membership and no paid ranking." },
      { q: "Why are these tools grouped by category instead of ranked 1 to N?", a: "Because 'best' depends on your task. A tool that wins at image generation tells you nothing about subtitle translation. We group by use case and list everything inside each group, so you can scan the category that matches your job." },
      { q: "How often is this list updated?", a: "The underlying directory syncs from an open-source repository every day, so new products appear automatically. The curated selection on this page is reviewed periodically." }
    ]
  },
  "best-free-tools": {
    navLabel: "Free Tools",
    title: "Free online tools you can use without installing anything (2026)",
    desc: "A hand-picked list of {n} free browser-based tools by Chinese indie developers — image and document processing, audio and video, format conversion, device diagnostics. No install, often no signup.",
    intro: "Sometimes you just need to crop an image, convert a file or check a device — and you don't want to install another app for it. These <b>{n} tools</b> all run in a browser tab. Many of them process your files locally, so the file never leaves your machine.",
    faq: [
      { q: "What can I do without installing software?", a: "Image and document processing, audio and video conversion, file format conversion, QR codes and sharing, device and network diagnostics, and a long tail of small utilities. All of them open in a browser tab." },
      { q: "Do these online tools upload my files?", a: "Not always — it depends on the tool. We mark and favour tools that state they process files locally in the browser. If you're handling contracts, ID photos or anything sensitive, prefer those, and verify by opening your browser's Network panel while processing a file." },
      { q: "Do I need to create an account?", a: "Most don't require it. Several are explicitly 'no signup, no login' — you open the page and start working." },
      { q: "Are browser-based tools slower than desktop apps?", a: "For small files they're usually instant. For big files the limit is your machine's memory rather than the network, since nothing is uploaded. Very large batch jobs are still better done with a desktop tool." },
      { q: "Is this list free?", a: "Yes — the directory itself is free, with no membership and no paid ranking. Individual tools may have their own pricing, which is their business model, not ours." }
    ]
  },
  "best-dev-tools": {
    navLabel: "Dev Tools",
    title: "AI coding and developer tools by Chinese indie developers (2026)",
    desc: "A hand-picked list of {n} developer tools from Chinese indie developers — AI coding agents, model API gateways, research and visibility, security and forensics, dev resources and plugins.",
    intro: "These are tools built by developers, for developers: <b>{n of them}</b>, covering AI coding and agent platforms, model API gateways, market research and visibility, security and forensics, and everyday dev resources. Most are open source or have a free developer tier.",
    faq: [
      { q: "What developer tools are on this list?", a: "AI coding and agent platforms, model API gateways and routers, research and visibility tooling, security and forensics utilities, plus plugins and resources that speed up day-to-day development." },
      { q: "Are these tools open source?", a: "Many are. Where a project is open source the product page links to its repository. Others are free-to-use hosted services, sometimes with a paid tier for heavier usage." },
      { q: "Can I self-host any of these?", a: "Several are designed to be self-hosted — particularly API gateways and agent frameworks. Check the individual product page for deployment details." },
      { q: "Do these tools send my code or data to a third party?", a: "It varies, and it matters. Tools that route your traffic through their own servers necessarily see that traffic. We flag tools that run locally or let you plug in your own model keys, but always verify before pointing them at private code." },
      { q: "How do I get my own tool listed?", a: "Submit a pull request to the upstream open-source repository, chinese-independent-developer. The directory syncs from it daily." }
    ]
  },
  "best-productivity-tools": {
    navLabel: "Productivity",
    title: "AI productivity tools for notes, focus and knowledge (2026)",
    desc: "A hand-picked list of {n} AI productivity tools by Chinese indie developers — session and usage management, focus and habits, notes and knowledge, social media and translation, learning and creation.",
    intro: "Tools for people who juggle several threads at once: <b>{n of them}</b>, covering AI session and usage management, focus and habit building, notes and knowledge bases, social media and translation, and learning and content creation.",
    faq: [
      { q: "What counts as an AI productivity tool here?", a: "Anything that helps you manage attention, information or output: usage tracking for AI subscriptions, focus timers and habit trackers, note-taking and knowledge bases, translation and social publishing, and learning tools." },
      { q: "Can these tools manage my AI subscription usage?", a: "Yes — a few track spend and quota across AI providers, which is genuinely useful if you pay for more than one model. They surface where your budget is actually going." },
      { q: "Do I need an account?", a: "Some work entirely locally with no account. Others sync across devices, which requires one. Each product page says which." },
      { q: "Are note-taking tools here cloud or local?", a: "Both kinds exist. Local-first note tools store everything on your own machine; cloud ones sync across devices. We list both, and the product description indicates which." },
      { q: "Are these tools free?", a: "Many are free or open source, some use a free-plus-paid model. This directory is free, with no membership and no paid ranking." }
    ]
  },
  "best-browser-extensions": {
    navLabel: "Extensions",
    title: "Browser extensions and in-browser tools by Chinese indie developers (2026)",
    desc: "A hand-picked list of {n} browser extensions and in-browser tools from Chinese indie developers — bookmarks and tabs, web media and downloads, reading and translation, creative fun, format conversion.",
    intro: "Extensions and browser-native tools: <b>{n of them}</b>, covering bookmark and tab management, downloading web media, reading and translation, creative experiments, and in-browser format conversion. All from Chinese indie developers, mostly free.",
    faq: [
      { q: "Which browsers do these extensions support?", a: "Mostly Chrome and Edge, and many also work in Firefox or other Chromium browsers. The individual product page says which stores it's published in." },
      { q: "Are these extensions safe to install?", a: "We list the developer's own description without rewriting it, and every entry links to the product's official page and store listing. Extensions request browser permissions — check those in the store listing before installing, as you would with any extension." },
      { q: "What can a new-tab or bookmark extension actually do?", a: "Typically: replace the new-tab page with something useful, manage large numbers of bookmarks and tabs, switch between search engines, and sync settings without an account." },
      { q: "Are there extensions that keep data local?", a: "Yes — several explicitly state they collect no personal data and store settings locally. Those are marked in the product description." },
      { q: "Do I have to pay for these?", a: "Most are free. A few have a paid tier for extra features, which is the product's own model. The directory itself is free." }
    ]
  },
  "best-indie-games": {
    navLabel: "Indie Games",
    title: "Free indie games you can play in your browser (2026)",
    desc: "A hand-picked list of {n} free games by Chinese indie developers — casual and idle games, brain and focus training, party and multiplayer, music creation, sandbox and RPG, plus game tools.",
    intro: "Small games from Chinese indie developers, playable in a browser tab: <b>{n of them}</b>, from casual idle games and brain training to party games, music toys, sandbox experiments and RPGs. No download, and most need no account.",
    faq: [
      { q: "Do I need to download or install these games?", a: "No. They run in a browser tab — open the page and play. A few also ship as desktop builds, but the browser version works first." },
      { q: "Are they really free?", a: "Yes, these are free to play. Some are open source. There's no purchase step on our side — this directory never charges anything." },
      { q: "What kinds of games are here?", a: "Casual and idle games, brain and focus training (memory, attention, Schulte tables), party and multiplayer games, music creation toys, sandbox and role-playing experiments, and utilities that help with games." },
      { q: "Can I play them on a phone?", a: "Most work on mobile browsers, and many are designed mobile-first. A few that need a keyboard are desktop-only — check the product page." },
      { q: "My studio made a game — how do I get listed?", a: "Submit a pull request to the upstream open-source repository, chinese-independent-developer. The directory syncs from it every day." }
    ]
  }
};

export const EN_SCENARIOS = {
  pdf: {
    navLabel: "PDF tools",
    h1: "Online PDF tools",
    title: "Free online PDF tools: convert, merge, compress and OCR (2026)",
    desc: "A curated set of {n} free online PDF tools by Chinese indie developers — convert to and from PDF, batch-generate certificates and invoices, merge, split, compress, compare and OCR. Many process files in your browser.",
    intro: "You shouldn't have to install Adobe to deal with a PDF. This page groups <b>{n online PDF tools}</b> by what you actually need to do — convert formats, batch-generate certificates and contracts, merge and split, compress, compare two versions, or OCR a scanned document. Many run entirely in the browser and never upload your file.",
    faq: [
      { q: "Are there free online PDF tools that don't upload my file?", a: "Yes, and this page favours them. Tools listed under browser-based processing state that the file stays on your device — useful for contracts, invoices and anything confidential. You can verify by opening your browser's Network panel while processing a file: no large outbound request means it's local." },
      { q: "How do I convert Excel or images to PDF?", a: "Several tools on this page do exactly that. One converts spreadsheet data to PDF with a page-preview before export and can merge multiple workbooks; others handle images. All work in the browser without installing Excel or Acrobat." },
      { q: "Can I batch-generate certificates or payslips?", a: "Yes. One tool comes with ready-made templates for certificates, contracts, payslips and invoices — import an Excel or CSV list, map the fields, and it generates a personalised PDF per recipient. Another focuses purely on certificates at scale." },
      { q: "How do I compare two versions of a PDF?", a: "Use the PDF comparison tools listed here. They highlight what changed between two documents, which is far faster than reading both side by side — common for contracts and versioned specs." },
      { q: "Can I turn a scanned PDF back into editable text?", a: "Yes, with the OCR tools on this page. They recognise text in scanned documents and export to an editable format such as Word or plain text. Accuracy depends on scan quality." }
    ]
  },
  translate: {
    navLabel: "Translation",
    h1: "Online translation tools",
    title: "Free online translation tools: documents, subtitles and live speech (2026)",
    desc: "A curated set of {n} online translation tools by Chinese indie developers — document and paper translation, subtitle and video translation, select-to-translate browser extensions, live speech translation and translation APIs.",
    intro: "Translation split by what you're translating: <b>{n tools}</b>, covering documents and academic papers, subtitles and video, browser select-to-translate and bilingual reading, live speech and conversation, plus APIs for building your own. Some accept your own model key so the text never passes through a third party.",
    faq: [
      { q: "How do I translate a whole document or academic paper?", a: "Use the document translation tools listed here. They accept a file, translate it while preserving layout, and give you back a readable document — better than pasting text paragraph by paragraph, especially for papers with figures and references." },
      { q: "Can I translate video subtitles automatically?", a: "Yes. The subtitle tools take an audio or video file, transcribe it and produce translated subtitles. Several also let you edit the transcript before exporting, which matters if accuracy is important." },
      { q: "Is there a tool that translates as I browse?", a: "Several browser extensions do select-to-translate and bilingual page rendering — you keep the original text visible alongside the translation, which is far better for learning than a full replacement." },
      { q: "Do these tools send my text to a server?", a: "Usually yes for machine translation, since a model has to run somewhere. Some tools let you supply your own API key, so the request goes to the model provider rather than through an unknown intermediary. Check each product's description." },
      { q: "Can I use these for live conversation?", a: "A few handle real-time speech and conversation translation. Quality depends heavily on audio conditions — they work best with a clear microphone and one speaker at a time." }
    ]
  }
};

export const EN_LOCAL_FIRST = {
  navLabel: "Local-first tools",
  h1: "Online tools that never upload your files",
  title: "Online tools that don't upload your files (browser-based, 2026)",
  desc: "A curated set of local-first online tools by Chinese indie developers — the processing happens inside your browser, so your file never reaches a server. Useful for contracts, ID photos and anything confidential.",
  intro: "Most online tools quietly upload your file to a server. These don't: the work happens <b>inside your browser tab</b>, using your own machine's CPU and memory. That makes them a reasonable choice for contracts, ID photos, medical documents and anything else you'd rather not hand to a third party.",
  faq: [
    { q: "How can I tell whether an online tool uploads my file?", a: "Three checks that actually work. First, read the description: a genuinely local tool says so plainly ('runs locally', 'file never leaves your device', 'no upload'). Second, load the page, disconnect from the internet, and use it — if it still works, the processing is local. Third, open your browser's Network panel and watch while you process a file: a local tool produces no large outbound request." },
    { q: "What kinds of tools work without uploading files?", a: "Image processing (background removal, watermark removal, resizing, compression), PDF handling (compare, merge, convert), audio and video conversion, and a large set of small utilities. Modern browsers can do far more locally than most people assume." },
    { q: "Is browser-local processing as capable as a server?", a: "For files up to a few hundred megabytes it's usually indistinguishable and often faster, since there's no upload and no queue. The constraint is your device's memory, not the network. Very large jobs are still better served by a desktop application." },
    { q: "Can I use these for ID photos, contracts or medical records?", a: "That's exactly the use case this page is built for. Prefer tools that state they process locally and collect no data, and verify with the Network-panel check above. No upload means no third party can retain a copy." },
    { q: "Do these tools work offline?", a: "Once the page has loaded, many do — which is also the simplest way to verify the claim. Those that need a first network request for the app itself will still usually keep your file local afterwards." }
  ]
};

export const EN_REPORT = {
  navLabel: "Data report",
  h1: "Chinese indie developer products: a survival report",
  title: "Chinese indie developer report: {inactive}% of products are no longer maintained",
  desc: "An original data report built from {total} products by Chinese indie developers, synced daily from an open-source repository. See how many shipped each year, what share is still maintained, and how the picture changes with age.",
  intro: "This report is generated from our own database of <b>{total} products</b> by Chinese indie developers, synced every day from an open-source repository. Nothing here is estimated or sampled — it's a census of everything the directory has ever collected, counted by the year we first saw it and by whether the product is still active today.",
  faq: [
    { q: "What share of Chinese indie developer products are still maintained?", a: "Across the whole database, roughly {onlinePct}% of products are still live and {inactivePct}% are no longer maintained. The figure moves with age: products first listed in the current year are almost all still active, while older cohorts have naturally lost more of their number." },
    { q: "Why do older products stop being maintained?", a: "The same reasons anywhere: the developer moved on, the project merged into something else, the market didn't materialise, or it was a learning project that served its purpose. A non-maintained product isn't a failure — many were deliberately finished rather than abandoned." },
    { q: "Where does this data come from?", a: "The open-source repository chinese-independent-developer, which Chinese indie developers submit their work to. Our directory syncs it daily. We count only what appears there — we don't scrape stores or estimate market size." },
    { q: "Can I reuse this report or its numbers?", a: "Yes, with attribution. Citing 'AI Indie Maker (indiemaker.cn) — Chinese indie developer survival report' and linking back is enough. The underlying data is open source." },
    { q: "How current is this data?", a: "The dataset is re-synced daily, and the counts on this page are regenerated on every build, so they reflect the latest sync rather than a frozen snapshot." }
  ]
};

export const EN_HOME = {
  title: "Chinese indie developer directory: AI tools, websites, apps and games",
  desc: "A directory of AI tools, websites, apps and games created by Chinese indie developers. {total} products, updated daily from an open-source repository. No membership, no paid ranking, entirely free.",
  lead: "A directory of AI tools, websites, apps and games created by Chinese indie developers. We don't build, host or resell any product — we only index and navigate. Entirely free, with no paid ranking.",
  faq: [
    { q: "What is this site?", a: "AI Indie Maker is a directory of works by Chinese indie developers — AI tools, websites, apps and games. We sync from an open-source repository every day, organise everything by category and use case, and make it searchable. We don't build, host or resell any of the products listed; every listing links to the product's own site." },
    { q: "Is it free? Is there a membership?", a: "Completely free. There is no membership, no subscription, no paid feature, and no paid ranking. Sorting is by date added or name, and nothing on the site can be bought." },
    { q: "Why is the site in Chinese if it's for a global audience?", a: "The products are made by Chinese-speaking developers and the upstream data source is Chinese. Product descriptions are machine-translated into English for browsing (the original Chinese stays untouched on each product's Chinese page), and product names are kept as the developers wrote them. The interface, categories and all editorial pages are available in English." },
    { q: "I saw a product description mention a membership or a paid plan — is that yours?", a: "No. Any pricing, membership or paid tier mentioned in a product's description belongs to that product itself. This directory is entirely free and has no membership of any kind." },
    { q: "How do I get my product listed?", a: "Submit a pull request to the open-source repository chinese-independent-developer. The directory syncs from it daily, so once your entry is merged it appears here automatically." }
  ]
};

// ═══════════════════════════════════════════════════════════
// 页面外壳
// ═══════════════════════════════════════════════════════════

function shell({ siteUrl, umamiScript, organizationLd, title, desc, canonical, zhUrl, jsonLd = [], body }) {
  const ldTags = [...jsonLd, organizationLd].map((s) => `<script type="application/ld+json">${s}</script>`).join("\n  ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${canonical}">
  <link rel="alternate" hreflang="zh-CN" href="${zhUrl}">
  <link rel="alternate" hreflang="x-default" href="${zhUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${BRAND_EN_FULL}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}/og-en.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_US">
  <meta property="og:locale:alternate" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/detail.css">
  ${ldTags}
  ${umamiScript}
</head>
<body>
  <div class="paper-noise" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="/en/" aria-label="${BRAND_EN_FULL} — English home">
      <span class="brand-seal">独立</span>
      <!-- strong 是移动端唯一显示的（.brand small 在窄屏隐藏），且 .brand strong 为 nowrap
           ——英文品牌名必须短，否则在 390px 下会文本溢出（实测踩过）。 -->
      <span><strong>${BRAND_EN}</strong><small>${BRAND_EN_FULL} · Chinese indie developer directory</small></span>
    </a>
    <nav class="top-nav" aria-label="Main navigation">
      <a href="/en/">Directory</a>
      <a href="/en/best-ai-tools.html">AI Tools</a>
      <a href="/en/local-first.html">Local-first tools</a>
      <a href="${zhUrl}" hreflang="zh-CN" lang="zh-CN">中文</a>
    </nav>
  </header>
  <main class="detail-main">
${body}
  </main>
  <footer class="detail-footer">
    <p>${BRAND_EN_FULL} · making sure good work gets seen</p>
    <p class="footer-links"><a href="/en/">Home</a> · <a href="/en/local-first.html">Local-first tools</a> · <a href="/en/indie-report.html">Data report</a> · <a href="${siteUrl}/about.html" hreflang="zh-CN" lang="zh-CN">About</a> · <a href="${siteUrl}/privacy.html" hreflang="zh-CN" lang="zh-CN">Privacy Policy</a> · <a href="${siteUrl}/contact.html" hreflang="zh-CN" lang="zh-CN">Contact</a> · <a href="mailto:kolbyzhu5@gmail.com">Feedback</a> · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">湘ICP备2026036319号</a></p>
  </footer>
</body>
</html>
`;
}

// 产品列表项（复用中文页完全相同的 CSS 类，保证视觉一致）
// 链接指向英文详情页（en/p/）；描述优先用机翻英文（descEnMap 由 build.mjs 传入）
function itemHTML(p, slugMap, groupNameEn, descEnMap) {
  const city = p.city ? ` · ${esc(p.city)}` : "";
  const d = (descEnMap && descEnMap[p.id]?.descEn) || p.description;
  return `<li>
        <a class="best-name" href="/en/p/${slugMap.get(p.id)}.html">${esc(enNameOf(p))}</a>
        <span class="best-desc">${esc(d)}</span>
        <span class="best-meta">By ${esc(p.maker)}${city}${groupNameEn ? "" : ""}</span>
      </li>`;
}

function groupsHTML(groups, slugMap, descEnMap) {
  return groups
    .map(
      ({ name, items }) => `<section class="best-group">
      <h2>${esc(EN_GROUP[name] || name)} <small>${items.length}</small></h2>
      <ol class="best-list">${items.map((p) => itemHTML(p, slugMap, "", descEnMap)).join("")}</ol>
    </section>`
    );
}

function faqHTML(faq) {
  return faq.map(({ q, a }) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
}

const listLD = (name, desc, items, slugMap, siteUrl) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description: desc,
    numberOfItems: items.length,
    itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: enNameOf(p), url: `${siteUrl}/en/p/${slugMap.get(p.id)}.html` }))
  });

const faqLD = (faq) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } }))
  });

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

export function buildEnglishPages(ctx) {
  if (ctx.nameEnMap) nameEnMap = ctx.nameEnMap;
  const { siteUrl, umamiScript, organizationLd, projects, slugMap, counts, categoryCounts, categorySlugs, localFirstSignals, rankings, scenarios, descEnMap } = ctx;
  const pages = [];
  const total = counts.total;
  const today = new Date().toISOString().slice(0, 10);
  const base = { siteUrl, umamiScript, organizationLd };

  // ── 1. 英文首页 ──
  const homeDesc = EN_HOME.desc.replace("{total}", total.toLocaleString("en"));
  const catRows = Object.entries(categoryCounts)
    .filter(([c]) => EN_CATEGORY[c])
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => {
      const slug = categorySlugs[c] || "uncategorized";
      // ⚠️ 结构必须与中文版/分类页一致：<a> 直接做 .category-nav 的子元素，数字放进 <a> 内。
      // 旧写法 <li><a>名称</a> <small>数字</small></li> 有三个错：
      //   ① <li> 无 <ul>/<ol> 父元素（无效 HTML）
      //   ② <li> 作为 flex item 会被收缩，宽度小于内容宽度后，<small> 溢出到相邻 chip 下被覆盖
      //      → 实测「934」显示成「93」，只有每行最后一个 chip 完整（没人压它）
      //   ③ <li> 的 ::marker 泄漏成左侧小圆点（list-style: disc）
      return `<a href="/en/c/${slug}.html"><span class="best-name" style="border:0">${esc(EN_CATEGORY[c])}</span> <small>${n}</small></a>`;
    })
    .join("");

  // 「Start here」入口列表：必须覆盖全部 6 个英文榜单 + 2 个独家页 + 2 个场景页，
  // 否则没被列到的英文页在站内就成了孤岛（只靠 sitemap 被发现）。
  const highlights = [
    ["/en/best-ai-tools.html", "Best free AI tools"],
    ["/en/best-free-tools.html", "Free tools"],
    ["/en/best-dev-tools.html", "Developer tools"],
    ["/en/best-productivity-tools.html", "Productivity tools"],
    ["/en/best-browser-extensions.html", "Browser extensions"],
    ["/en/best-indie-games.html", "Indie games"],
    ["/en/local-first.html", "Tools that never upload your files"],
    ["/en/indie-report.html", "Survival data report"],
    ["/en/topic/pdf.html", "PDF tools"],
    ["/en/topic/translate.html", "Translation tools"]
  ]
    .map(([href, label]) => `<li><a class="best-name" style="display:inline" href="${href}">${label}</a></li>`)
    .join("");

  pages.push([
    "en/index.html",
    shell({
      ...base,
      title: `${BRAND_EN_FULL} — ${EN_HOME.title}`,
      desc: homeDesc,
      canonical: `${siteUrl}/en/`,
      zhUrl: `${siteUrl}/`,
      jsonLd: [faqLD(EN_HOME.faq)],
      body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${siteUrl}/" hreflang="zh-CN" lang="zh-CN">中文版</a><span class="sep">›</span><span class="current">English</span></nav>
    <div class="category-head">
      <h1>Chinese indie developer directory</h1>
      <p class="category-count">A directory of <b>${total.toLocaleString("en")}</b> products · updated ${today}</p>
    </div>

    <section class="site-def">
      <h2>What this site is</h2>
      <p class="site-def-lead">${esc(EN_HOME.lead)}</p>
      <p class="site-def-meta">
        <span><b>Entirely free</b> — no membership, no paid features</span>
        <span><b>No paid ranking</b> — sorted by date added or name</span>
        <span><b>We don't build or host</b> any product listed</span>
      </p>
    </section>

    <p class="best-intro">Every day we sync a public open-source repository where Chinese indie developers submit their work, then organise it by category and by what you're trying to do. The result is a searchable directory of <b>${total.toLocaleString("en")} products</b> that is genuinely easier to browse than scrolling a README.</p>

    <p class="u-note">${esc(ORIGINAL_LANG_NOTE)}</p>

    <section class="unique-block">
      <h2>Browse by category</h2>
      <div class="category-nav">${catRows}</div>
    </section>

    <section class="unique-block">
      <h2>Start here</h2>
      <ol class="best-list">${highlights}</ol>
    </section>

    <section class="faq-list">
      <h2 class="faq-title">Frequently asked questions</h2>
      ${faqHTML(EN_HOME.faq)}
    </section>

    <section class="unique-block">
      <h2>About the data</h2>
      <p>Product names, descriptions, developer names and status all come from the open-source repository <a href="https://github.com/1c7/chinese-independent-developer" target="_blank" rel="noreferrer">chinese-independent-developer</a>. We sync it daily and don't rewrite what developers wrote. Any pricing, membership or paid tier mentioned in a product description belongs to that product, not to this directory.</p>
    </section>`
    })
  ]);

  // ── 2. 6 个榜单页 ──
  for (const r of rankings) {
    const cfg = EN_RANKINGS[r.slug];
    if (!cfg) continue;
    const items = r.groups.flatMap((g) => g.items);
    const n = items.length;
    const desc = cfg.desc.replace("{n}", n);
    const groups = r.groups.map((g) => ({ name: g.group, items: g.items }));
    const zhUrl = `${siteUrl}/${r.slug}.html`;
    const otherRankings = Object.entries(EN_RANKINGS)
      .filter(([s]) => s !== r.slug)
      .map(([s, c]) => `<li><a href="/en/${s}.html">${esc(c.title)}</a></li>`)
      .join("");

    pages.push([
      `en/${r.slug}.html`,
      shell({
        ...base,
        title: `${cfg.title} — ${n} picks | ${BRAND_EN_FULL}`,
        desc,
        canonical: `${siteUrl}/en/${r.slug}.html`,
        zhUrl,
        jsonLd: [listLD(cfg.title, desc, items, slugMap, siteUrl), faqLD(cfg.faq)],
        body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/en/">Directory</a><span class="sep">›</span><span class="current">${esc(cfg.navLabel)}</span></nav>
    <div class="category-head">
      <h1>${esc(cfg.title)}</h1>
      <p class="category-count">Hand-picked <b>${n}</b> products · updated ${today}</p>
    </div>
    <p class="best-intro">${cfg.intro.replace("{n}", n)}</p>
    <p class="u-note">${esc(ORIGINAL_LANG_NOTE)}</p>
    ${groupsHTML(groups, slugMap, descEnMap).join("")}
    <section class="faq-list">
      <h2 class="faq-title">Frequently asked questions</h2>
      ${faqHTML(cfg.faq)}
    </section>
    <section class="more-rankings">
      <h2>More lists</h2>
      <ul>${otherRankings}</ul>
    </section>`
      })
    ]);
  }

  // ── 3. local-first ──
  {
    const hit = (p) => {
      const s = `${enNameOf(p)} ${p.name} ${p.description || ""}`;
      return localFirstSignals.some((k) => s.includes(k));
    };
    const picked = projects.filter(hit);
    const n = picked.length;
    const byGroup = new Map();
    for (const p of picked) {
      const cat = (p.categories || [])[0] || "未分类";
      if (!byGroup.has(cat)) byGroup.set(cat, []);
      byGroup.get(cat).push(p);
    }
    const groups = [...byGroup.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([cat, items]) => ({ name: cat, items }));
    const cfg = EN_LOCAL_FIRST;
    const desc = cfg.desc.replace("{n}", n);

    pages.push([
      "en/local-first.html",
      shell({
        ...base,
        title: `${cfg.title} — ${n} tools | ${BRAND_EN_FULL}`,
        desc,
        canonical: `${siteUrl}/en/local-first.html`,
        zhUrl: `${siteUrl}/local-first.html`,
        jsonLd: [listLD(cfg.h1, desc, picked, slugMap, siteUrl), faqLD(cfg.faq)],
        body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/en/">Directory</a><span class="sep">›</span><span class="current">${esc(cfg.navLabel)}</span></nav>
    <div class="category-head">
      <h1>${esc(cfg.h1)}</h1>
      <p class="category-count">Curated <b>${n}</b> browser-local tools · updated ${today}</p>
    </div>
    <p class="best-intro">${cfg.intro}</p>
    <p class="u-note">Selection criteria: the tool states that it processes files locally or collects no data; it works without an account; and it solves a real task. ${esc(ORIGINAL_LANG_NOTE)}</p>
    ${groupsHTML(groups, slugMap, descEnMap).join("")}
    <section class="faq-list">
      <h2 class="faq-title">Frequently asked questions</h2>
      ${faqHTML(cfg.faq)}
    </section>`
      })
    ]);
  }

  // ── 4. 数据报告 ──
  {
    const byYear = {};
    for (const p of projects) {
      const y = (p.addedAt || "").slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      byYear[y] = byYear[y] || { t: 0, o: 0, i: 0 };
      byYear[y].t++;
      if (p.status === "online") byYear[y].o++;
      if (p.status === "inactive") byYear[y].i++;
    }
    const years = Object.keys(byYear).sort();
    const online = projects.filter((p) => p.status === "online").length;
    const inactive = projects.filter((p) => p.status === "inactive").length;
    const onlinePct = ((online / total) * 100).toFixed(1);
    const inactivePct = ((inactive / total) * 100).toFixed(1);
    const cfg = EN_REPORT;
    const desc = cfg.desc.replace("{inactive}", inactivePct).replace("{total}", total.toLocaleString("en"));
    const maxT = Math.max(...years.map((y) => byYear[y].t));

    const barW = 640, barH = 220, pad = 26;
    const barGap = 10;
    const barWidth = Math.floor((barW - pad * 2 - barGap * (years.length - 1)) / years.length);
    const bars = years
      .map((y, i) => {
        const v = byYear[y];
        const h = Math.round(((barH - pad * 2) * v.t) / maxT);
        const x = pad + i * (barWidth + barGap);
        const y0 = barH - pad - h;
        return `<rect x="${x}" y="${y0}" width="${barWidth}" height="${h}" fill="#b3292e" opacity=".82" />
      <text x="${x + barWidth / 2}" y="${y0 - 5}" font-size="10" text-anchor="middle" fill="#756f63">${v.t}</text>
      <text x="${x + barWidth / 2}" y="${barH - pad + 13}" font-size="10" text-anchor="middle" fill="#756f63">${y}</text>`;
      })
      .join("");

    const yearRows = years
      .slice()
      .reverse()
      .map((y) => {
        const v = byYear[y];
        const ip = ((v.i / v.t) * 100).toFixed(0);
        return `<tr><td>${y}</td><td>${v.t}</td><td>${v.o}</td><td>${v.i}</td><td>${ip}%</td></tr>`;
      })
      .join("");

    const catRows2 = Object.entries(categoryCounts)
      .filter(([c]) => EN_CATEGORY[c])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 13)
      .map(([c, n]) => `<tr><td>${EN_CATEGORY[c]}</td><td>${n}</td><td>${((n / total) * 100).toFixed(1)}%</td></tr>`)
      .join("");

    pages.push([
      "en/indie-report.html",
      shell({
        ...base,
        title: `${cfg.title.replace("{inactive}", inactivePct)} | ${BRAND_EN_FULL}`,
        desc,
        canonical: `${siteUrl}/en/indie-report.html`,
        zhUrl: `${siteUrl}/indie-report.html`,
        jsonLd: [faqLD(cfg.faq)],
        body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/en/">Directory</a><span class="sep">›</span><span class="current">${esc(cfg.navLabel)}</span></nav>
    <div class="category-head">
      <h1>${esc(cfg.h1)}</h1>
      <p class="category-count">Built from <b>${total.toLocaleString("en")}</b> products · regenerated ${today}</p>
    </div>
    <p class="best-intro">${cfg.intro.replace("{total}", total.toLocaleString("en"))}</p>

    <div class="rw-stats">
      <div class="rw-stat"><b>${total.toLocaleString("en")}</b><span>products collected</span></div>
      <div class="rw-stat"><b>${onlinePct}%</b><span>still live</span></div>
      <div class="rw-stat"><b>${inactivePct}%</b><span>no longer maintained</span></div>
      <div class="rw-stat"><b>${(byYear[years[years.length - 1]] || {}).t || 0}</b><span>added this year</span></div>
    </div>

    <section class="unique-block">
      <h2>Products added per year</h2>
      <svg viewBox="0 0 ${barW} ${barH}" width="100%" height="auto" role="img" aria-label="Bar chart of products added per year">${bars}</svg>
    </section>

    <section class="unique-block">
      <h2>Maintenance by cohort</h2>
      <div class="rw-table-wrap"><table class="rw-table">
        <thead><tr><th>Year</th><th>Products</th><th>Live</th><th>Inactive</th><th>Inactive %</th></tr></thead>
        <tbody>${yearRows}</tbody>
      </table></div>
      <p class="u-note">The newer the cohort, the higher the share that is still active — a product listed this year has had little time to be abandoned. Read the numbers by row, not across rows.</p>
    </section>

    <section class="unique-block">
      <h2>What gets built</h2>
      <div class="rw-table-wrap"><table class="rw-table">
        <thead><tr><th>Category</th><th>Products</th><th>Share</th></tr></thead>
        <tbody>${catRows2}</tbody>
      </table></div>
    </section>

    <section class="faq-list">
      <h2 class="faq-title">Frequently asked questions</h2>
      ${faqHTML(cfg.faq.map((f) => ({ q: f.q, a: f.a.replace("{onlinePct}", onlinePct).replace("{inactivePct}", inactivePct) })))}
    </section>`
      })
    ]);
  }

  // ── 5. 两个场景页 ──
  for (const s of scenarios) {
    const cfg = EN_SCENARIOS[s.slug];
    if (!cfg) continue;
    const items = s.groups.flatMap((g) => g.items);
    const n = items.length;
    const desc = cfg.desc.replace("{n}", n);
    const zhUrl = `${siteUrl}/topic/${s.slug}.html`;
    pages.push([
      `en/topic/${s.slug}.html`,
      shell({
        ...base,
        title: `${cfg.title} — ${n} tools | ${BRAND_EN_FULL}`,
        desc,
        canonical: `${siteUrl}/en/topic/${s.slug}.html`,
        zhUrl,
        jsonLd: [listLD(cfg.h1, desc, items, slugMap, siteUrl), faqLD(cfg.faq)],
        body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/en/">Directory</a><span class="sep">›</span><span class="current">${esc(cfg.navLabel)}</span></nav>
    <div class="category-head">
      <h1>${esc(cfg.h1)}</h1>
      <p class="category-count">Curated <b>${n}</b> tools · updated ${today}</p>
    </div>
    <p class="best-intro">${cfg.intro.replace("{n}", n)}</p>
    <p class="u-note">${esc(ORIGINAL_LANG_NOTE)}</p>
    ${groupsHTML(s.groups, slugMap, descEnMap).join("")}
    <section class="faq-list">
      <h2 class="faq-title">Frequently asked questions</h2>
      ${faqHTML(cfg.faq)}
    </section>`
      })
    ]);
  }

  return pages;
}

// 英文页的 URL 列表（供 sitemap 使用）
export function englishUrls(siteUrl) {
  return [
    `${siteUrl}/en/`,
    ...Object.keys(EN_RANKINGS).map((s) => `${siteUrl}/en/${s}.html`),
    `${siteUrl}/en/local-first.html`,
    `${siteUrl}/en/indie-report.html`,
    ...Object.keys(EN_SCENARIOS).map((s) => `${siteUrl}/en/topic/${s}.html`)
  ];
}

// ═══════════════════════════════════════════════════════════
// 英文深层页：en/p/{slug}.html（每产品）+ en/c/{slug}.html（每分类，含分页）
// ── 设计（2026-10-05，替代早期「不翻数据」路线）──────────────────
// 海外访客已占约 20%，但英文用户从 Google 落到 /p/ /c/ 深层页看到的是中文。
// 本生成器把整个目录镜像成英文静态页：
//   · 描述用 data/descriptions-en.json 的机翻（中文原文一字不动，只用于英文展示层）
//   · 缺翻译的条目 fallback 显示中文原文并明确标注
//   · 产品名保留原文（66% 本身就是英文；中文名是专有名词）
//   · 每页附「原文折叠块」（details）——透明 + 内容增量，缓解「近似重复内容」顾虑
// ═══════════════════════════════════════════════════════════

const EN_EDITION = { main: "Indie product", programmer: "Developer tool", game: "Indie game" };
const EN_STATUS = { online: "Online", developing: "In development", inactive: "Discontinued" };
const CATEGORY_PAGE_SIZE = 60;
const RELATED_COUNT = 6;

const MT_NOTE = "Description translated from the developer's original Chinese by machine translation.";

// 产品名英文映射（data/names-en.json，scripts/translate-names.mjs 机翻）。
// ⚠️ 只改英文展示名（卡片/标题/JSON-LD）；slug 与 URL 仍由原始 name 派生，一律不动。
let nameEnMap = {};
function enNameOf(p) {
  return (nameEnMap[p.id] && nameEnMap[p.id].nameEn) || p.name;
}

function enItem(p, slugMap, descEnMap) {
  const city = p.city ? ` · ${esc(p.city)}` : "";
  const d = descEnMap[p.id]?.descEn || p.description;
  return `<li>
        <a class="best-name" href="/en/p/${slugMap.get(p.id)}.html">${esc(enNameOf(p))}</a>
        <span class="best-desc">${esc(d)}</span>
        <span class="best-meta">By ${esc(p.maker)}${city}</span>
      </li>`;
}

function enStatusChip(p) {
  return `<span class="u-chip s-${p.status}">${EN_STATUS[p.status] || esc(p.status)}</span>`;
}

function renderEnProductPage(p, slug, slugMap, related, descEnMap, ctx) {
  const { siteUrl, umamiScript, organizationLd, categorySlugs } = ctx;
  const name = esc(enNameOf(p));
  const descEn = descEnMap[p.id]?.descEn || "";
  const hasEn = Boolean(descEn);
  const shownDesc = hasEn ? descEn : p.description;
  const shownDescE = esc(shownDesc);
  const categories = p.categories || [];
  const primaryCategory = categories[0] || "未分类";
  const catSlug = categorySlugs[primaryCategory] || "uncategorized";
  const catEn = EN_CATEGORY[primaryCategory] || "Uncategorized";
  const outbound = ` data-umami-event="outbound" data-umami-event-placement="en-detail" data-umami-event-target="${slug}"`;

  const breadcrumb = `<a href="/en/">Directory</a><span class="sep">›</span><a href="/en/c/${catSlug}.html">${esc(catEn)}</a><span class="sep">›</span><span class="current">${name}</span>`;
  const tagLinks = categories
    .map((c) => `<a href="/en/c/${categorySlugs[c] || "uncategorized"}.html">${esc(EN_CATEGORY[c] || c)}</a>`)
    .join("");
  const extraLinks = (p.makerLinks || [])
    .map((l) => `<a class="btn-ghost" href="${esc(l.url)}" target="_blank" rel="noreferrer"${outbound}>${esc(l.label)}</a>`)
    .join("");

  const relatedCards = related
    .map((x) => {
      const xs = slugMap.get(x.id);
      const xd = esc(descEnMap[x.id]?.descEn || x.description);
      return `<article class="project-card">
      <div class="card-top"><span class="edition-badge">${EN_EDITION[x.edition] || "Indie product"}</span><time class="card-date">${x.addedAt}</time></div>
      <h2><a href="/en/p/${xs}.html">${esc(enNameOf(x))}</a></h2>
      <p>${xd}</p>
      <div class="card-footer"><span class="maker">${esc(x.maker)}</span><a class="visit" href="/en/p/${xs}.html">Details ↗</a></div>
    </article>`;
    })
    .join("");

  const softwareApp = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: enNameOf(p),
    description: shownDesc,
    url: p.url,
    applicationCategory: catEn,
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
    author: { "@type": "Person", name: p.maker },
    datePublished: p.addedAt,
    inLanguage: "en"
  });
  const breadcrumbLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Directory", item: `${siteUrl}/en/` },
      { "@type": "ListItem", position: 2, name: catEn, item: `${siteUrl}/en/c/${catSlug}.html` },
      { "@type": "ListItem", position: 3, name: enNameOf(p) }
    ]
  });

  // 原文折叠块（透明 + 每页真实增量）
  const originalBlock = /[\u4e00-\u9fff]/.test(p.description)
    ? `<details class="faq-item"><summary>Original description (Chinese, by the developer)</summary><p>${esc(p.description)}</p></details>`
    : "";

  const mtNote = hasEn
    ? `<p class="u-note">${MT_NOTE} <a href="${siteUrl}/p/${slug}.html" hreflang="zh-CN" lang="zh-CN">中文原页 ↗</a></p>`
    : `<p class="u-note">This entry's English translation is not ready yet — the original Chinese description is shown. <a href="${siteUrl}/p/${slug}.html" hreflang="zh-CN" lang="zh-CN">中文原页 ↗</a></p>`;

  const title = `${enNameOf(p)} — ${catEn} by Chinese indie developers | Indie Maker`;
  const metaDesc = shownDesc.length > 300 ? shownDesc.slice(0, 297) + "..." : shownDesc;

  return shell({
    siteUrl,
    umamiScript,
    organizationLd,
    title,
    desc: metaDesc,
    canonical: `${siteUrl}/en/p/${slug}.html`,
    zhUrl: `${siteUrl}/p/${slug}.html`,
    jsonLd: [softwareApp, breadcrumbLD],
    body: `    <nav class="breadcrumb" aria-label="Breadcrumb">${breadcrumb}</nav>
    <article class="detail-card">
      <div class="detail-head"><span class="edition-badge">${EN_EDITION[p.edition] || "Indie product"}</span></div>
      <h1>${name}</h1>
      <p class="detail-desc">${shownDescE}</p>
      ${mtNote}
      <div class="detail-meta">
        <span><b>Developer</b>${esc(p.maker)}${p.city ? ` · ${esc(p.city)}` : ""}</span>
        <span><b>Status</b>${enStatusChip(p)}</span>
        <span><b>Added</b><time>${p.addedAt}</time></span>
        <span><b>Tags</b>${tagLinks}</span>
      </div>
      <p class="detail-actions"><a class="btn-primary" href="${esc(p.url)}" target="_blank" rel="noreferrer"${outbound}>Visit official site ↗</a>${extraLinks}</p>
    </article>
    ${originalBlock}
    ${relatedCards ? `<section class="related" id="related"><h2>Related products</h2><div class="related-grid">${relatedCards}</div></section>` : ""}
    <section class="unique-block">
      <h2>About this listing</h2>
      <p>This page is part of <a href="/en/">Indie Maker</a>, a directory of works by Chinese indie developers. We sync daily from the open-source repository <a href="https://github.com/1c7/chinese-independent-developer" target="_blank" rel="noreferrer">chinese-independent-developer</a>; this product was added on <b>${p.addedAt}</b>.</p>
      <p class="u-boundary"><b>About pricing</b><span>Any pricing, membership, plans or premium features mentioned in a product's description belong to that product itself, not to this directory. We don't build, host or resell any product — the directory is entirely free.</span></p>
    </section>`
  });
}

function renderEnCategoryPage(cat, catSlug, productsInCat, slugMap, descEnMap, allCats, page, ctx) {
  const { siteUrl, umamiScript, organizationLd, categorySlugs } = ctx;
  const catEn = EN_CATEGORY[cat] || "Uncategorized";
  const totalPages = Math.max(1, Math.ceil(productsInCat.length / CATEGORY_PAGE_SIZE));
  const slice = productsInCat.slice((page - 1) * CATEGORY_PAGE_SIZE, page * CATEGORY_PAGE_SIZE);
  const today = new Date().toISOString().slice(0, 10);
  const zhUrl = page === 1 ? `${siteUrl}/c/${catSlug}.html` : `${siteUrl}/c/${catSlug}/${page}.html`;
  const canonical = page === 1 ? `${siteUrl}/en/c/${catSlug}.html` : `${siteUrl}/en/c/${catSlug}/${page}.html`;

  // 分类导航（同中文分类页结构：<a> 直接做 flex item）
  const catNav = allCats
    .map(([c, n]) => `<a href="/en/c/${categorySlugs[c] || "uncategorized"}.html"><span class="best-name" style="display:inline;border:0">${esc(EN_CATEGORY[c] || c)}</span> <small>${n}</small></a>`)
    .join("");

  // 分页导航
  const pageLink = (n) => (n === 1 ? "/en/c/" + catSlug + ".html" : `/en/c/${catSlug}/${n}.html`);
  let pagination = "";
  if (totalPages > 1) {
    const nums = [];
    for (let n = 1; n <= totalPages; n++) {
      nums.push(n === page ? `<b class="pg-cur">${n}</b>` : `<a href="${pageLink(n)}">${n}</a>`);
    }
    pagination = `<nav class="pagination" aria-label="Pages">${page > 1 ? `<a href="${pageLink(page - 1)}">‹ Prev</a>` : ""}${nums.join(" · ")}${page < totalPages ? `<a href="${pageLink(page + 1)}">Next ›</a>` : ""}</nav>`;
  }

  const items = slice.map((p) => enItem(p, slugMap, descEnMap)).join("");
  const listLD = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${catEn} — Chinese indie developer products`,
    numberOfItems: productsInCat.length,
    itemListElement: slice.map((p, i) => ({ "@type": "ListItem", position: (page - 1) * CATEGORY_PAGE_SIZE + i + 1, name: enNameOf(p), url: `${siteUrl}/en/p/${slugMap.get(p.id)}.html` }))
  });

  return shell({
    siteUrl,
    umamiScript,
    organizationLd,
    title: `${catEn} by Chinese indie developers (${productsInCat.length})${page > 1 ? ` — page ${page}` : ""} | Indie Maker`,
    desc: `Browse ${productsInCat.length} ${catEn.toLowerCase()} built by Chinese indie developers, with English descriptions, updated daily. Entirely free directory, no paid ranking.${page > 1 ? ` Page ${page} of ${totalPages}.` : ""}`,
    canonical,
    zhUrl,
    jsonLd: [listLD],
    body: `    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/en/">Directory</a><span class="sep">›</span><span class="current">${esc(catEn)}</span></nav>
    <div class="category-head">
      <h1>${esc(catEn)}</h1>
      <p class="category-count"><b>${productsInCat.length}</b> products${page > 1 ? ` · page ${page} of ${totalPages}` : ""} · updated ${today}</p>
      <nav class="category-nav" aria-label="Categories">${catNav}</nav>
    </div>
    <div class="category-grid"><ol class="best-list">${items}</ol></div>
    ${pagination}`
  });
}

/**
 * 英文深层页主入口。ctx 额外需要：
 *   descEnMap: Map/object  id → { descEn, at }
 *   relatedMap: Map<id, Product[]>（同中文详情页的「同分类推荐」，复用同一份计算）
 *   primaryCatMap: Map<id, 主分类>（供分类页归组）
 *   allCats: [分类名, 数量][]（含未分类，降序）
 * 返回 targets 数组：["en/p/xxx.html", html] + ["en/c/xxx.html" | "en/c/xxx/N.html", html]
 */
export function buildEnglishDeepPages(ctx) {
  if (ctx.nameEnMap) nameEnMap = ctx.nameEnMap;
  const { siteUrl, umamiScript, organizationLd, projects, slugMap, categorySlugs, descEnMap, relatedMap, primaryCatMap, allCats } = ctx;
  const base = { siteUrl, umamiScript, organizationLd, categorySlugs };
  const pages = [];

  for (const p of projects) {
    const slug = slugMap.get(p.id);
    pages.push([`en/p/${slug}.html`, renderEnProductPage(p, slug, slugMap, relatedMap.get(p.id) || [], descEnMap, base)]);
  }

  // 分类页（含「未分类」）——⚠️ 归组逻辑必须与中文版 categoryEntries 一致：
  // 按 p.categories.includes(cat) 多归属（一个产品出现在它属于的每个分类），
  // 不能用 primaryCatMap 单归属——否则分页数比中文版/sitemap 少一半，产生 sitemap 404。
  for (const [cat, catSlug] of Object.entries(categorySlugs)) {
    const productsInCat = cat === "未分类"
      ? projects.filter((p) => !p.categories || p.categories.length === 0)
      : projects.filter((p) => (p.categories || []).includes(cat));
    const totalPages = Math.max(1, Math.ceil(productsInCat.length / CATEGORY_PAGE_SIZE));
    for (let page = 1; page <= totalPages; page++) {
      pages.push([
        page === 1 ? `en/c/${catSlug}.html` : `en/c/${catSlug}/${page}.html`,
        renderEnCategoryPage(cat, catSlug, productsInCat, slugMap, descEnMap, allCats, page, base)
      ]);
    }
  }

  return pages;
}
