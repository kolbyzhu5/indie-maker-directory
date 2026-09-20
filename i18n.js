// i18n 模块：双语字典 + 智能默认 + 切换
// 数据（产品名/介绍）不在字典中，由源仓库提供，保持原样。

export const LOCALES = {
  zh: {
    code: "zh",
    // lang 切换按钮显示：点击切到英文时显示 "EN"
    langToggleLabel: "EN",
    // brand
    brandTitle: "AI 独立制造所",
    brandSubtitle: "独立开发者 · AI 工具导航",
    // nav
    navBrowse: "逛产品",
    navBestAI: "AI 工具精选",
    navBestGames: "独立游戏精选",
    // hero
    heroEyebrow: "每日从 GitHub 自动整理",
    heroTitle1: "好产品，",
    heroTitleEm: "不该埋在",
    heroTitle2: "几千行 README 里。",
    heroDesc: "收录中国独立开发者创造的 AI 工具、网站、应用与游戏的目录站：不开发、不托管、不代理任何产品，只做索引与导航。全站免费，无竞价排名。",
    heroToday: "今日馆藏",
    heroUnit: "件独立作品",
    heroLoading: "正在读取...",
    // search
    searchPlaceholder: "搜产品、功能、开发者，例如：AI、PDF、macOS…",
    searchClear: "清空",
    // filter
    filterTitle: "浏览目录",
    filterReset: "重置",
    editionLegend: "作品版面",
    editionAll: "全部作品",
    editionMain: "大众产品",
    editionProgrammer: "程序员版",
    editionGame: "独立游戏",
    statusLegend: "项目状态",
    statusOnline: "已上线",
    statusDeveloping: "开发中",
    statusInactive: "已停止",
    sourceNote: "数据来自开源社区，项目状态及描述以原仓库为准。",
    // results
    sortLabel: "排序",
    sortNewest: "最近收录",
    sortName: "名称 A–Z",
    sortMaker: "开发者",
    resultsLoading: "正在装订目录…",
    resultsEmptyTitle: "没找到相符的作品",
    resultsEmptyDesc: "换个关键词，或者减少筛选条件试试。",
    resultsEmptyAction: "查看全部作品",
    resultsLoadMore: "再翻一页",
    // footer
    footerSlogan: "AI 独立制造所 · 让认真做出来的东西被看见",
    footerDef: "本站是收录中国独立开发者创造的 AI 工具、网站、应用与游戏的目录站，不开发、不托管、不代理任何产品；产品描述中的价格、会员、套餐均属该产品自身，与本站无关。全站免费，无竞价排名。",
    footerFeedback: "反馈建议",
    // a11y
    a11yHome: "AI 独立制造所首页",
    a11ySearch: "搜索产品、开发者或介绍",
    a11yFilters: "筛选条件",
    a11yResults: "产品列表",
    a11yClearSearch: "清空搜索",
    a11yQuickTags: "热门分类",
    a11yLangToggle: "切换语言",
    // ── 内页界面文案（详情页 / 分类页 / 榜单页）──
    cardDetail: "详情",
    backHome: "首页",
    relatedTitle: "同分类推荐",
    paginationPrev: "← 上一页",
    paginationNext: "下一页 →",
    detailVisitSite: "访问官网",
    detailMoreLikeThis: "看同类产品 ↓",
    detailMakerLabel: "开发者",
    detailStatusLabel: "状态",
    dataSourceTitle: "数据来源",
    detailBoundaryLabel: "关于产品信息",
    detailBoundaryText: "以上名称、介绍与开发者信息来自上游开源仓库，本站原样同步、不做改写。文中提到的价格、会员、套餐、高级功能等，均为该产品自身的商业模式，与本目录站无关——本站不开发、不托管、不代理任何产品，全站免费且无会员。",
    sameBatchTitle: "同一批被收录的还有",
    catStatTotal: "共收录",
    catStatOnline: "已上线",
    catStatDeveloping: "开发中",
    catStatInactive: "已停更",
    moreRankingsTitle: "更多精选榜单",
    faqTitle: "常见问题",
    aboutLink: "关于本站",
    catCountLabel: "共收录",
    catCountUnit: "个产品",
    aboutBreadcrumb: "关于",
    weeklyBreadcrumb: "本周新收录",
    // 404 页
    notFoundTitle: "页面走丢了",
    notFoundDesc: "这个地址不存在，也可能是那个产品已经被移除了。下面这些入口也许能帮到你。",
    notFoundEntries: "换个入口逛逛",
    notFoundCategories: "热门分类",
    notFoundLatest: "最新收录",
    // 首页站点定义（GEO：给 AI 搜索一个明确可引用的自我描述）
    siteDefTitle: "AI 独立制造所是什么？",
    siteDefLead: "收录中国独立开发者创造的 AI 工具、网站、应用与游戏的目录站，不是工具站：本站不开发、不托管、不代理任何产品，只做索引与导航。",
    siteDefFree: "全站免费，无会员无付费",
    siteDefNoRank: "无竞价排名，排序只看收录时间",
    siteDefBoundary: "描述中的价格与会员属产品自身，与本站无关"
  },
  en: {
    code: "en",
    // lang 切换按钮显示：点击切到中文时显示 "中"
    langToggleLabel: "中",
    brandTitle: "Indie Maker",
    brandSubtitle: "Indie developers · AI tools directory",
    navBrowse: "Browse",
    navBestAI: "AI Tools Picks",
    navBestGames: "Indie Games",
    heroEyebrow: "Curated daily from GitHub",
    heroTitle1: "Great products, ",
    heroTitleEm: "shouldn't be buried",
    heroTitle2: "in thousands of lines of README.",
    heroDesc: "A directory of AI tools, websites, apps and games created by Chinese indie developers: we don't build, host or resell any product — we only index and navigate. Entirely free, no paid rankings.",
    heroToday: "Today's collection",
    heroUnit: "independent works",
    heroLoading: "Loading...",
    searchPlaceholder: "Search products, features, makers — e.g. AI, PDF, macOS…",
    searchClear: "Clear",
    filterTitle: "Browse directory",
    filterReset: "Reset",
    editionLegend: "Edition",
    editionAll: "All",
    editionMain: "Main",
    editionProgrammer: "Programmer",
    editionGame: "Games",
    statusLegend: "Status",
    statusOnline: "Online",
    statusDeveloping: "In development",
    statusInactive: "Discontinued",
    sourceNote: "Data from the open-source community. Status and descriptions per upstream repository.",
    sortLabel: "Sort",
    sortNewest: "Recently added",
    sortName: "Name A–Z",
    sortMaker: "Maker",
    resultsLoading: "Loading directory…",
    resultsEmptyTitle: "No matches found",
    resultsEmptyDesc: "Try different keywords or relax your filters.",
    resultsEmptyAction: "View all",
    resultsLoadMore: "Show more",
    footerSlogan: "Indie Maker · Making sure good work gets seen",
    footerDef: "This site is a directory of AI tools, websites, apps and games created by Chinese indie developers. We don't build, host or resell any product; any pricing, membership or plans mentioned in a product's description belong to that product, not to us. Entirely free, with no paid rankings.",
    footerFeedback: "Feedback",
    a11yHome: "Indie Maker home",
    a11ySearch: "Search products, makers or descriptions",
    a11yFilters: "Filters",
    a11yResults: "Product list",
    a11yClearSearch: "Clear search",
    a11yQuickTags: "Popular categories",
    a11yLangToggle: "Toggle language",
    // ── Inner pages (detail / category / ranking) ──
    cardDetail: "Details",
    backHome: "Home",
    relatedTitle: "More in this category",
    paginationPrev: "← Previous",
    paginationNext: "Next →",
    detailVisitSite: "Visit site",
    detailMoreLikeThis: "Similar products ↓",
    detailMakerLabel: "Maker",
    detailStatusLabel: "Status",
    dataSourceTitle: "Data source",
    detailBoundaryLabel: "About this product's info",
    detailBoundaryText: "The name, description and maker info above come from an upstream open-source repository and are synced as-is. Any pricing, membership, plans or premium features mentioned belong to that product itself, not to this directory site — we don't build, host or resell any product, and this site is entirely free with no membership.",
    sameBatchTitle: "Also added in the same batch",
    catStatTotal: "Total",
    catStatOnline: "Online",
    catStatDeveloping: "In development",
    catStatInactive: "Discontinued",
    moreRankingsTitle: "More curated lists",
    faqTitle: "FAQ",
    aboutLink: "About",
    catCountLabel: "Contains",
    catCountUnit: "products",
    aboutBreadcrumb: "About",
    weeklyBreadcrumb: "This week",
    // 404 页
    notFoundTitle: "Page not found",
    notFoundDesc: "This URL doesn't exist — the product may have been removed. Here are a few ways to keep browsing.",
    notFoundEntries: "Try another entry",
    notFoundCategories: "Popular categories",
    notFoundLatest: "Recently added",
    // Homepage site definition (GEO: a quotable self-description for AI search)
    siteDefTitle: "What is Indie Maker?",
    siteDefLead: "A directory of AI tools, websites, apps and games created by Chinese indie developers — not a tool site. We don't build, host or resell any product; we only index and navigate.",
    siteDefFree: "Entirely free — no membership, no paid features",
    siteDefNoRank: "No paid ranking — sorted by date added only",
    siteDefBoundary: "Pricing & membership in a description belong to that product, not to us"
  }
};

