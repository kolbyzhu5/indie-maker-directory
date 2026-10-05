#!/usr/bin/env node
// ── 产品描述英文化（阶段 0：数据层）────────────────────────────────
// 用途：为英文镜像页（en/p/、en/c/）准备英文描述数据。
// 原则：
//   · 中文原文一字不动 —— 翻译结果写独立映射文件 data/descriptions-en.json，
//     绝不改 data/projects.json（CI 每日同步会重写它，加字段会丢）。
//   · 产品名不翻译（66% 本身就是英文；中文名是专有名词）。
//   · 引擎：Google 翻译公开接口（无 key）。描述中位数 37 字符，短句质量足够。
//     ⚠️ 主机选择（2026-10-05 实测）：translate.googleapis.com 与 translate.google.com
//     会被 IP 级 429 限流（限流按主机，数小时才解封）；clients5.google.com 独立限额，
//     且 /translate_a/t?client=dict-chrome-ex 支持**一条请求多个 q 批量翻译**（按序返回）。
//     限流时优先换主机而不是傻等。
// 断点续传：已翻译的 id 跳过；每 50 条 flush 一次进度。
// 用法：
//   node scripts/translate.mjs            # 全量（自动跳过已完成）
//   node scripts/translate.mjs --limit 20 # 抽样试跑
//   node scripts/translate.mjs --force    # 忽略缓存全部重翻
//   node scripts/translate.mjs --sample 5 # 抽 5 条打印对照（不写文件）
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "data", "projects.json");
const OUT = path.join(ROOT, "data", "descriptions-en.json");

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const FORCE = args.includes("--force");
const SAMPLE = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 0;

