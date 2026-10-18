#!/usr/bin/env node
/**
 * 百度主动推送脚本 —— 把站点 URL 提交给百度搜索资源平台（ziyuan.baidu.com）的链接提交接口。
 *
 * 用法：
 *   node scripts/baidu-push.mjs              # 推送核心页 + sitemap 里的最新 URL
 *   node scripts/baidu-push.mjs --dry-run    # 只打印不推送
 *   node scripts/baidu-push.mjs --limit 20   # 限制详情页条数（默认 40）
 *   node scripts/baidu-push.mjs --url https://indiemaker.cn/p/xxx.html   # 推送单条
 *
 * 依赖：Node >= 20（内置 fetch）。
 * 前置条件：
 *   1. 在 https://ziyuan.baidu.com 注册并验证站点 indiemaker.cn；
 *   2. 在「搜索服务 → 链接提交 → API 推送」页拿到 token；
 *   3. 配置环境变量 BAIDU_PUSH_TOKEN（GitHub 仓库 Secrets 或本地 shell）。
 *      未配置时脚本直接跳过、退出码 0，不会阻塞 CI。
 *
 * 策略：百度主动推送配额有限（新站每天仅少量普通配额），
 *       优先推「核心页 + 全部分类页 + 最新详情页」，不盲目全量 6900+ 条。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// site 参数必须与站长平台「添加网站」时填写的完全一致（含协议），如 https://indiemaker.cn
const SITE = (process.env.BAIDU_PUSH_SITE || "https://indiemaker.cn").replace(/\/+$/, "");
const TOKEN = process.env.BAIDU_PUSH_TOKEN || "";
// 裸域名（indiemaker.cn），用于拼接待推送的页面 URL 前缀
const SITE_URL = SITE.replace(/^https?:\/\//, "");
// ⚠️ 端点必须用 http:// —— data.zz.baidu.com 不在百度证书 SAN 内（*.baidu.com 不匹配三级域名），
// 走 https 会 TLS 握手失败；百度官方文档与站长平台展示的调用地址也是 http://
const ENDPOINT = `http://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}`;

// 核心页：配额永远先给它们
const CORE_PAGES = [
  `https://${SITE_URL}/`,
  `https://${SITE_URL}/about.html`,
  `https://${SITE_URL}/local-first.html`,
  `https://${SITE_URL}/indie-report.html`,
  `https://${SITE_URL}/weekly.html`,
  `https://${SITE_URL}/en/`,
];

function parseArgs(argv) {
  const opts = { dryRun: false, limit: 40, url: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") opts.limit = parseInt(argv[++i], 10);
    else if (a === "--url") opts.url = argv[++i];
  }
  return opts;
}

function parseSitemap(xml) {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

async function submit(urlList) {
  // 百度接口为纯文本，每行一条 URL
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: urlList.join("\n"),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * 配额自适应提交：百度按天给配额（新站仅 10 条/日），且一批超配额会整批失败（不消耗额度）。
 * 策略：列表按优先级排列（核心页在前），over quota 时把批次减半重试，把当日配额吃满为止。
 */
async function submitAdaptive(urlList) {
  let list = urlList;
  let attempts = 0;
  while (list.length > 0) {
    const { status, text } = await submit(list);
    attempts++;
    if (status === 200) return { status, text, pushed: list.length, attempts };
    if (status === 400 && /over quota/i.test(text) && list.length > 1) {
      const next = list.slice(0, Math.ceil(list.length / 2));
      console.log(`[baidu-push] 当日配额不足（${list.length} 条整批被拒），减半至 ${next.length} 条重试`);
      list = next;
      continue;
    }
    return { status, text, pushed: 0, attempts };
  }
  return { status: 0, text: "empty list", pushed: 0, attempts };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!TOKEN) {
    console.log("[baidu-push] 未配置 BAIDU_PUSH_TOKEN，跳过推送（去 ziyuan.baidu.com 验证站点后获取 token，配置到仓库 Secrets 即可启用）");
    return;
  }

  // 组装推送列表：核心页 + 一级分类页（中英）+ sitemap 最新详情页
  // sitemap 生成时新收录在前；分类页动态提取，避免分类变动后硬编码失效
  let urls;
  if (opts.url) {
    urls = [opts.url];
  } else {
    const xml = await readFile(path.join(ROOT, "sitemap.xml"), "utf8");
    const all = parseSitemap(xml);
    const categoryRoots = all.filter((u) => /\/c\/[^/]+\.html$/.test(u) && !u.includes("/en/"));
    const enCategoryRoots = all.filter((u) => /\/en\/c\/[^/]+\.html$/.test(u));
    // 百度以中文收录为主：中文详情页拿大头，英文详情页取少量
    const zhProducts = all.filter((u) => /indiemaker\.cn\/p\//.test(u)).slice(0, opts.limit);
    const enProducts = all.filter((u) => /indiemaker\.cn\/en\/p\//.test(u)).slice(0, Math.ceil(opts.limit / 4));
    urls = [...CORE_PAGES, ...categoryRoots, ...enCategoryRoots, ...zhProducts, ...enProducts];
    // 去重，且只保留本站 URL
    urls = [...new Set(urls)].filter((u) => u.startsWith(`https://${SITE_URL}/`));
  }

  console.log(`[baidu-push] site=${SITE} 本次推送 ${urls.length} 条`);

  if (opts.dryRun) {
    for (const u of urls) console.log("  [dry-run] " + u);
    console.log("[baidu-push] dry-run 结束，未实际推送。");
    return;
  }

  const { status, text, pushed, attempts } = await submitAdaptive(urls);

  if (status === 200) {
    // 成功响应示例：{"remain":9,"success":6}
    console.log(`[baidu-push] ✅ 推送成功（HTTP ${status}，${attempts} 次尝试实推 ${pushed} 条）：${text}`);
  } else if (status === 401 || status === 403) {
    console.error(`[baidu-push] ❌ HTTP ${status} —— token 无效或站点不匹配，请核对 ziyuan.baidu.com 的 token 与 site 配置：${text}`);
    process.exit(1);
  } else if (status === 402 || (status === 400 && pushed === 0 && attempts > 1)) {
    console.error(`[baidu-push] ❌ 当日推送配额已用完（配额每日刷新），明天再试：${text}`);
    process.exit(1);
  } else {
    console.error(`[baidu-push] ⚠️ HTTP ${status}：${text}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[baidu-push] 失败：", e);
  process.exit(1);
});
