import { LOCALES, t, setLocale, getCurrentLocale, getSavedLocale, browserLocale, detectLocaleByIP, categoryName } from "./i18n.js";

const state = {
  data: null,
  slugMap: new Map(), // id -> 详情页 slug（与 scripts/build.mjs 逻辑一致）
  query: "",
  edition: "all",
  statuses: new Set(["online", "developing"]),
  category: "",
  sort: "newest",
  limit: 48
};

const elements = {
  search: document.querySelector("#searchInput"),
  clear: document.querySelector("#clearSearch"),
  quickTags: document.querySelector("#quickTags"),
  grid: document.querySelector("#projectGrid"),
  empty: document.querySelector("#emptyState"),
  resultCount: document.querySelector("#resultCount"),
  activeFilter: document.querySelector("#activeFilter"),
  loadMore: document.querySelector("#loadMore"),
  sort: document.querySelector("#sortSelect"),
  langToggle: document.querySelector("#langToggle")
};

const editionKeyMap = { main: "editionMain", programmer: "editionProgrammer", game: "editionGame" };
const escapeHTML = (value = "") => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const normalize = (value = "") => value.toLowerCase().normalize("NFKC");

// ── 数据文本清洗（与 scripts/build.mjs 的 cleanText 必须保持一致）──
// 上游仓库的 description / maker 里混有 Markdown 语法，前端渲染卡片时会露出
// 「- [GitHub 仓库](https://...)」这类残骸。这里只做语法→纯文本的降级还原。
function cleanText(value = "") {
  return String(value)
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, text, url) => text.trim() || url)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── slug 生成（必须与 scripts/build.mjs 完全一致，否则详情链接会 404）──
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

function readURLState() {
  const params = new URLSearchParams(location.search);
  state.query = params.get("q") || "";
  state.edition = ["main", "programmer", "game"].includes(params.get("edition")) ? params.get("edition") : "all";
  state.category = params.get("category") || "";
  elements.search.value = state.query;
  document.querySelector(`input[name="edition"][value="${state.edition}"]`).checked = true;
}

function syncURL() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.edition !== "all") params.set("edition", state.edition);
  if (state.category) params.set("category", state.category);
  const next = params.size ? `?${params}` : location.pathname;
  history.replaceState(null, "", next);
}

function filteredProjects() {
  const words = normalize(state.query).split(/\s+/).filter(Boolean);
  const list = state.data.projects.filter((project) => {
    if (state.edition !== "all" && project.edition !== state.edition) return false;
    if (!state.statuses.has(project.status)) return false;
    if (state.category && !project.categories.includes(state.category)) return false;
    if (!words.length) return true;
    const haystack = normalize([project.name, project.description, project.maker, project.city, ...project.categories].join(" "));
    return words.every((word) => haystack.includes(word));
  });
  return list.sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name, getCurrentLocale() === "zh" ? "zh-CN" : "en");
    if (state.sort === "maker") return a.maker.localeCompare(b.maker, getCurrentLocale() === "zh" ? "zh-CN" : "en");
    return b.addedAt.localeCompare(a.addedAt);
  });
}

// 外链点击埋点属性。与 scripts/build.mjs 的 outboundAttrs() 必须保持一致，
// 否则「静态快照卡片」与「JS 重绘卡片」会被记成两套口径。
// 首页卡片由本文件整体重绘（render() 里 grid.innerHTML = …），所以这里的埋点是主路径，
// SSR 那份只是首屏快照。声明式属性由追踪器在 document 上做事件委托捕获，动态元素同样有效。
function outboundAttrs(placement, slug) {
  const target = slug ? ` data-umami-event-target="${slug}"` : "";
  return ` data-umami-event="outbound" data-umami-event-placement="${placement}"${target}`;
}