const CONCURRENCY = Number(process.env.T_CONCURRENCY || 3);
const GAP_MS = Number(process.env.T_GAP || 300);
const COOLDOWN_MS = Number(process.env.T_COOLDOWN || 120000); // 连续失败熔断冷却
const RETRIES = 3;
const TIMEOUT_MS = 12000;
const BATCH_SIZE = Number(process.env.T_BATCH || 15); // clients5 批量端点每次条数

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// 批量端点：一次请求翻 BATCH_SIZE 条，返回字符串数组（与输入同序）；失败返回 null
async function translateBatch(texts) {
  const qs = texts.map((t) => `q=${encodeURIComponent(t)}`).join("&");
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=en&${qs}`;
  for (let i = 0; i < RETRIES; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA } });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length !== texts.length) throw new Error(`条数不匹配 ${data?.length}/${texts.length}`);
      // 每项可能是字符串，也可能被分句成数组 → 拼回
      return data.map((item) => (Array.isArray(item) ? item.map((s) => (typeof s === "string" ? s : s?.[0] || "")).join("") : String(item)).trim());
    } catch (e) {
      clearTimeout(timer);
      if (i === RETRIES - 1) return null; // 批量彻底失败 → 交回退逻辑
      await sleep(1200 * (i + 1));
    }
  }
}

// 单条回退（批量条数不匹配等场景）：clients5 的 /single 端点
async function translateOne(text) {
  const url = `https://clients5.google.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  for (let i = 0; i < RETRIES; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA } });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const out = (data?.[0] || []).map((seg) => seg?.[0] || "").join("").trim();
      if (!out) throw new Error("空结果");
      return out;
    } catch (e) {
      clearTimeout(timer);
      if (i === RETRIES - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

// 质量校验：输入含中文但输出仍大段中文 = 翻译失败
function looksUntranslated(src, out) {
  const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk(src) === 0) return false;      // 原文无中文，无需判断
  return cjk(out) > Math.max(4, cjk(src) * 0.5);
}

// 中文术语后处理：gtx 对本领域高频词的常见怪译修正
const GLOSSARY = [
  [/WeChat applets?/gi, "WeChat Mini Program"],
  [/WeChat mini[\s-]?programs?/gi, "WeChat Mini Program"],
  [/\bapplets?\b/gi, "mini program"],
  [/WeChat official accounts?/gi, "WeChat Official Account"],
  [/\bMIT is open source\b/gi, "MIT-licensed open source"],
];
function fixTerms(s) {
  for (const [re, to] of GLOSSARY) s = s.replace(re, to);
  return s;
}

async function main() {
  const data = JSON.parse(await readFile(SRC, "utf8"));
  const projects = data.projects;
  let cache = {};
  try { cache = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  // 名称含英文词 ≥3 字母且原文描述不含中文的（极少数），也照翻（幂等无害）
  const todo = projects.filter((p) => {
    if (!p.description) return false;
    if (!FORCE && cache[p.id]?.descEn && !looksUntranslated(p.description, cache[p.id].descEn)) return false;
    return true;
  }).slice(0, SAMPLE || LIMIT);

  console.log(`[translate] 待翻译 ${todo.length} / 共 ${projects.length}（已缓存 ${Object.keys(cache).length}）`);
  if (SAMPLE) {
    for (const p of todo.slice(0, SAMPLE)) {
      const en = fixTerms(await translateOne(p.description));
      console.log(`── ${p.name}\n  中: ${p.description}\n  英: ${en}`);
      await sleep(GAP_MS);
    }
    return;
  }

  const t0 = Date.now();
  let done = 0, failed = [], consecFail = 0;
  const queue = [...todo];
  // 取一批任务；返回 { items, texts } 或 null（队列空）
  function takeBatch() {
    if (!queue.length) return null;
    const items = queue.splice(0, BATCH_SIZE);
    return { items, texts: items.map((p) => p.description) };
  }
  async function worker() {
    while (true) {
      const batch = takeBatch();
      if (!batch) return;
      let results = null;
      try {
        results = await translateBatch(batch.texts);
      } catch { results = null; }
      if (results) {
        for (let i = 0; i < batch.items.length; i++) {
          const p = batch.items[i];
          try {
            const en = fixTerms(results[i]);
            if (!en || looksUntranslated(p.description, en)) throw new Error("疑似未翻译（输出仍含中文）");
            cache[p.id] = { descEn: en, at: new Date().toISOString().slice(0, 10) };
          } catch (e) {
            failed.push({ id: p.id, name: p.name, err: String(e.message || e).slice(0, 80) });
          }
          done++;
        }
        consecFail = 0;
      } else {
        // 批量失败 → 逐条回退（单条端点路径不同，可能没被限流）；再失败才计入熔断
        for (const p of batch.items) {
          try {
            const en = fixTerms(await translateOne(p.description));
            if (looksUntranslated(p.description, en)) throw new Error("疑似未翻译（输出仍含中文）");
            cache[p.id] = { descEn: en, at: new Date().toISOString().slice(0, 10) };
            consecFail = 0;
          } catch (e) {
            failed.push({ id: p.id, name: p.name, err: String(e.message || e).slice(0, 80) });
            if (++consecFail >= 15) {
              console.log(`[translate] 连续 ${consecFail} 次失败 → 熔断冷却 ${Math.round(COOLDOWN_MS / 1000)}s`);
              await sleep(COOLDOWN_MS);
              consecFail = 0;
            }
          }
          done++;
          await sleep(GAP_MS);
        }
      }
      if (done % 50 === 0) {
        await writeFile(OUT, JSON.stringify(cache, null, 1), "utf8");
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`[translate] ${done}/${todo.length}  ${rate.toFixed(1)} 条/秒  失败 ${failed.length}  剩余≈${Math.round(queue.length / Math.max(rate, 0.1) / 60)} 分钟`);
      }
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(OUT, JSON.stringify(cache, null, 1), "utf8");
  console.log(`[translate] 完成：成功 ${todo.length - failed.length}，失败 ${failed.length}，用时 ${Math.round((Date.now() - t0) / 1000)}s`);
  if (failed.length) {
    await writeFile(path.join(ROOT, "data", "translate-failed.json"), JSON.stringify(failed, null, 1), "utf8");
    console.log(`[translate] 失败清单已写 data/translate-failed.json（重跑本脚本会自动补）`);
  }
}

main().catch((e) => { console.error("[translate] 失败：", e); process.exit(1); });