// 动态函数：依赖当前 locale
const DYNAMIC = {
  syncTime: (date) => {
    if (currentLocale === "zh") return `更新于 ${date.toLocaleDateString("zh-CN")}`;
    return `Updated ${date.toLocaleDateString("en")}`;
  },
  resultsCount: (n) => {
    if (currentLocale === "zh") return `找到 ${n.toLocaleString("zh-CN")} 件作品`;
    return `${n.toLocaleString("en")} works found`;
  },
  resultsLoadMoreCount: (n) => {
    if (currentLocale === "zh") return `再看 ${n} 件`;
    return `Show ${n} more`;
  },
  errorBody: (msg) => {
    if (currentLocale === "zh") return `${msg}，请稍后刷新。`;
    return `${msg}. Please refresh later.`;
  },
  // 卡片状态映射
  projectStatus: (key) => {
    const map = {
      online: { zh: "已上线", en: "Online" },
      developing: { zh: "开发中", en: "In development" },
      inactive: { zh: "已停止", en: "Discontinued" }
    };
    return (map[key] && map[key][currentLocale]) || key;
  },
  // 卡片"去看看"按钮
  cardVisit: () => (currentLocale === "zh" ? "去看看 ↗" : "Visit ↗"),
  // ── 内页参数化文案 ──
  detailAddedAt: (date) => (currentLocale === "zh" ? `${date} 收录` : `Added ${date}`),
  sameMakerTitle: (maker) => (currentLocale === "zh" ? `「${maker}」还做了这些` : `More by ${maker}`),
  sameBatchNote: (date, n) => (currentLocale === "zh" ? `本批（${date}）共收录 ${n} 个作品` : `${n} works in the same batch (${date})`),
  catInsightTitle: (cat) => (currentLocale === "zh" ? `关于「${cat}」分类` : `About ${CATEGORY_I18N[cat] || cat}`),
  browseAllInCat: (cat) => (currentLocale === "zh" ? `浏览「${cat}」全部产品 →` : `Browse all ${CATEGORY_I18N[cat] || cat} →`),
  paginationInfo: (page, total) => (currentLocale === "zh" ? `第 ${page} / ${total} 页` : `Page ${page} of ${total}`),
  catCount: (n) => (currentLocale === "zh" ? `共收录 ${n} 个产品` : `${n} products`),
  catIdxNote: (idx, pct) => (currentLocale === "zh"
    ? `本产品是该分类按收录时间排序的 第 ${idx} 个 作品；该分类中约 ${pct}% 的作品已停更。`
    : `Ranked #${idx} by addition time in this category; about ${pct}% of it is discontinued.`)
};

