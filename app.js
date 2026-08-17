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
  sort: document.querySelector("#sortSelect")
};

const editionNames = { main: "大众产品", programmer: "程序员版", game: "独立游戏" };
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
    if (state.sort === "name") return a.name.localeCompare(b.name, "zh-CN");
    if (state.sort === "maker") return a.maker.localeCompare(b.maker, "zh-CN");
    return b.addedAt.localeCompare(a.addedAt);
  });
}

function cardTemplate(project, index) {
  const city = project.city ? ` · ${escapeHTML(project.city)}` : "";
  const tags = project.categories.slice(0, 3).map((tag) => `<span>${escapeHTML(tag)}</span>`).join("");
  return `<article class="project-card" style="animation-delay:${Math.min(index, 12) * 22}ms">
    <div class="card-top"><span class="edition-badge">${editionNames[project.edition]}</span><time class="card-date">${project.addedAt}</time></div>
    <h2><a href="${escapeHTML(project.url)}" target="_blank" rel="noreferrer">${escapeHTML(project.name)}</a></h2>
    <p>${escapeHTML(project.description)}</p>
    <div class="card-tags">${tags}</div>
    <div class="card-footer"><span class="maker">${escapeHTML(project.maker)}${city}</span><a class="visit" href="${escapeHTML(project.url)}" target="_blank" rel="noreferrer">去看看 ↗</a></div>
  </article>`;
}

function render() {
  if (!state.data) return;
  const projects = filteredProjects();
  elements.resultCount.textContent = `找到 ${projects.length.toLocaleString("zh-CN")} 件作品`;
  const filters = [state.query && `“${state.query}”`, state.edition !== "all" && editionNames[state.edition], state.category].filter(Boolean);
  elements.activeFilter.textContent = filters.join(" · ");
  elements.grid.innerHTML = projects.slice(0, state.limit).map(cardTemplate).join("");
  elements.grid.hidden = projects.length === 0;
  elements.empty.hidden = projects.length !== 0;
  elements.loadMore.hidden = projects.length <= state.limit;
  elements.loadMore.textContent = `再看 ${Math.min(48, projects.length - state.limit)} 件 ↓`;
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
  document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== elements.search) { event.preventDefault(); elements.search.focus(); } });
}

async function init() {
  readURLState();
  bindEvents();
  try {
    const response = await fetch("data/projects.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    document.querySelector("#heroTotal").textContent = state.data.counts.total.toLocaleString("zh-CN");
    document.querySelector("#countAll").textContent = state.data.counts.total;
    document.querySelector("#countMain").textContent = state.data.counts.main;
    document.querySelector("#countProgrammer").textContent = state.data.counts.programmer;
    document.querySelector("#countGame").textContent = state.data.counts.game;
    document.querySelector("#syncTime").textContent = `更新于 ${new Date(state.data.generatedAt).toLocaleDateString("zh-CN")}`;
    const categories = Object.entries(state.data.categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 9);
    elements.quickTags.innerHTML = categories.map(([name, count]) => `<button type="button" data-category="${escapeHTML(name)}">${escapeHTML(name)} <small>${count}</small></button>`).join("");
    render();
  } catch (error) {
    elements.resultCount.textContent = "目录读取失败";
    elements.grid.innerHTML = `<div class="empty-state"><h2>暂时无法打开目录</h2><p>${escapeHTML(error.message)}，请稍后刷新。</p></div>`;
  }
}

init();