function cardTemplate(project, index) {
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const tags = project.categories.slice(0, 3).map((tag) => `<span>${escapeHTML(categoryName(tag))}</span>`).join("");
  const editionLabel = t(editionKeyMap[project.edition] || "editionMain");
  const slug = state.slugMap.get(project.id);
  const visit = `<a class="visit" href="${escapeHTML(project.url)}" target="_blank" rel="noreferrer"${outboundAttrs("card", slug)}>${t("cardVisit")}</a>`;
  const detail = slug
    ? `<span class="card-links"><a class="detail" href="/p/${slug}.html">${t("cardDetail")}</a>${visit}</span>`
    : visit;
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${editionLabel}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${slug ? `/p/${slug}.html` : escapeHTML(project.url)}"${slug ? "" : ' target="_blank" rel="noreferrer"'}>${escapeHTML(project.name)}</a></h2>
    <p>${escapeHTML(project.description)}</p>
    <div class="card-tags">${tags}</div>
    <div class="card-footer"><span class="maker">${escapeHTML(project.maker)}${city}</span>${detail}</div>
  </article>`;
}

function render() {
  if (!state.data) return;
  const projects = filteredProjects();
  elements.resultCount.textContent = t("resultsCount", projects.length);
  const filters = [
    state.query && `“${state.query}”`,
    state.edition !== "all" && t(editionKeyMap[state.edition]),
    state.category
  ].filter(Boolean);
  elements.activeFilter.textContent = filters.join(" · ");
  elements.grid.innerHTML = projects.slice(0, state.limit).map(cardTemplate).join("");
  elements.grid.hidden = projects.length === 0;
  elements.empty.hidden = projects.length !== 0;
  elements.loadMore.hidden = projects.length <= state.limit;
  const remaining = Math.min(48, projects.length - state.limit);
  elements.loadMore.lastChild.textContent = `${t("resultsLoadMoreCount", remaining)} ↓`;
  document.querySelectorAll("#quickTags button").forEach((button) => button.classList.toggle("active", button.dataset.category === state.category));
  syncURL();
}

function reset() {
  state.query = "";
  state.edition = "all";
  state.category = "";
  state.statuses = new Set(["online", "developing"]);
  state.limit = 48;
  elements.search.value = "";
  document.querySelector('input[name="edition"][value="all"]').checked = true;
  document.querySelectorAll('input[name="status"]').forEach((input) => { input.checked = input.value !== "inactive"; });
  render();
}

// 注入 ItemList 结构化数据（帮助 Google 展示富结果）
// ⚠️ item 的 url 必须指向【本站在该产品上的详情页】，而不是产品官网。
// 目录站的「条目」就是本站的收录页；指向外站既不符合语义，也把权重让了出去。
const SITE_URL = "https://indiemaker.cn";
function injectItemListJSONLD() {
  if (!state.data) return;
  const items = state.data.projects.slice(0, 10).map((project, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "name": project.name,
    "url": `${SITE_URL}/p/${state.slugMap.get(project.id)}.html`
  }));
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "中国独立开发者产品列表",
    "itemListElement": items
  };
  document.querySelectorAll('script[data-seo="itemlist"]').forEach((node) => node.remove());
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.seo = "itemlist";
  script.textContent = JSON.stringify(ld);
  document.head.appendChild(script);
}

// 应用 locale：更新所有 data-i18n 元素
function applyLocale() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    // 元素若带 data-i18n-attr，只更新属性，不覆盖子内容
    if (el.hasAttribute("data-i18n-attr")) {
      el.setAttribute(el.getAttribute("data-i18n-attr"), t(key));
    } else {
      el.textContent = t(key);
    }
  });
  // 同一个元素既翻译属性又翻译文本时（如带 aria-label 的按钮），用 data-i18n-text 补充
  document.querySelectorAll("[data-i18n-text]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n-text"));
  });
  // 分类名（含首页频道入口里的榜单名与分类名）：data-i18n-cat 存的是中文原名，
  // 按当前 locale 经 categoryName() 映射成界面语言。此前 SSR 卡片标签没人处理这层，
  // 切到英文时分类标签仍是中文，与此处一并修掉。
  document.querySelectorAll("[data-i18n-cat]").forEach((el) => {
    el.textContent = categoryName(el.getAttribute("data-i18n-cat"));
  });
  // 动态重建：需要根据 locale 重绘
  const isZh = getCurrentLocale() === "zh";
  document.documentElement.lang = isZh ? "zh-CN" : "en";
  document.title = isZh ? "AI 独立制造所 - 独立开发者项目导航 | AI 工具合集" : "Indie Maker · AI tools directory for indie developers";
  // 产品数动态化：优先用真实数据，避免硬编码数字过时拖累 SERP 相关性
  const totalCount = state.data?.counts?.total;
  const totalLabel = totalCount ? `${totalCount.toLocaleString("zh-CN")}+` : "2900+";
  const desc = isZh
    ? `发现中国独立开发者创造的网站、应用、工具与游戏，每日自动同步更新。涵盖 AI 工具、音视频、效率工具、开发工具、独立游戏等 ${totalLabel} 精选产品。`
    : `Discover websites, apps, tools and games built by Chinese indie developers, synced daily. ${totalLabel} handpicked products across AI, productivity, dev tools and more.`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", desc);
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", desc);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", document.title);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", desc);
  if (state.data) {
    const total = state.data.counts.total;
    const loc = getCurrentLocale();
    document.querySelector("#heroTotal").textContent = loc === "zh" ? total.toLocaleString("zh-CN") : total.toLocaleString("en");
    document.querySelector("#syncTime").textContent = t("syncTime", new Date(state.data.generatedAt));
    render();
  }
}

// 重绘「依赖 locale 的动态内容」（分类胶囊、卡片网格、总量与同步时间）。
// 这些是 JS 用 innerHTML 渲染出来的，身上没有 data-i18n 标记，applyLocale() 覆盖不到，
// 因此切换语言时必须单独重绘一次，否则会出现「界面文案切了、分类胶囊没切」的割裂。
function renderLocaleDependent() {
  if (!state.data) return;
  const loc = getCurrentLocale();
  const total = state.data.counts.total;
  const heroTotal = document.querySelector("#heroTotal");
  if (heroTotal) heroTotal.textContent = loc === "zh" ? total.toLocaleString("zh-CN") : total.toLocaleString("en");
  const syncEl = document.querySelector("#syncTime");
  if (syncEl) syncEl.textContent = t("syncTime", new Date(state.data.generatedAt));
  const categories = Object.entries(state.data.categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 9);
  elements.quickTags.innerHTML = categories.map(([name, count]) => `<button type="button" data-category="${escapeHTML(name)}">${escapeHTML(categoryName(name))} <small>${count}</small></button>`).join("");
  render();
}

function toggleLocale() {
  const next = getCurrentLocale() === "zh" ? "en" : "zh";
  setLocale(next);
  applyLocale();
  renderLocaleDependent();
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  // 语言切换量：用来判断英文界面的真实需求强度（站内海外访客占 46%，但「会点切换」才是真需求）。
  // 这里用命令式而非 data-umami-event：「目标语言」每次点击都在翻转，属性只能写死一个值。
  // 追踪尚在加载时不报错、也不补发 —— 切语言是低价值事件，丢一两条无妨。
  window.umami?.track("lang-switch", { to: next });
}

function bindEvents() {
  let timer;
  elements.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = elements.search.value.trim(); state.limit = 48; render(); }, 120);
  });
  elements.clear.addEventListener("click", () => { state.query = ""; elements.search.value = ""; elements.search.focus(); render(); });
  document.querySelectorAll('input[name="edition"]').forEach((input) => input.addEventListener("change", () => { state.edition = input.value; state.limit = 48; render(); }));
  document.querySelectorAll('input[name="status"]').forEach((input) => input.addEventListener("change", () => { input.checked ? state.statuses.add(input.value) : state.statuses.delete(input.value); state.limit = 48; render(); }));
  elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; render(); });
  elements.quickTags.addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; state.category = state.category === button.dataset.category ? "" : button.dataset.category; state.limit = 48; render(); });
  elements.loadMore.addEventListener("click", () => { state.limit += 48; render(); });
  document.querySelector("#resetFilters").addEventListener("click", reset);
  document.querySelector("#emptyReset").addEventListener("click", reset);
  elements.langToggle.addEventListener("click", toggleLocale);
  document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== elements.search) { event.preventDefault(); elements.search.focus(); } });
}

// 数据源顺序：站点本地副本优先 → COS 主库（回退）
// ⚠️ 本地 data/projects.json 与 /p/ 详情页在同一次 build 的同一个部署包里，slug 永远一致；
// COS 由 sync 第一步即上传，可能超前于站点部署——若 COS 优先，前端会渲染出「尚无详情页」的
// 新产品卡片，点详情 404（2026-09-15 实际事故）。正确性优先于及时性，故本地在前。
const DATA_URLS = [
  "data/projects.json",
  "https://indie-maker-data-1300618702.cos.ap-guangzhou.myqcloud.com/data/projects.json"
];

async function loadData() {
  let lastError = null;
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`[data] ${url} 不可用，尝试下一个数据源：${error.message}`);
    }
  }
  throw lastError || new Error("所有数据源均不可用");
}

async function init() {
  // locale 决策：用户选择 > 浏览器 > 默认 zh
  const saved = getSavedLocale();
  const initial = saved || browserLocale();
  setLocale(initial);

  // 首次应用 i18n（无数据时 render 会 return，但 DOM 文本已更新）
  applyLocale();

  readURLState();
  bindEvents();
  try {
    state.data = await loadData();
    // 清洗上游 Markdown 残骸（本地副本与 COS 回退来源都可能带语法）
    for (const p of state.data.projects) {
      if (p.description) p.description = cleanText(p.description);
      if (p.maker) p.maker = cleanText(p.maker);
    }
    state.slugMap = buildSlugMap(state.data.projects);
    const total = state.data.counts.total;
    document.querySelector("#countAll").textContent = total;
    document.querySelector("#countMain").textContent = state.data.counts.main;
    document.querySelector("#countProgrammer").textContent = state.data.counts.programmer;
    document.querySelector("#countGame").textContent = state.data.counts.game;
    renderLocaleDependent();
    injectItemListJSONLD();

    // 数据加载完后再根据 IP 智能切换（仅在用户没手动选过、且当前与 IP 推断不同时）
    if (!saved) {
      const ipLocale = await detectLocaleByIP();
      if (ipLocale && ipLocale !== getCurrentLocale()) {
        setLocale(ipLocale);
        applyLocale();
        renderLocaleDependent();
        try { sessionStorage.setItem("imd.ipDetected", "1"); } catch {}
      }
    }
  } catch (error) {
    elements.resultCount.textContent = t("errorTitle");
    elements.grid.innerHTML = `<div class="empty-state"><h2>${escapeHTML(t("errorHeading"))}</h2><p>${escapeHTML(t("errorBody", error.message))}</p></div>`;
  }
}

init();
