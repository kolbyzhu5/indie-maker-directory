import { LOCALES, t, setLocale, getCurrentLocale, getSavedLocale, browserLocale, detectLocaleByIP } from "./i18n.js";

const state = {
  data: null,
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

function cardTemplate(project, index) {
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const tags = project.categories.slice(0, 3).map((tag) => `<span>${escapeHTML(tag)}</span>`).join("");
  const editionLabel = t(editionKeyMap[project.edition] || "editionMain");
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${editionLabel}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${escapeHTML(project.url)}" target="_blank" rel="noreferrer">${escapeHTML(project.name)}</a></h2>
    <p>${escapeHTML(project.description)}</p>
    <div class="card-tags">${tags}</div>
    <div class="card-footer"><span class="maker">${escapeHTML(project.maker)}${city}</span><a class="visit" href="${escapeHTML(project.url)}" target="_blank" rel="noreferrer">${t("cardVisit")}</a></div>
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
function injectItemListJSONLD() {
  if (!state.data) return;
  const items = state.data.projects.slice(0, 10).map((project, index) => ({
    "@type": "ListItem",
    "position": index + 1,
    "name": project.name,
    "url": project.url
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
  // 动态重建：需要根据 locale 重绘
  const isZh = getCurrentLocale() === "zh";
  document.documentElement.lang = isZh ? "zh-CN" : "en";
  document.title = isZh ? "独立制造所｜中国独立开发者产品导航" : "Indie Maker · Directory of Chinese indie developer products";
  const desc = isZh
    ? "发现中国独立开发者创造的网站、应用、工具与游戏，每日自动同步更新。涵盖 AI 工具、音视频、效率工具、开发工具、独立游戏等 2000+ 精选产品。"
    : "Discover websites, apps, tools and games built by Chinese indie developers, synced daily. 2000+ handpicked products across AI, productivity, dev tools and more.";
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

function toggleLocale() {
  const next = getCurrentLocale() === "zh" ? "en" : "zh";
  setLocale(next);
  applyLocale();
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

// 数据源顺序：COS 主库 → GitHub Pages 本地副本（回退）
const DATA_URLS = [
  "https://indie-maker-data-1300618702.cos.ap-guangzhou.myqcloud.com/data/projects.json",
  "data/projects.json"
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
    const total = state.data.counts.total;
    const loc = getCurrentLocale();
    document.querySelector("#heroTotal").textContent = loc === "zh" ? total.toLocaleString("zh-CN") : total.toLocaleString("en");
    document.querySelector("#countAll").textContent = state.data.counts.total;
    document.querySelector("#countMain").textContent = state.data.counts.main;
    document.querySelector("#countProgrammer").textContent = state.data.counts.programmer;
    document.querySelector("#countGame").textContent = state.data.counts.game;
    document.querySelector("#syncTime").textContent = t("syncTime", new Date(state.data.generatedAt));
    const categories = Object.entries(state.data.categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 9);
    elements.quickTags.innerHTML = categories.map(([name, count]) => `<button type="button" data-category="${escapeHTML(name)}">${escapeHTML(name)} <small>${count}</small></button>`).join("");
    render();
    injectItemListJSONLD();

    // 数据加载完后再根据 IP 智能切换（仅在用户没手动选过、且当前与 IP 推断不同时）
    if (!saved) {
      const ipLocale = await detectLocaleByIP();
      if (ipLocale && ipLocale !== getCurrentLocale()) {
        setLocale(ipLocale);
        applyLocale();
        try { sessionStorage.setItem("imd.ipDetected", "1"); } catch {}
      }
    }
  } catch (error) {
    elements.resultCount.textContent = t("errorTitle");
    elements.grid.innerHTML = `<div class="empty-state"><h2>${escapeHTML(t("errorHeading"))}</h2><p>${escapeHTML(t("errorBody", error.message))}</p></div>`;
  }
}

init();
