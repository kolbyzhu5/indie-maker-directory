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
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const METRIC_TYPES = ["path", "entry", "exit", "referrer", "domain", "channel", "country", "browser", "device", "os", "title"];

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

  const endAt = Date.now();
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

  const [stats, pageviews, ...ms] = await Promise.all([
    get(`${base}/stats?${qs}&compare=prev`),
    get(`${base}/pageviews?${qs}&unit=hour`),
    ...METRIC_TYPES.map((t) => get(`${base}/metrics?${qs}&type=${t}&limit=30`))
  ]);
  if (!stats) throw new Error("EMPTY");

  const metrics = {};
  METRIC_TYPES.forEach((t, i) => (metrics[t] = ms[i]));
  return { source: "cookie", window: { startAt, endAt }, stats, pageviews, metrics };
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

  const endAt = Date.now();
  const startAt = endAt - HOURS * 3600 * 1000;
  const range = { startAt, endAt, compare: "prev", timezone: TZ };

  const [stats, pageviews, ...ms] = await Promise.all([
    request(...auth, `/websites/${WEBSITE_ID}/stats`, range),
    request(...auth, `/websites/${WEBSITE_ID}/pageviews`, { ...range, unit: "hour" }),
    ...METRIC_TYPES.map((t) => request(...auth, `/websites/${WEBSITE_ID}/metrics`, { ...range, type: t, limit: 30 }))
  ]);

  const metrics = {};
  METRIC_TYPES.forEach((t, i) => (metrics[t] = ms[i]));
  return { source: "api", window: { startAt, endAt }, stats, pageviews, metrics };
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

---
*由 \`scripts/umami-report.mjs\` 自动生成 · 只写本地，不入库（避免触发部署）*
`;
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
