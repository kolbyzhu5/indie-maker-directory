#!/usr/bin/env node
/**
 * Umami 流量取数 + 分析报告（三通道，按优先级自动选择）
 *
 * 通道 1（本项默认，免费版可用）：会话 Cookie 直连仪表盘内部接口
 *   仪表盘的 `/api/websites/<id>/*` 是同域 cookie 鉴权的，返回结构与付费版 API 一致。
 *   从 Node 带 Cookie 请求即可 —— 不需要浏览器、不受 CORS / CSP 限制。
 *   Cookie 存于 ~/.workbuddy/umami-cookie（仓库之外，仓库是 public）
 *   过期时用 scripts/umami-cookie.js 重新提取（有效期约 1 个月）
 *
 * 通道 2：--from <file>  读取离线采集的 JSON（任一通道采集后留档复盘用）
 *
 * 通道 3：官方 API（需 Pro 版 API Key）
 *   Key 来源：env UMAMI_API_KEY 或 ~/.workbuddy/umami-api-key
 *
 * 用法：
 *   node scripts/umami-report.mjs                      # 自动选通道，最近 24 小时
 *   node scripts/umami-report.mjs --hours 168           # 最近 7 天
 *   node scripts/umami-report.mjs --from x.json --json  # 离线分析，只输出 JSON
 *   node scripts/umami-report.mjs --until 2026-10-01T10:00  # 补断档：窗口结束时间钉在指定时刻
 *
 * ⚠️ `--hours N` 的窗口「结束时间」是当前时刻 → 直接跑会覆盖当日日报。
 *    补历史断档必须用 `--until`（文件名按窗口结束日推导），或加 `--json` 只吐 JSON 不写文件。
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const WEBSITE_ID = "6febe922-9c29-4dfc-a426-81d6d8bcdb69";
const BASE = "https://api.umami.is/v1/us"; // 仪表盘在 /us/ 区域，API 必须带区域前缀
const ROOT = path.resolve(import.meta.dirname, "..");
const KEY_FILE = path.join(os.homedir(), ".workbuddy", "umami-api-key");
const COOKIE_FILE = path.join(os.homedir(), ".workbuddy", "umami-cookie");
const TZ = "Asia/Shanghai";

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const JSON_ONLY = hasFlag("--json");
const FROM = valOf("--from", null);
const HOURS = Number(valOf("--hours", 24));
// --until <ISO>：把窗口「结束时间」钉在指定时刻，用于补发生断档的历史日报。
// 默认 null = 用当前时间（不传时行为与旧版完全一致）。报告文件名按 window.endAt 推导，
// 所以 `--until 2026-10-01T10:00` 会生成 docs/umami/2026-10-01.md，且环比自动对齐上一份日报。
const UNTIL_RAW = valOf("--until", null);
const WINDOW_END = (() => {
  if (!UNTIL_RAW) return null;
  const t = new Date(UNTIL_RAW).getTime();
  if (!Number.isFinite(t)) {
    console.error(`⚠️  --until 无法解析（${UNTIL_RAW}），已回退为当前时间`);
    return null;
  }
  if (t > Date.now()) {
    console.error("⚠️  --until 晚于当前时间，已回退为当前时间");
    return null;
  }
  return t;
})();
const METRIC_TYPES = ["path", "entry", "exit", "referrer", "domain", "channel", "country", "browser", "device", "os", "title"];
// 事件/会话通道：用来回答「outbound 比率」与「是否有单会话刷量」，两个问题此前只能靠人工翻接口。
// 注意 /events 有服务端分页上限（实测 pageSize=2000 会被截断），截断时报告里会标注。
const EVENT_LIMIT = 2000;

// ── 通道 A：读取页内采集的 JSON ───────────────────────────
async function payloadFromFile(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  if (raw.error === "NEED_LOGIN") throw new Error("NEED_LOGIN");
  return {
    source: "browser-collected",
    window: raw.window,
    stats: raw.stats,
    pageviews: raw.pageviews,
    metrics: raw.metrics || {}
  };
}

// ── 通道 1：会话 Cookie 直连仪表盘内部接口（免费版首选）──
async function payloadFromCookie() {
  let cookie;
  try {
    cookie = (await readFile(COOKIE_FILE, "utf8")).trim();
  } catch {
    throw new Error("NO_COOKIE");
  }
  if (!cookie) throw new Error("NO_COOKIE");

  const endAt = WINDOW_END || Date.now();
  const startAt = endAt - HOURS * 3600 * 1000;
  const qs = `startAt=${startAt}&endAt=${endAt}`;
  const base = `https://cloud.umami.is/api/websites/${WEBSITE_ID}`;

  const get = async (p) => {
    const res = await fetch(p, {
      headers: { Accept: "application/json", Cookie: cookie }
    });
    if (res.status === 401 || res.status === 403) throw new Error("NEED_LOGIN");
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      // 被重定向到登录页时会返回 HTML
      throw new Error("NEED_LOGIN");
    }
    return res.json();
  };

  const [stats, pageviews, events, sessions, ...ms] = await Promise.all([
    get(`${base}/stats?${qs}&compare=prev`),
    get(`${base}/pageviews?${qs}&unit=hour`),
    get(`${base}/events?${qs}&pageSize=${EVENT_LIMIT}`),
    get(`${base}/sessions?${qs}&pageSize=100`),
    ...METRIC_TYPES.map((t) => get(`${base}/metrics?${qs}&type=${t}&limit=30`))
  ]);
  if (!stats) throw new Error("EMPTY");

  const metrics = {};
  METRIC_TYPES.forEach((t, i) => (metrics[t] = ms[i]));
  return { source: "cookie", window: { startAt, endAt }, stats, pageviews, metrics, events, sessions, eventLimit: EVENT_LIMIT };
}

// ── 通道 3：官方 API（Pro）────────────────────────────────
async function loadKey() {
  if (process.env.UMAMI_API_KEY) return process.env.UMAMI_API_KEY.trim();
  try {
    return (await readFile(KEY_FILE, "utf8")).trim();
  } catch {
    return null;
  }
}

async function request(authName, authValue, p, params = {}) {
  const u = new URL(`${BASE}${p}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { Accept: "application/json", [authName]: authValue } });
  if (res.status === 401 || res.status === 403) {
    const e = new Error("UNAUTHORIZED");
    e.status = res.status;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${p}`);
  return res.json();
}

async function payloadFromApi() {
  const key = await loadKey();
  if (!key) throw new Error("NO_KEY");
  let auth = null;
  for (const [n, v] of [["Authorization", `Bearer ${key}`], ["x-umami-api-key", key]]) {
    try {
      await request(n, v, "/websites");
      auth = [n, v];
      break;
    } catch (e) {
      if (e.message !== "UNAUTHORIZED") throw e;
    }
  }
  if (!auth) throw new Error("BAD_KEY");

  const endAt = WINDOW_END || Date.now();
  const startAt = endAt - HOURS * 3600 * 1000;
  const range = { startAt, endAt, compare: "prev", timezone: TZ };

  const [stats, pageviews, events, sessions, ...ms] = await Promise.all([
    request(...auth, `/websites/${WEBSITE_ID}/stats`, range),
    request(...auth, `/websites/${WEBSITE_ID}/pageviews`, { ...range, unit: "hour" }),
    request(...auth, `/websites/${WEBSITE_ID}/events`, { ...range, pageSize: EVENT_LIMIT }).catch(() => null),
    request(...auth, `/websites/${WEBSITE_ID}/sessions`, { ...range, pageSize: 100 }).catch(() => null),
    ...METRIC_TYPES.map((t) => request(...auth, `/websites/${WEBSITE_ID}/metrics`, { ...range, type: t, limit: 30 }))
  ]);

  const metrics = {};
  METRIC_TYPES.forEach((t, i) => (metrics[t] = ms[i]));
  return { source: "api", window: { startAt, endAt }, stats, pageviews, metrics, events, sessions, eventLimit: EVENT_LIMIT };
}

// ── 分析 ────────────────────────────────────────────────
const isNoisePath = (p = "") => p.includes("/indie-maker-directory-");
const fmtDur = (s) => {
  s = Math.round(s);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const pct = (cur, prev) => (!prev ? (cur ? "new" : "0%") : `${cur >= prev ? "+" : ""}${(((cur - prev) / prev) * 100).toFixed(0)}%`);

// 内部接口返回的是原始 slug（ios / crios / edge-chromium、CN / HK…），直接展示不易读
const BROWSER_LABEL = {
  ios: "iOS（含微信等 App 内嵌）",
  chrome: "Chrome",
  crios: "Chrome (iOS)",
  "chromium-webview": "Chrome (WebView)",
  "edge-chromium": "Edge (Chromium)",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  samsung: "Samsung",
  miui: "MIUI",
  opera: "Opera"
};
const COUNTRY_LABEL = {
  CN: "中国", HK: "中国香港", MO: "中国澳门", TW: "中国台湾",
  US: "美国", SG: "新加坡", JP: "日本", KR: "韩国",
  GB: "英国", DE: "德国", FR: "法国", NL: "荷兰", RU: "俄罗斯",
  CA: "加拿大", BR: "巴西", IN: "印度", AU: "澳大利亚",
  CO: "哥伦比亚", KZ: "哈萨克斯坦", VN: "越南", TH: "泰国", MY: "马来西亚", ID: "印度尼西亚"
};
const DEVICE_LABEL = { mobile: "手机", laptop: "笔记本", desktop: "桌面", tablet: "平板" };
const labeled = (arr, map) => (arr || []).map((r) => ({ ...r, x: map[r.x] || r.x }));

// ── 与上一份日报的窗口重叠检测（2026-09-28 新增）─────────────────────────────
// 为什么加：日报是「当前时刻往前取 24h」，而运行时刻会漂移（… 9/26 10:30 → 9/27 22:27 → 9/28 11:34）
//   → 相邻两份日报的窗口必然重叠，重叠时段里的会话会被两份日报各算一次，
//   表头于是出现**假翻倍**。9/28 实测：本窗口 8 个会话里 6 个与 9/27 日报完全同一批
//   （cardnav×2 / weekly / seichigo / google 1 / chatgpt 1），表头却写着「访客 +100% / 浏览 +643%」。
// 判据：重叠 ≥2 小时即标注「环比不可比」，并给出「本窗口有多少会话在上一份日报里已计过」。
const TZ_OFFSET_HOURS = 8;
function parseLocalStamp(str) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(String(str).trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h - TZ_OFFSET_HOURS, mi, s);
}
async function detectPrevOverlap(curWindow, sessions) {
  const dir = path.join(ROOT, "docs", "umami");
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const reports = [];
  // 同名文件就是本次要写的这份（同一天可能跑多次）→ 必须排除，否则会拿「11:34 那次」当上一份
  const selfStamp = `${new Date(curWindow.endAt).toISOString().slice(0, 10)}.md`;
  for (const f of files) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue;
    if (f === selfStamp) continue;
    let head = "";
    try {
      head = await readFile(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const m = /窗口：([^→]+)→([^\n]+)/.exec(head.slice(0, 1500));
    if (!m) continue;
    const start = parseLocalStamp(m[1]);
    const end = parseLocalStamp(m[2].replace(/（.*$/, ""));
    if (!start || !end) continue;
    // 只保留「早于本次运行」的报告：窗口收尾点必须明显早于本次窗口收尾点
    if (curWindow.endAt - end < 30 * 60 * 1000) continue;
    reports.push({ file: f, start, end });
  }
  if (!reports.length) return null;
  reports.sort((x, y) => y.end - x.end);
  const prev = reports[0];
  const ms = Math.min(prev.end, curWindow.endAt) - Math.max(prev.start, curWindow.startAt);
  // 内部接口有时返回裸数组、有时包一层 { data: [...] }（与 analyze() 里的 asList 同口径）
  const list = Array.isArray(sessions?.data) ? sessions.data : Array.isArray(sessions) ? sessions : [];
  // ⚠️ 坑：/sessions 的 firstAt/lastAt 是 **ISO 字符串**（"2026-09-28T03:35:29Z"），
  //    而 /events 的 createdAt 是**毫秒数** → 直接比较会静默得到 false（2026-09-28 实测：漏判成「0 个重叠」）。
  const at = (v) => (typeof v === "number" ? v : Date.parse(v));
  const covered = list.filter((s) => {
    const f = at(s.firstAt);
    return Number.isFinite(f) && f <= prev.end;
  }).length;
  if (ms <= 0) return { file: prev.file, hours: 0, material: false, sessions: 0, total: list.length };
  const hours = +(ms / 3600000).toFixed(1);
  return { file: prev.file, hours, material: hours >= 2, sessions: covered, total: list.length };
}

function analyze(p) {
  const s = p.stats || {};
  const cmp = s.comparison || {};
  const m = (t) => p.metrics?.[t] || [];

  const bounceRate = s.visits ? (s.bounces / s.visits) * 100 : 0;
  const prevBounce = cmp.visits ? (cmp.bounces / cmp.visits) * 100 : 0;
  const avgDur = s.visits ? s.totaltime / s.visits : 0;
  const prevAvgDur = cmp.visits ? cmp.totaltime / cmp.visits : 0;
  const viewsPerVisit = s.visits ? s.pageviews / s.visits : 0;
  const visitsPerVisitor = s.visitors ? s.visits / s.visitors : 0;

  const pathRows = m("path");
  const noise = pathRows.filter((r) => isNoisePath(r.x));
  const realPaths = pathRows.filter((r) => !isNoisePath(r.x));
  const homeVisitors = (realPaths.find((r) => r.x === "/") || {}).y || 0;
  const homeShare = s.visitors ? (homeVisitors / s.visitors) * 100 : 0;

  // ── 噪音统计的诚实性说明（重要）──
  // path 维度的 y 是「看过该路径的独立访客数」，**把多条路径的 y 相加会重复计数**：
  // 同一访客看了 26 个预览页，会被算成 26 人。所以合计只能当【上限】用。
  // 会话层面的噪音更接近真实：看 entry（进入页）里有多少预览路径。
  const noiseSum = noise.reduce((a, r) => a + r.y, 0);
  const noiseMax = noise.reduce((a, r) => Math.max(a, r.y), 0);
  const noiseEntrySessions = m("entry").filter((r) => isNoisePath(r.x)).reduce((a, r) => a + r.y, 0);
  const noiseShareUpper = s.visitors ? (noiseSum / s.visitors) * 100 : 0;
  const noiseSessionShare = s.visits ? (noiseEntrySessions / s.visits) * 100 : 0;
  const noiseMaterial = noiseSessionShare > 2 || noiseShareUpper > 15;

  // 坑：内部接口返回的渠道名是 camelCase（direct / referral / llm / organicSearch），
  // 若按 "organic search" 去匹配会静默漏掉自然搜索，故先归一化（只留字母）再比。

  const ch = m("channel");
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const chOf = (n) => (ch.find((r) => norm(r.x) === n) || {}).y || 0;
  const organic = chOf("organicsearch") || chOf("organic");
  const llm = chOf("llm");
  const direct = chOf("direct");
  const referral = chOf("referral");

  const ref = m("referrer");
  const bing = ref.filter((r) => /bing\.com/i.test(r.x)).reduce((a, r) => a + r.y, 0);
  const google = ref.filter((r) => /google\./i.test(r.x)).reduce((a, r) => a + r.y, 0);

  const country = m("country");
  const total = country.reduce((a, r) => a + r.y, 0);
  const overseas = country.filter((r) => !/^(CN|China)$/i.test(r.x)).reduce((a, r) => a + r.y, 0);

  // ── 事件 / 会话口径（2026-09-23 新增）─────────────────────────
  // 为什么加：9/22 上线 outbound 埋点后，「outbound 比率是多少」和「pageview 是否被单个
  // 自测/自动化会话刷高」这两件事只能靠人工翻内部接口回答，日报里看不到。
  // 现在固化进日报：① outbound 总量 + 剔除最大会话后的干净量 ② 会话级 TOP（抓单会话刷量）
  // ③ 同会话同 URL 同秒重复上报（pageview 是否被交互重复计数）。
  const asList = (v) => (Array.isArray(v?.data) ? v.data : Array.isArray(v) ? v : []);
  const evList = asList(p.events);
  const sessList = asList(p.sessions);

  const outboundEv = evList.filter((e) => e.eventName === "outbound");
  const obBySession = {};
  outboundEv.forEach((e) => (obBySession[e.sessionId] = (obBySession[e.sessionId] || 0) + 1));
  const obRanked = Object.entries(obBySession).sort((a, b) => b[1] - a[1]);
  const obTop = obRanked[0] || null;
  const obTopN = obTop ? obTop[1] : 0;
  const obClean = outboundEv.length - obTopN;
  // 干净口径的分母：剔除「最大 outbound 会话」对应的那 1 次访问
  const visitsClean = Math.max(s.visits - (obTop ? 1 : 0), 1);
  // 长窗口（如 7 天）会混入历史噪音，访问/访客 严重偏离正常时该比率没有意义，宁可不给数
  const ratioUsable = visitsPerVisitor <= 2.5;

  const topSessions = sessList.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
  const domSession = topSessions[0] || null;
  const domShare = s.pageviews && domSession ? (domSession.views / s.pageviews) * 100 : 0;

  const secMap = {};
  evList
    .filter((e) => String(e.eventType) === "1")
    .forEach((e) => {
      const k = e.sessionId + "|" + e.urlPath + "|" + e.createdAt;
      secMap[k] = (secMap[k] || 0) + 1;
    });
  const dupValues = Object.values(secMap);
  const dupGroups = dupValues.filter((n) => n > 1).length;
  const dupExtra = dupValues.reduce((a, n) => a + (n > 1 ? n - 1 : 0), 0);

  // ── 并发会话爆发检测（2026-09-25 新增）──────────────────────
  // 为什么加：9/25 出现「单会话刷量」的镜像案例——4 秒内冒出 9 个独立会话，同质
  // （CN · iOS · 移动端）、全部落 `/`、无来源、多数无城市级地理，占当日访客 56%。
  // 机制：Umami 只认 cookie 里的 sessionId，无共享状态的并行请求每次都新建 session，
  // 于是「并发抓取 / 批量打开链接」在报表里表现为【访客数暴涨】，而不是【浏览数暴涨】。
  // 原告警只盯「单会话占 pageview >50%」，对这种反向噪音完全盲 —— 故补上。
  const BURST_WINDOW_MS = 5000;
  const BURST_MIN_SESSIONS = 4;
  const pvEvents = evList
    .filter((e) => String(e.eventType) === "1")
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const viewsBySession = {};
  pvEvents.forEach((e) => (viewsBySession[e.sessionId] = (viewsBySession[e.sessionId] || 0) + 1));

  const burstSessions = new Set();
  const burstClusters = [];
  for (let i = 0; i < pvEvents.length; i++) {
    const t0 = new Date(pvEvents[i].createdAt).getTime();
    const win = pvEvents.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= t0 && t < t0 + BURST_WINDOW_MS;
    });
    const ids = [...new Set(win.map((e) => e.sessionId))];
    const fresh = ids.filter((id) => !burstSessions.has(id));
    // 只在「本窗口带来了 ≥4 个全新会话」时开启新簇，避免同一簇被反复计入
    if (fresh.length >= BURST_MIN_SESSIONS) {
      const meta = fresh.map((id) => sessList.find((x) => x.id === id)).filter(Boolean);
      burstClusters.push({
        at: pvEvents[i].createdAt,
        sessions: fresh.length,
        events: win.filter((e) => fresh.includes(e.sessionId)).length,
        countries: [...new Set(meta.map((x) => COUNTRY_LABEL[x.country] || x.country))],
        devices: [...new Set(meta.map((x) => DEVICE_LABEL[x.device] || x.device))],
        noCity: meta.filter((x) => !x.city).length,
        noCityTotal: meta.length,
        paths: [...new Set(win.filter((e) => fresh.includes(e.sessionId)).map((e) => e.urlPath))].slice(0, 3)
      });
      fresh.forEach((id) => burstSessions.add(id));
    }
  }
  const burstVisitors = burstSessions.size;
  const burstViews = [...burstSessions].reduce((a, id) => a + (viewsBySession[id] || 0), 0);
  const burstVisits = burstVisitors; // 每个爆发簇会话在实测中均为 1 次访问
  const burstShare = s.visitors ? (burstVisitors / s.visitors) * 100 : 0;
  const burst = {
    detected: burstVisitors >= BURST_MIN_SESSIONS,
    clusters: burstClusters.length,
    visitors: burstVisitors,
    visits: burstVisits,
    views: burstViews,
    share: +burstShare.toFixed(1),
    windowSeconds: BURST_WINDOW_MS / 1000,
    minSessions: BURST_MIN_SESSIONS,
    detail: burstClusters,
    clean: {
      visitors: Math.max(s.visitors - burstVisitors, 0),
      visits: Math.max(s.visits - burstVisits, 0),
      pageviews: Math.max(s.pageviews - burstViews, 0)
    }
  };

  const events = {
    available: evList.length > 0,
    truncated: p.eventLimit ? evList.length >= p.eventLimit : false,
    total: evList.length,
    langSwitch: evList.filter((e) => e.eventName === "lang-switch").length,
    outbound: {
      count: outboundEv.length,
      sessions: obRanked.length,
      topCount: obTopN,
      topSession: obTop ? obTop[0] : null,
      clean: obClean,
      ratioUsable,
      cleanRatio: ratioUsable ? +((obClean / visitsClean) * 100).toFixed(0) : null
    },
    dominated: domSession
      ? {
          share: +domShare.toFixed(0),
          views: domSession.views,
          visits: domSession.visits,
          country: COUNTRY_LABEL[domSession.country] || domSession.country,
          os: domSession.os,
          browser: BROWSER_LABEL[domSession.browser] || domSession.browser,
          firstAt: domSession.firstAt
        }
      : null,
    topSessions: topSessions.map((x) => ({
      views: x.views,
      visits: x.visits,
      country: COUNTRY_LABEL[x.country] || x.country,
      os: x.os,
      device: DEVICE_LABEL[x.device] || x.device
    })),
    burst,
    dup: { groups: dupGroups, extra: dupExtra }
  };

  const flags = [];
  const note = (lv, t) => flags.push({ lv, t });
  const sampleSmall = s.visitors < 20;

  if (sampleSmall) note("warn", `样本过小（访客 ${s.visitors}），百分比变化不足以判断趋势`);

  // 噪音：会话口径（进入页）比路径求和更接近真实，优先用它说事
  if (noiseMaterial) {
    note(
      "warn",
      `预览路径噪音：${noise.length} 条路径命中排行，其中 ${noiseEntrySessions} 次会话从预览页进入（占访问 ${noiseSessionShare.toFixed(1)}%）；` +
        `各路径访客合计 ${noiseSum}（此为上限，同一访客访问多个预览页会重复计数）`
    );
    note("warn", "噪音超阈值：下列页面占比与首页占比的读数会被稀释，先看会话口径再下结论");
  } else if (noise.paths > 0) {
    note("good", `预览路径仅 ${noise.paths} 条残留（会话口径 ${noiseEntrySessions} 次），噪音已可控`);
  } else {
    note("good", "无预览路径噪音（追踪守卫生效）");
  }

  if (visitsPerVisitor > 2.5) note("warn", `访问/访客 = ${visitsPerVisitor.toFixed(2)}（正常 1–2.5）—— 提示存在自动化流量`);
  else if (visitsPerVisitor > 0) note("good", `访问/访客 = ${visitsPerVisitor.toFixed(2)} —— 正常`);

  if (viewsPerVisit && viewsPerVisit < 2) note("warn", `浏览/访问 = ${viewsPerVisit.toFixed(2)}（正常 2–4）—— 单页即走比例高`);
  else if (viewsPerVisit > 4.5) note("warn", `浏览/访问 = ${viewsPerVisit.toFixed(2)}（正常 2–4）—— 偏高`);

  if (bounceRate > 60) note("warn", `跳出率 ${bounceRate.toFixed(0)}% 偏高（>60%）`);
  else if (bounceRate > 0 && bounceRate < 50) note("good", `跳出率 ${bounceRate.toFixed(0)}% —— 健康`);

  // 首页占比：噪音偏高时不作正面结论，避免「噪音把首页占比冲低」被误读成内页有承接
  if (homeShare > 60) note("warn", `首页占 ${homeShare.toFixed(0)}% —— 流量堵在首页，内页动线是短板`);
  else if (homeShare > 0 && !noiseMaterial) note("good", `首页占 ${homeShare.toFixed(0)}% —— 内页有承接`);
  else if (homeShare > 0) note("warn", `首页占 ${homeShare.toFixed(0)}%（噪音偏高，该读数不可直接采信）`);

  if (organic > 0) note("good", `自然搜索 ${organic} 人${bing ? `，其中 Bing 系 ${bing} 人` : ""}`);
  if (llm > 0) note("good", `AI 引用（LLM 渠道）${llm} 人`);

  // 单个会话把整窗口的 pageview 抬起来 = 自测 / 自动化嫌疑，此时浏览/访问、停留时长都不可用
  if (domSession && domShare > 50) {
    note(
      "warn",
      `单会话刷量：会话 ${String(domSession.id).slice(0, 8)}…（${COUNTRY_LABEL[domSession.country] || domSession.country} · ${domSession.os}）= ${domSession.views} 次浏览，占全窗口 pageview 的 ${domShare.toFixed(0)}%` +
        `→ 浏览/访问、平均停留、浏览总量本窗口不可用`
    );
  }
  if (events.available && events.outbound.clean > 0) {
    note(
      "good",
      `外链点击（outbound）${events.outbound.count} 次，分布在 ${events.outbound.sessions} 个会话` +
        (events.outbound.topCount
          ? `；剔除最大会话（${events.outbound.topCount} 次）后干净量 ${events.outbound.clean} 次` +
            (events.outbound.ratioUsable ? ` ≈ 访问的 ${events.outbound.cleanRatio}%` : "（本窗口访问/访客偏离正常，比率不作数）")
          : "")
    );
  }

  // 并发爆发：与「单会话刷量」相反，它抬高的是访客/访问数而非浏览数
  if (events.burst.detected) {
    note(
      "warn",
      `并发会话爆发：${events.burst.clusters} 簇 / ${events.burst.visitors} 个会话在 ${events.burst.windowSeconds} 秒窗口内并发` +
        `（占访客 ${events.burst.share}%）→ 访客/访问数被自动化流量抬高；` +
        `剔除后访客 ${events.burst.clean.visitors} / 访问 ${events.burst.clean.visits} / 浏览 ${events.burst.clean.pageviews}`
    );
  }

  return {
    source: p.source,
    window: p.window,
    totals: { ...s, bounceRate: +bounceRate.toFixed(1), avgDuration: Math.round(avgDur), prevBounce: +prevBounce.toFixed(1), prevAvgDuration: Math.round(prevAvgDur) },
    derived: { viewsPerVisit: +viewsPerVisit.toFixed(2), visitsPerVisitor: +visitsPerVisitor.toFixed(2) },
    noise: {
      paths: noise.length,
      sumUpper: noiseSum,
      maxSingle: noiseMax,
      shareUpper: +noiseShareUpper.toFixed(1),
      entrySessions: noiseEntrySessions,
      sessionShare: +noiseSessionShare.toFixed(1),
      material: noiseMaterial,
      list: noise
    },
    home: { visitors: homeVisitors, share: +homeShare.toFixed(1) },
    channels: { direct, referral, organic, llm },
    referrers: { bing, google, top: ref.slice(0, 8) },
    events,
    overseas: { visitors: overseas, share: total ? +((overseas / total) * 100).toFixed(0) : 0 },
    hourly: (p.pageviews?.pageviews || []).map((r) => ({ t: r.x, v: r.y })),
    top: { paths: realPaths.slice(0, 15), entry: m("entry").slice(0, 8), exit: m("exit").slice(0, 8), country: country.slice(0, 12), browser: m("browser").slice(0, 8), device: m("device"), os: m("os").slice(0, 8) },
    flags,
    sampleSmall
  };
}

// ── 报告 ────────────────────────────────────────────────
const tbl = (arr, n = 10) => (arr && arr.length ? arr.slice(0, n).map((r) => `| ${r.x} | ${r.y} |`).join("\n") : "| （无数据） | 0 |");

function buildMarkdown(a) {
  const t = a.totals;
  const c = t.comparison || {};
  const end = new Date(a.window.endAt);
  const start = new Date(a.window.startAt);
  const local = (d) => d.toLocaleString("zh-CN", { timeZone: TZ });

  return `# Umami 流量日报 · ${end.toLocaleDateString("zh-CN", { timeZone: TZ })}

> 窗口：${local(start)} → ${local(end)}（北京时间）
> 取数方式：${a.source === "api" ? "Umami Cloud API（Pro）" : a.source === "cookie" ? "仪表盘内部接口（会话 Cookie，免费版）" : "离线采集文件"}
> 生成时间：${new Date().toLocaleString("zh-CN", { timeZone: TZ })}

## 一、总览（含环比）

${a.overlap?.material ? `> ⚠️ **环比可比性**：上一份日报（\`docs/umami/${a.overlap.file}\`）的窗口与本窗口重叠 **${a.overlap.hours} 小时**${a.overlap.total ? `，本窗口 ${a.overlap.total} 个会话里 **${a.overlap.sessions} 个**在上一份日报中已计过一次` : ""} → **下表「变化」列不可用**，只比较绝对值。\n` : ""}
| 指标 | 本窗口 | 上一窗口 | 变化 |
|---|---|---|---|
| 访客 Visitors | **${t.visitors}** | ${c.visitors ?? "-"} | ${pct(t.visitors, c.visitors)} |
| 访问 Visits | **${t.visits}** | ${c.visits ?? "-"} | ${pct(t.visits, c.visits)} |
| 浏览 Pageviews | **${t.pageviews}** | ${c.pageviews ?? "-"} | ${pct(t.pageviews, c.pageviews)} |
| 跳出率 | **${t.bounceRate}%** | ${t.prevBounce}% | ${t.bounceRate >= t.prevBounce ? "↑恶化" : "↓改善"} |
| 平均停留 | **${fmtDur(t.avgDuration)}** | ${fmtDur(t.prevAvgDuration)} | ${pct(t.avgDuration, t.prevAvgDuration)} |

**派生比值**（判断数据可信度）：
- 浏览/访问 = **${a.derived.viewsPerVisit}**（正常 2–4）
- 访问/访客 = **${a.derived.visitsPerVisitor}**（正常 1–2.5）

## 二、自动判读

${a.flags.map((f) => `- ${f.lv === "good" ? "✅" : "⚠️"} ${f.t}`).join("\n") || "- （无异常）"}

## 三、流量落点

首页访客 **${a.home.visitors}** 人，占总访客 **${a.home.share}%**${a.noise.material ? "（⚠️ 本窗口噪音偏高，该占比被稀释，宜看会话口径）" : ""}

### 真实页面（已剔除预览路径）

| 路径 | 访客 |
|---|---|
${tbl(a.top.paths, 15)}

### 预览路径噪音

- 命中排行的预览路径：**${a.noise.paths} 条**
- 从预览页进入的会话：**${a.noise.entrySessions} 次**（占访问 ${a.noise.sessionShare}%）← 会话口径，更接近真实
- 各路径访客合计：${a.noise.sumUpper}（占访客 ${a.noise.shareUpper}%）← **上限值**，同一访客访问多个预览页会重复计数
- 单条路径最高：${a.noise.maxSingle} 人

${a.noise.paths ? a.noise.list.slice(0, 8).map((r) => `- \`${r.x}\` — ${r.y} 人`).join("\n") : "- 无（守卫生效）"}

## 四、来源

### 渠道

| 渠道 | 访客 |
|---|---|
| Direct | ${a.channels.direct} |
| Referral | ${a.channels.referral} |
| Organic search | ${a.channels.organic} |
| LLM | ${a.channels.llm} |

### 来源站点（Bing 系合计 ${a.referrers.bing}，Google 系 ${a.referrers.google}）

| 来源 | 访客 |
|---|---|
${tbl(a.referrers.top, 8)}

## 五、地域与设备

海外访客 **${a.overseas.visitors} 人（${a.overseas.share}%）**

| 国家/地区 | 访客 |
|---|---|
${tbl(labeled(a.top.country, COUNTRY_LABEL), 12)}

| 浏览器 | 访客 |
|---|---|
${tbl(labeled(a.top.browser, BROWSER_LABEL), 8)}

| 设备 | 访客 |
|---|---|
${tbl(labeled(a.top.device, DEVICE_LABEL), 6)}

## 六、进入页 / 离开页

| 进入页 | 访客 |
|---|---|
${tbl(a.top.entry, 8)}

| 离开页 | 访客 |
|---|---|
${tbl(a.top.exit, 8)}

## 七、事件与会话口径

${buildEventsSection(a)}

---
*由 \`scripts/umami-report.mjs\` 自动生成 · 只写本地，不入库（避免触发部署）*
`;
}

function buildEventsSection(a) {
  const e = a.events;
  if (!e || !e.available) {
    return "- （事件接口无数据：可能未埋点，或本窗口确实没有事件）";
  }
  const ob = e.outbound;
  const lines = [];
  lines.push(`**自定义事件**：共 ${e.total} 条${e.truncated ? "（⚠️ 已达接口分页上限，实际更多）" : ""}，其中 outbound **${ob.count}** 次、lang-switch **${e.langSwitch}** 次`);
  lines.push("");
  lines.push("### 外链点击（outbound）");
  lines.push("");
  lines.push(`- 总次数 **${ob.count}**，分布在 **${ob.sessions}** 个会话`);
  if (ob.topCount) {
    lines.push(
      `- 最大会话 ${String(ob.topSession).slice(0, 8)}… 占 **${ob.topCount}** 次` +
        ` → 剔除后干净量 **${ob.clean}** 次` +
        (ob.ratioUsable ? ` ≈ 访问的 **${ob.cleanRatio}%**` : "（本窗口访问/访客偏离正常，比率不作数）")
    );
    lines.push(
      `- 判读：干净比率 **>40% → 跳出以「达成离开」为主**（目录站正常）；**<15% → 内页动线有问题**。样本 <50 次访问时只作参考`
    );
  } else {
    lines.push("- 本窗口没有 outbound 事件");
  }
  if (e.dominated && e.dominated.share >= 30) {
    lines.push("");
    lines.push("### ⚠️ 单会话刷量嫌疑");
    lines.push("");
    lines.push(
      `- 最大会话（${e.dominated.country} · ${e.dominated.browser} / ${e.dominated.os}）**${e.dominated.views}** 次浏览 / ${e.dominated.visits} 次访问，` +
        `占全窗口 pageview 的 **${e.dominated.share}%**`
    );
    lines.push(`- 开始时间：${new Date(e.dominated.firstAt).toLocaleString("zh-CN", { timeZone: TZ })}`);
    lines.push("- → 该会话为自测/自动化时，**浏览/访问、平均停留、pageview 总量本窗口均不可用**");
  }
  lines.push("");
  lines.push("### 会话 TOP5（按浏览数）");
  lines.push("");
  lines.push("| 浏览 | 访问 | 地区 | 系统 | 设备 |");
  lines.push("|---|---|---|---|---|");
  lines.push(e.topSessions.length ? e.topSessions.map((s) => `| ${s.views} | ${s.visits} | ${s.country} | ${s.os} | ${s.device} |`).join("\n") : "| （无数据） | | | | |");

  const b = e.burst;
  if (b && b.detected) {
    lines.push("");
    lines.push("### ⚠️ 并发会话爆发（访客数虚增）");
    lines.push("");
    lines.push(
      `- **${b.clusters} 簇 / ${b.visitors} 个独立会话**在 **${b.windowSeconds} 秒**窗口内并发出现，` +
        `占本窗口访客的 **${b.share}%**（判据：${b.windowSeconds} 秒内 ≥${b.minSessions} 个全新 sessionId）`
    );
    for (const c of b.detail.slice(0, 5)) {
      lines.push(
        `  - ${new Date(c.at).toLocaleString("zh-CN", { timeZone: TZ })} ｜ ${c.sessions} 会话 / ${c.events} 次浏览` +
          ` ｜ ${c.countries.join("/")} · ${c.devices.join("/")}` +
          ` ｜ 无城市级地理 ${c.noCity}/${c.noCityTotal}` +
          ` ｜ 落点 ${c.paths.join(" ")}`
      );
    }
    lines.push(
      `- **剔除爆发簇后**：访客 **${b.clean.visitors}** / 访问 **${b.clean.visits}** / 浏览 **${b.clean.pageviews}**`
    );
    lines.push(
      "- 机制：Umami 只认 cookie 里的 sessionId，**无共享状态的并行请求每次都会新建 session** →" +
        " 并发抓取/批量打开在报表里表现为「访客数暴涨」而非「浏览数暴涨」。（2026-09-25 新增，此前对该形态完全盲）"
    );
    lines.push("- → 本窗口的访客/访问数不可直接当真人量级；请以上面的「剔除后」三行为准");
  }
  if (e.dup.extra > 0) {
    lines.push("");
    lines.push("### 同秒重复上报");
    lines.push("");
    lines.push(`- 同会话 + 同 URL + 同秒出现多次 pageview：**${e.dup.groups} 组，多出 ${e.dup.extra} 条**`);
    lines.push("- 已知成因：`app.js` 的 `syncURL()` 每次筛选/搜索都会 `history.replaceState()`，");
    lines.push("  而 Umami 官方脚本对 `pushState`/`replaceState` 挂钩并上报 pageview（URL 变化即记 1 次）");
    lines.push("- → 首页一次筛选操作会被记成多次浏览；这是**口径问题，不是站点故障**");
  }
  return lines.join("\n");
}

// ── 主流程 ───────────────────────────────────────────────
let payload;
try {
  if (FROM) {
    payload = await payloadFromFile(FROM);
  } else {
    // 优先级：会话 Cookie（免费版）→ 官方 API（Pro）
    try {
      payload = await payloadFromCookie();
    } catch (e) {
      if (e.message !== "NO_COOKIE") throw e;
      payload = await payloadFromApi();
    }
  }
} catch (e) {
  if (e.message === "NEED_LOGIN") {
    console.error(
      [
        "Umami 登录态已失效（cookie 过期或被登出）。",
        "",
        "恢复方式：",
        "  1) 用采集时那个浏览器 profile 打开 https://cloud.umami.is 并登录",
        "  2) 执行 scripts/umami-cookie.js 的内容，拿到新的 cookieHeader",
        "  3) printf '%s' '<cookieHeader>' > ~/.workbuddy/umami-cookie && chmod 600 ~/.workbuddy/umami-cookie"
      ].join("\n")
    );
    process.exit(4);
  }
  if (e.message === "EMPTY") {
    console.error("接口返回空数据：确认账号对该站点有权限，或窗口内确实没有访问。");
    process.exit(5);
  }
  if (e.message === "NO_KEY") {
    console.error(
      [
        "既没有会话 Cookie（~/.workbuddy/umami-cookie），也没有 API Key。",
        "",
        "· 免费版：用 scripts/umami-cookie.js 提取一次会话 cookie（有效期约 1 个月）",
        "· Pro 版：把 API Key 写入 ~/.workbuddy/umami-api-key"
      ].join("\n")
    );
    process.exit(2);
  }
  console.error("取数失败：" + e.message);
  process.exit(3);
}

const a = analyze(payload);
a.overlap = await detectPrevOverlap(a.window, payload.sessions);
if (a.overlap?.material) {
  a.flags.unshift({
    lv: "warn",
    t:
      `环比不可比：上一份日报 \`docs/umami/${a.overlap.file}\` 的窗口与本窗口重叠 **${a.overlap.hours} 小时**` +
      (a.overlap.total
        ? `；本窗口 ${a.overlap.total} 个会话里有 **${a.overlap.sessions} 个**在上一份日报中已经计过`
        : "") +
      ` → 「访客 / 浏览」的百分比变化是**重叠伪影**，只看绝对值，不看环比`
  });
}

if (JSON_ONLY) {
  console.log(JSON.stringify(a, null, 2));
  process.exit(0);
}

const outDir = path.join(ROOT, "docs", "umami");
await mkdir(outDir, { recursive: true });
const stamp = new Date(a.window.endAt).toISOString().slice(0, 10);
const outFile = path.join(outDir, `${stamp}.md`);
await writeFile(outFile, buildMarkdown(a), "utf8");

console.log(`✅ 报告已生成：${outFile}`);
console.log(`窗口：${new Date(a.window.startAt).toLocaleString("zh-CN", { timeZone: TZ })} → ${new Date(a.window.endAt).toLocaleString("zh-CN", { timeZone: TZ })}`);
console.log(`访客 ${a.totals.visitors}（${pct(a.totals.visitors, (a.totals.comparison || {}).visitors)}）｜访问 ${a.totals.visits}｜浏览 ${a.totals.pageviews}`);
console.log(`跳出率 ${a.totals.bounceRate}%｜平均停留 ${fmtDur(a.totals.avgDuration)}｜浏览/访问 ${a.derived.viewsPerVisit}｜访问/访客 ${a.derived.visitsPerVisitor}`);
console.log(`首页占比 ${a.home.share}%｜预览噪音：${a.noise.paths} 条路径 / 会话口径 ${a.noise.entrySessions} 次（${a.noise.sessionShare}%）${a.noise.material ? " ⚠️ 超阈值" : ""}`);
console.log(`渠道：Direct ${a.channels.direct} / Referral ${a.channels.referral} / Organic ${a.channels.organic} / LLM ${a.channels.llm}`);
console.log(`Bing 系 ${a.referrers.bing}｜海外 ${a.overseas.visitors} 人（${a.overseas.share}%）`);
if (a.overlap?.material) {
  console.log(
    `⚠️ 环比不可比：与上一份日报（${a.overlap.file}）窗口重叠 ${a.overlap.hours}h` +
      (a.overlap.total ? `，本窗口 ${a.overlap.total} 个会话里 ${a.overlap.sessions} 个已在前一份计过` : "") +
      ` → 不看百分比，只看绝对值`
  );
}
if (a.events?.available) {
  const ob = a.events.outbound;
  console.log(
    `outbound ${ob.count} 次 / ${ob.sessions} 会话（剔除最大会话后 ${ob.clean} 次${ob.ratioUsable ? ` ≈ 访问 ${ob.cleanRatio}%` : "，比率不可用"}）｜lang-switch ${a.events.langSwitch}`
  );
  if (a.events.dominated && a.events.dominated.share >= 30) {
    console.log(
      `⚠️ 单会话占 pageview ${a.events.dominated.share}%（${a.events.dominated.country} · ${a.events.dominated.os}）→ 浏览/停留口径不可用`
    );
  }
  const b = a.events.burst;
  if (b && b.detected) {
    console.log(
      `⚠️ 并发爆发：${b.clusters} 簇 / ${b.visitors} 会话在 ${b.windowSeconds}s 内并发（占访客 ${b.share}%）→ ` +
        `剔除后 访客 ${b.clean.visitors} / 访问 ${b.clean.visits} / 浏览 ${b.clean.pageviews}`
    );
  }
}