let currentLocale = "zh";

export function getCurrentLocale() {
  return currentLocale;
}

export function t(key, ...args) {
  if (DYNAMIC[key]) return DYNAMIC[key](...args);
  const value = LOCALES[currentLocale]?.[key];
  if (value === undefined) return key;
  return value;
}

export function setLocale(locale) {
  if (!LOCALES[locale]) return;
  currentLocale = locale;
  try {
    localStorage.setItem("imd.locale", locale);
  } catch {}
}

const STORAGE_KEY = "imd.locale";

export function getSavedLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES[saved]) return saved;
  } catch {}
  return null;
}

export function browserLocale() {
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

// IP 地理位置检测（异步、不阻塞首屏、不影响主流程）
// 策略：浏览器语言已经 95% 准，IP 仅在用户未手动选择时作为增强。
// 失败/被限流时返回 null，自动降级到浏览器语言。
export async function detectLocaleByIP() {
  // 优先：country.is（极简 CORS 友好）
  try {
    const res = await fetch("https://api.country.is/", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.country) {
        return data.country === "CN" ? "zh" : "en";
      }
    }
  } catch {}
  return null;
}

// ── 中文界面标签 → 英文映射（分类名 + 榜单页导航名）──────────────
// 数据源（上游仓库）的分类名是中文，英文界面下需要映射。
// 注意：这些是「界面标签」，不影响 URL slug（/c/ai-tools.html 等保持英文 kebab-case）。
const CATEGORY_I18N = {
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
  "未分类": "Uncategorized",
  // 榜单页面包屑导航名
  "AI 工具精选": "AI Tools Picks",
  "独立游戏精选": "Indie Games",
  "免费工具精选": "Free Tools",
  "开发者工具精选": "Dev Tools",
  "效率工具精选": "Productivity",
  "浏览器扩展精选": "Browser Extensions"
};

// 把中文分类名按当前 locale 渲染；中文 locale 原样返回，未知分类原样返回
export function categoryName(name) {
  if (currentLocale === "zh") return name;
  return CATEGORY_I18N[name] || name;
}
