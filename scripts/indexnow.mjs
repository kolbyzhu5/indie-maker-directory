#!/usr/bin/env node
/**
 * IndexNow 推送脚本 —— 把站点 URL 批量提交给 Bing / Yandex 等搜索引擎，实现即时收录。
 *
 * 用法：
 *   node scripts/indexnow.mjs              # 推送 sitemap.xml 里的全部 URL
 *   node scripts/indexnow.mjs --dry-run    # 只打印不推送
 *   node scripts/indexnow.mjs --limit 10   # 只推前 10 条（测试用）
 *   node scripts/indexnow.mjs --url https://indiemaker.cn/xxx.html   # 推送单条
 *
 * 依赖：Node >= 20（内置 fetch）。
 * 说明：key 验证文件 9082f4b3a3a9450894ffdb0861c74a65.txt 必须已部署到站点根目录，
 *       否则 IndexNow 返回 403。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const HOST = "indiemaker.cn";
const KEY = "9082f4b3a3a9450894ffdb0861c74a65";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

function parseArgs(argv) {
  const opts = { dryRun: false, limit: Infinity, url: null };
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
  const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 确定要推送的 URL 列表
  let urls;
  if (opts.url) {
    urls = [opts.url];
  } else {
    const xml = await readFile(path.join(ROOT, "sitemap.xml"), "utf8");
    urls = parseSitemap(xml);
  }
  const total = urls.length;
  const toPush = urls.slice(0, opts.limit);

  console.log(`[indexnow] host=${HOST} key=${KEY}`);
  console.log(`[indexnow] sitemap 共 ${total} 条 URL，本次推送 ${toPush.length} 条`);

  if (opts.dryRun) {
    for (const u of toPush) console.log("  [dry-run] " + u);
    console.log(`[indexnow] dry-run 结束，未实际推送。`);
    return;
  }

  // IndexNow 单次上限 10000 条，这里全量一次性提交即可（当前 2341 条）
  const { status, text } = await submit(toPush);

  if (status === 200 || status === 202) {
    console.log(`[indexnow] ✅ 推送成功（HTTP ${status}），已提交 ${toPush.length} 条 URL。`);
  } else if (status === 403) {
    console.error(`[indexnow] ❌ HTTP 403 —— key 未通过验证。请确认 ${KEY_LOCATION} 已上线且返回 "${KEY}"。`);
    process.exit(1);
  } else if (status === 422) {
    console.error(`[indexnow] ❌ HTTP 422 —— 请求参数错误：${text}`);
    process.exit(1);
  } else if (status === 429) {
    console.error(`[indexnow] ❌ HTTP 429 —— 触发速率限制，稍后重试。`);
    process.exit(1);
  } else {
    console.error(`[indexnow] ⚠️ 未知响应 HTTP ${status}：${text}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[indexnow] 失败：", e);
  process.exit(1);
});
