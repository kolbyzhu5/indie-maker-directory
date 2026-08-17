import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = [
  { edition: "main", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/README.md" },
  { edition: "programmer", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/pages/README-Programmer-Edition.md" },
  { edition: "game", url: "https://raw.githubusercontent.com/1c7/chinese-independent-developer/master/pages/README-Game.md" }
];

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

export async function syncData() {
  const fallbacks = {
    programmer: "/tmp/cid-programmer.md",
    game: "/tmp/cid-game.md"
  };
  const batches = [];
  for (const source of SOURCES) {
    const markdown = await fetchText(source.url, fallbacks[source.edition]);
    batches.push(...parseMarkdown(markdown, source.edition));
  }

  const seen = new Set();
  const projects = batches.filter((project) => {
    const key = `${project.edition}|${project.url}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.addedAt.localeCompare(a.addedAt));

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
    generatedAt: new Date().toISOString(),
    counts: {
      total: projects.length,
      ...editionCounts
    },
    categoryCounts,
    projects
  };

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(path.join(ROOT, "data/projects.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await syncData();
  console.log(`已同步 ${result.counts.total} 个项目：主版 ${result.counts.main}，程序员版 ${result.counts.programmer}，游戏版 ${result.counts.game}`);
}
