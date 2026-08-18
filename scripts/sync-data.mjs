import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHmac, createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 站点主 URL：GitHub Pages 部署期用此值；备案切换 indiemaker.cn 后改为 "https://indiemaker.cn"
const SITE_URL = "https://kolbyzhu5.github.io/indie-maker-directory";
const SOURCES = [
  { edition: "main", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/README.md" },
  { edition: "programmer", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/pages/README-Programmer-Edition.md" },
  { edition: "game", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/pages/README-Game.md" }
];

// 腾讯云 COS 上传（主数据存储）。未配置环境变量时自动跳过（本地开发无影响）。
// 配置：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET（不含后缀域名）/ COS_REGION（如 ap-guangzhou）
function signCOSPut(bucket, region, key, secretId, secretKey) {
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - 60;
  const endTime = now + 600;
  const keyTime = `${startTime};${endTime}`;
  const signKey = createHmac("sha1", secretKey).update(keyTime).digest("hex");
  const httpMethod = "put";
  const httpUri = `/${key}`;
  const httpParameters = "";
  // COS 规范：多个待签名 header 用 "&" 连接（key 小写、value 需 URL 编码，末尾不带 \n）
  const httpHeaders = `host=${encodeURIComponent(host.toLowerCase())}`;
  // StringToSign = "sha1\n" + KeyTime + "\n" + SHA1(FormatString) + "\n"
  const formatString = `${httpMethod}\n${httpUri}\n${httpParameters}\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${createHash("sha1").update(formatString).digest("hex")}\n`;
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");
  const authorization = [
    "q-sign-algorithm=sha1",
    `q-ak=${encodeURIComponent(secretId)}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    "q-header-list=host",
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
  return { host, authorization };
}

export async function uploadToCOS(content, cosKey = "data/projects.json") {
  const { COS_SECRET_ID: secretId, COS_SECRET_KEY: secretKey, COS_BUCKET: bucket, COS_REGION: region } = process.env;
  if (!secretId || !secretKey || !bucket || !region) {
    console.log("[COS] 未配置 COS 环境变量，跳过上传");
    return { uploaded: false, reason: "not-configured" };
  }
  const body = typeof content === "string" ? Buffer.from(content) : content;
  const { host, authorization } = signCOSPut(bucket, region, cosKey, secretId, secretKey);
  const url = `https://${host}/${cosKey}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8"
    },
    body
  });
  if (!response.ok) throw new Error(`COS 上传失败 HTTP ${response.status}: ${await response.text()}`);
  console.log(`[COS] 已上传 ${cosKey} → ${bucket} (${region})`);
  return { uploaded: true, url };
}

// 从 COS 读取文件（桶为公有读，无需签名）；失败返回 null
export async function fetchFromCOS(cosKey) {
  const { COS_BUCKET: bucket, COS_REGION: region } = process.env;
  if (!bucket || !region) return null;
  try {
    const url = `https://${bucket}.cos.${region}.myqcloud.com/${cosKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// 北京时间的 YYYY-MM-DD（同步按"天"归档，用国内时区）
function beijingDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

// 计算增量：新增 / 更新 / 移除
export function computeChanges(prevProjects = [], currProjects = []) {
  const prevMap = new Map(prevProjects.map((p) => [p.url.toLowerCase(), p]));
  const currMap = new Map(currProjects.map((p) => [p.url.toLowerCase(), p]));
  const added = currProjects.filter((p) => !prevMap.has(p.url.toLowerCase()));
  const removed = prevProjects.filter((p) => !currMap.has(p.url.toLowerCase()));
  const updated = currProjects.filter((p) => {
    const prev = prevMap.get(p.url.toLowerCase());
    if (!prev) return false;
    return JSON.stringify({ name: prev.name, status: prev.status, description: prev.description }) !==
           JSON.stringify({ name: p.name, status: p.status, description: p.description });
  });
  return { added, removed, updated };
}

const CATEGORY_RULES = [
  ["AI 工具", /\bAI\b|人工智能|大模型|LLM|ChatGPT|Claude|DeepSeek|智能体|Agent/i],
  ["图片工具", /图片|图像|照片|摄影|壁纸|抠图|绘图|生图|像素|OCR/i],
  ["音视频", /视频|音频|音乐|播客|字幕|语音|直播|播放器|录音/i],
  ["文档办公", /PDF|文档|Word|Excel|PPT|Markdown|笔记|简历|表格|写作/i],
  ["效率工具", /效率|待办|日历|提醒|剪贴板|时间|专注|自动化|工作流|管理/i],
  ["开发工具", /开发|代码|编程|程序员|API|GitHub|服务器|数据库|部署|终端|命令行|Docker|macOS|Windows|Linux/i],
  ["浏览器扩展", /浏览器|Chrome|Edge|Firefox|插件|扩展/i],
  ["教育学习", /学习|教育|课程|考试|单词|英语|日语|题库|阅读/i],
  ["生活服务", /生活|天气|菜谱|健康|记账|财务|旅行|地图|购物/i],
  ["社交社区", /社交|社区|聊天|交友|论坛|团队协作/i],
  ["游戏娱乐", /游戏|Minecraft|Steam|宝可梦|原神|解压|娱乐/i],
  ["免费工具", /免费|无需注册|开源|本地处理/i]
];

export function inferCategories(text) {
  return CATEGORY_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name).slice(0, 5);
}

function slugify(value) {
  const transliterations = {
    "好工具": "haogongju",
    "开发中项目": "kaifazhongxiangmu",
    "旧项目": "jiuxiangmu"
  };
  if (transliterations[value]) return transliterations[value];
  const ascii = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
  return ascii || "project";
}

function parseLinks(text) {
  return [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))+?)\)/g)].map((match) => ({
    label: match[1].trim(),
    url: match[2].trim()
  }));
}

function parseMaker(line) {
  const raw = line.replace(/^####\s+/, "").trim();
  const beforeLinks = raw.split(/\s+-\s+\[/)[0].trim();
  const cityMatch = beforeLinks.match(/^(.*?)\s*[（(]([^()（）]+)[）)]$/);
  return {
    maker: (cityMatch ? cityMatch[1] : beforeLinks).trim(),
    city: cityMatch ? cityMatch[2].trim() : "",
    makerLinks: parseLinks(raw)
  };
}

function parseDate(line) {
  const match = line.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function cleanDescription(text) {
  return text.replace(/\s+-\s+\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/g, "").trim();
}

export function parseMarkdown(markdown, edition) {
  const projects = [];
  let addedAt = "";
  let maker = { maker: "未知开发者", city: "", makerLinks: [] };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^###\s+20\d{2}/.test(line)) {
      addedAt = parseDate(line);
      continue;
    }
    if (/^####\s+/.test(line)) {
      maker = parseMaker(line);
      continue;
    }
    const item = line.match(/^\s*[*-]\s+:(white_check_mark|clock8|x):\s+\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))+?)\)[：:]\s*(.+)$/);
    if (!item || !addedAt) continue;

    const status = item[1] === "white_check_mark" ? "online" : item[1] === "clock8" ? "developing" : "inactive";
    const extraLinks = parseLinks(item[4]);
    const description = cleanDescription(item[4]);
    const makerKey = maker.makerLinks.find((link) => /github/i.test(link.label))?.url.split("/").filter(Boolean).pop() || maker.maker;
    const categories = inferCategories(`${item[2]} ${description}`);
    projects.push({
      id: `${edition}-${addedAt.replaceAll("-", "")}-${slugify(makerKey)}-${slugify(item[2])}`,
      edition,
      addedAt,
      maker: maker.maker,
      city: maker.city,
      makerLinks: maker.makerLinks,
      name: item[2].trim(),
      url: item[3].trim(),
      status,
      description,
      extraLinks,
      categories
    });
  }
  return projects;
}

async function fetchText(url, localFallback) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "indie-directory-sync/1.0" } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    if (!localFallback) throw error;
    return readFile(localFallback, "utf8");
  }
}

// 读取人工收录源（custom-projects.json，独立于上游，永不被覆盖）
async function loadCustomProjects() {
  try {
    const raw = await readFile(path.join(ROOT, "data/custom-projects.json"), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

// 归一化人工收录条目 → 统一 project 格式
function normalizeCustomProject(item, index) {
  const today = beijingDate();
  return {
    id: `custom-${today.replaceAll("-", "")}-${index}`,
    edition: item.edition || "main",
    addedAt: item.addedAt || today,
    maker: item.maker || "未知开发者",
    city: item.city || "",
    makerLinks: item.makerLinks || [],
    name: String(item.name || "").trim(),
    url: String(item.url || "").trim(),
    status: ["online", "developing", "inactive"].includes(item.status) ? item.status : "online",
    description: item.description || "",
    extraLinks: item.extraLinks || [],
    categories: Array.isArray(item.categories) && item.categories.length
      ? item.categories
      : inferCategories(`${item.name || ""} ${item.description || ""}`),
    source: "custom"
  };
}

export async function syncData() {
  const fallbacks = {
    programmer: "/tmp/cid-programmer.md",
    game: "/tmp/cid-game.md"
  };
  const batches = [];
  for (const source of SOURCES) {
    const markdown = await fetchText(source.url, fallbacks[source.edition]);
    const parsed = parseMarkdown(markdown, source.edition).map((project) => ({ ...project, source: "upstream" }));
    batches.push(...parsed);
  }

  // 合并人工收录源（独立文件，读不覆盖）
  const customItems = await loadCustomProjects();
  const customProjects = customItems.map(normalizeCustomProject);
  if (customProjects.length) {
    console.log(`[custom] 读取人工收录 ${customProjects.length} 条`);
  }

  // URL 去重：先上游后 custom（custom 与上游重复时保留上游，提示跳过）
  const seen = new Set();
  const projects = [];
  for (const project of [...batches, ...customProjects]) {
    const key = project.url.toLowerCase();
    if (seen.has(key)) {
      if (project.source === "custom") console.log(`[custom] 跳过重复：${project.name}（上游已有）`);
      continue;
    }
    seen.add(key);
    projects.push(project);
  }
  projects.sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  const categoryCounts = {};
  for (const project of projects) {
    for (const category of project.categories) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  const editionCounts = {
    main: projects.filter((item) => item.edition === "main").length,
    programmer: projects.filter((item) => item.edition === "programmer").length,
    game: projects.filter((item) => item.edition === "game").length
  };
  if (projects.length < 500 || Object.values(editionCounts).some((count) => count < 20)) {
    throw new Error(`解析结果异常，拒绝覆盖现有数据：总数 ${projects.length}，分版 ${JSON.stringify(editionCounts)}`);
  }

  const payload = {
    source: "https://github.com/1c7/chinese-independent-developer",
    sources: ["upstream", ...(customProjects.length ? ["custom"] : [])],
    generatedAt: new Date().toISOString(),
    counts: {
      total: projects.length,
      ...editionCounts,
      custom: customProjects.length
    },
    categoryCounts,
    projects
  };

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  const outputPath = path.join(ROOT, "data/projects.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

  // 生成 sitemap.xml（含主页与全部项目页 URL；项目页作为锚点，后续做独立页时扩展）
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
</urlset>
`;
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap);

  // 增量归档到 COS：最新全量 + 每日快照 + 变化记录（未配置密钥时静默跳过）
  const today = beijingDate();
  const yesterday = beijingDate(-1);
  const prevData = await fetchFromCOS(`history/${yesterday}.json`) || await fetchFromCOS("data/projects.json");
  const changes = computeChanges(prevData?.projects || [], projects);
  const changesPayload = {
    date: today,
    generatedAt: new Date().toISOString(),
    added: changes.added,
    removed: changes.removed,
    updated: changes.updated,
    counts: {
      added: changes.added.length,
      removed: changes.removed.length,
      updated: changes.updated.length
    }
  };
  const snapshot = JSON.stringify(payload);
  await uploadToCOS(snapshot, "data/projects.json");
  await uploadToCOS(snapshot, `history/${today}.json`);
  await uploadToCOS(JSON.stringify(changesPayload), `changes/${today}.json`);
  if (customProjects.length) {
    await uploadToCOS(JSON.stringify(customProjects, null, 2), `sources/custom/${today}.json`);
  }
  console.log(`[changes] ${today}：新增 ${changes.added.length}，更新 ${changes.updated.length}，移除 ${changes.removed.length}`);
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await syncData();
  console.log(`已同步 ${result.counts.total} 个项目：主版 ${result.counts.main}，程序员版 ${result.counts.programmer}，游戏版 ${result.counts.game}`);
}
