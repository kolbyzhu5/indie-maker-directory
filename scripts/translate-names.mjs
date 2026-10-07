#!/usr/bin/env node
// ── 产品名英文化（数据层补充）────────────────────────────────────
// 用途：英文界面下仍有 ~1000 条产品名是中文（首页卡片/详情页标题）。
// 原则：
//   · 中文原名字段一字不动 —— 结果写独立映射文件 data/names-en.json（id → { nameEn }）。
//   · slug / URL 不变（slug 仍由原始 name 派生），只改英文展示层。
//   · 引擎与 translate.mjs 相同：clients5.google.com 批量端点。
//   · 质量闸：输出仍含大段中文 = 失败（产品名短，中英混杂品牌词会保留 Latin 部分）。
// 用法：
//   node scripts/translate-names.mjs            # 全量（自动跳过已完成）
//   node scripts/translate-names.mjs --sample 5 # 抽样打印对照（不写文件）
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "data", "projects.json");
const OUT = path.join(ROOT, "data", "names-en.json");

const args = process.argv.slice(2);
const SAMPLE = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) : 0;

const CONCURRENCY = Number(process.env.T_CONCURRENCY || 3);
const GAP_MS = Number(process.env.T_GAP || 300);
const COOLDOWN_MS = Number(process.env.T_COOLDOWN || 120000);
const BATCH_SIZE = Number(process.env.T_BATCH || 15);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const hasCJK = (s) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef「」『』·]/.test(s || "");

// 批量端点：一次请求翻 BATCH_SIZE 条，返回字符串数组（与输入同序）；失败返回 null
async function translateBatch(texts) {
  const qs = texts.map((t) => `q=${encodeURIComponent(t)}`).join("&");
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=en&${qs}`;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA } });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length !== texts.length) throw new Error(`条数不匹配 ${data?.length}/${texts.length}`);
      return data.map((item) => (Array.isArray(item) ? item.map((s) => (typeof s === "string" ? s : s?.[0] || "")).join("") : String(item)).trim());
    } catch (e) {
      clearTimeout(timer);
      if (i === 2) return null;
      await sleep(1200 * (i + 1));
    }
  }
}

// 单条回退：/single 端点
async function translateOne(text) {
  const url = `https://clients5.google.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
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
      if (i === 2) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

// 质量闸：源含 CJK 汉字但输出残留 >50% 汉字 = 未翻译
function looksUntranslated(src, out) {
  const cjk = (s) => ((s == null ? "" : String(s)).match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk(src) === 0) return false;
  return cjk(out) > Math.max(1, cjk(src) * 0.5);
}

async function main() {
  const data = JSON.parse(await readFile(SRC, "utf8"));
  const projects = data.projects;
  let cache = {};
  try { cache = JSON.parse(await readFile(OUT, "utf8")); } catch {}

  const todo = projects.filter((p) => hasCJK(p.name) && !cache[p.id]?.nameEn).slice(0, SAMPLE || Infinity);

  console.log(`[names] 待翻译 ${todo.length} / 共 ${projects.length}（已缓存 ${Object.keys(cache).length}）`);

  if (SAMPLE) {
    for (const p of todo.slice(0, SAMPLE)) {
      const en = await translateOne(p.name);
      console.log(`── ${p.name}\n  → ${en}  ${looksUntranslated(p.name, en) ? "⚠️疑似未译" : ""}`);
      await sleep(GAP_MS);
    }
    return;
  }

  const t0 = Date.now();
  let done = 0, failed = [], consecFail = 0;
  const queue = [...todo];
  function takeBatch() {
    if (!queue.length) return null;
    const items = queue.splice(0, BATCH_SIZE);
    return { items, texts: items.map((p) => p.name) };
  }
  async function worker() {
    while (true) {
      const batch = takeBatch();
      if (!batch) return;
      let results = null;
      try { results = await translateBatch(batch.texts); } catch { results = null; }
      if (results) {
        for (let i = 0; i < batch.items.length; i++) {
          const p = batch.items[i];
          const en = results[i];
          if (!en || looksUntranslated(p.name, en)) {
            failed.push({ id: p.id, name: p.name, got: en });
          } else {
            cache[p.id] = { nameEn: en, at: new Date().toISOString().slice(0, 10) };
            consecFail = 0;
          }
          done++;
        }
      } else {
        for (const p of batch.items) {
          try {
            const en = await translateOne(p.name);
            if (looksUntranslated(p.name, en)) throw new Error("输出仍含中文");
            cache[p.id] = { nameEn: en, at: new Date().toISOString().slice(0, 10) };
            consecFail = 0;
          } catch (e) {
            failed.push({ id: p.id, name: p.name, err: String(e.message || e).slice(0, 80) });
            if (++consecFail >= 15) {
              console.log(`[names] 连续 ${consecFail} 次失败 → 熔断冷却 ${Math.round(COOLDOWN_MS / 1000)}s`);
              await sleep(COOLDOWN_MS);
              consecFail = 0;
            }
          }
          done++;
          await sleep(GAP_MS);
        }
      }
      if (done % 100 === 0) {
        await writeFile(OUT, JSON.stringify(cache, null, 1), "utf8");
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`[names] ${done}/${todo.length}  ${rate.toFixed(1)} 条/秒  失败 ${failed.length}`);
      }
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(OUT, JSON.stringify(cache, null, 1), "utf8");
  console.log(`[names] 完成：成功 ${todo.length - failed.length}，失败 ${failed.length}，用时 ${Math.round((Date.now() - t0) / 1000)}s`);
  if (failed.length) {
    await writeFile(path.join(ROOT, "data", "names-failed.json"), JSON.stringify(failed, null, 1), "utf8");
    console.log(`[names] 失败清单已写 data/names-failed.json（重跑本脚本会自动补）`);
  }
}

main().catch((e) => { console.error("[names] 失败：", e); process.exit(1); });
