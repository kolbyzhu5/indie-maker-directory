// i18n 模块：双语字典 + 智能默认 + 切换
// 数据（产品名/介绍）不在字典中，由源仓库提供，保持原样。

export const LOCALES = {
  zh: {
    code: "zh",
    // lang 切换按钮显示：点击切到英文时显示 "EN"
    langToggleLabel: "EN",
    // brand
    brandTitle: "独立制造所",
    brandSubtitle: "中国独立开发者产品志",
    // nav
    navBrowse: "逛产品",
    // hero
    heroEyebrow: "每日从 GitHub 自动整理",
    heroTitle1: "好产品，",
    heroTitleEm: "不该埋在",
    heroTitle2: "几千行 README 里。",
    heroDesc: "把中国独立开发者的作品做成真正好逛、好搜、好发现的产品导航。没有竞价排名，只有创造本身。",
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
    footerSlogan: "独立制造所 · 让认真做出来的东西被看见",
    footerFeedback: "反馈建议",
    // a11y
    a11yHome: "独立制造所首页",
    a11ySearch: "搜索产品、开发者或介绍",
    a11yFilters: "筛选条件",
    a11yResults: "产品列表",
    a11yClearSearch: "清空搜索",
    a11yQuickTags: "热门分类",
    a11yLangToggle: "切换语言"
  },
  en: {
    code: "en",
    // lang 切换按钮显示：点击切到中文时显示 "中"
    langToggleLabel: "中",
    brandTitle: "Indie Maker",
    brandSubtitle: "Directory of Chinese indie developer products",
    navBrowse: "Browse",
    heroEyebrow: "Curated daily from GitHub",
    heroTitle1: "Great products, ",
    heroTitleEm: "shouldn't be buried",
    heroTitle2: "in thousands of lines of README.",
    heroDesc: "A truly browsable, searchable, discoverable directory of Chinese indie developer products. No paid rankings — just the work itself.",
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
    footerFeedback: "Feedback",
    a11yHome: "Indie Maker home",
    a11ySearch: "Search products, makers or descriptions",
    a11yFilters: "Filters",
    a11yResults: "Product list",
    a11yClearSearch: "Clear search",
    a11yQuickTags: "Popular categories",
    a11yLangToggle: "Toggle language"
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
  cardVisit: () => (currentLocale === "zh" ? "去看看 ↗" : "Visit ↗")
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
