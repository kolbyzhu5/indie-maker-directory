# 独立制造所 · SEO / GEO 优化方案

> 生成时间：2026-08-30 · 域名：indiemaker.cn · 站点类型：中国独立开发者产品导航（约 2327 项）

---

## 一、核心结论（先说重点）

**最大的问题只有一个：你的 2000+ 产品，搜索引擎和 AI 一个都看不见。**

根因是站点采用「纯前端 JS 渲染」（CSR）：`index.html` 里只有一个空壳容器 `<div id="projectGrid">`，全部产品卡片靠浏览器运行时 `fetch data/projects.json` 再动态插入。爬虫抓到的 HTML 源码里，产品内容**根本不存在**。

- 百度 / Google / Bing 抓到的 = 一个首页空壳 + 一段 hero 文案
- 豆包 / 元宝 / DeepSeek / ChatGPT / Perplexity 抓到的 = 同样什么都读不到
- 结果：无论传统搜索还是 AI 搜索，2000+ 产品的名字、描述、分类，全部隐形

**一句话：先把「渲染方式」从 CSR 改成静态生成（SSG），这是所有后续优化的地基。不做这一步，后面全白做。**

---

## 二、现状体检报告

| # | 检查项 | 现状 | 严重度 | 影响 |
|---|--------|------|--------|------|
| 1 | 渲染方式 | 纯前端 JS 渲染（CSR） | 🔴 P0 | 2000+ 产品对爬虫隐形 |
| 2 | sitemap.xml | 仅 1 个 URL，域名还是旧 GitHub Pages 地址 | 🔴 P0 | 搜索引擎找不到任何内容页 |
| 3 | 收录状态 | 未提交百度/Google/Bing 站长平台 | 🟠 P1 | 新域名尚未被索引 |
| 4 | 产品详情页 | 无（单页应用，无独立 URL） | 🔴 P0 | 无长尾流量入口 |
| 5 | 分类落地页 | 无 | 🟠 P1 | 覆盖不到「AI工具」「独立游戏」等大词 |
| 6 | 结构化数据 | 仅 WebSite，缺 Organization/ItemList | 🟡 P1 | AI 无法理解站点实体与产品列表 |
| 7 | llms.txt | 缺失 | 🟡 P2 | AI 爬虫无导航 |
| 8 | og:image | 用了 SVG（favicon.svg） | 🟢 P2 | 社交分享无预览图，AI 不读 SVG |
| 9 | 双语 | JS 切换，无 hreflang / 独立 URL | 🟢 P2 | 英文版无法被索引 |

---

## 三、优化路线图（按优先级）

### P0 · 技术地基（本周必做，不改就白做）

1. **静态生成（SSG）替换 CSR**
   把产品数据在构建期直接写进 HTML，让爬虫零 JS 也能读到全部产品。
   - 本项目无框架，最务实做法：写一个 Node 构建脚本，读取 `data/projects.json`，生成三类静态页（见 P1），并在首页内嵌一段「静态内容快照」供爬虫读取。
   - 验收标准：`curl https://indiemaker.cn/` 的 HTML 源码里，能直接 grep 到产品名。

2. **修复 sitemap.xml**
   - 域名从 `https://kolbyzhu5.github.io/indie-maker-directory/` 改为 `https://indiemaker.cn/`。
   - 列出全部 URL：首页 + 所有分类页 + 所有产品详情页。

3. **提交三大站长平台并验证域名**
   - 百度搜索资源平台（ziyuan.baidu.com）— 国内流量核心。
   - Google Search Console — 提交 sitemap。
   - Bing Webmaster Tools — ChatGPT 引用主要依赖 Bing 索引，**必做**。

### P1 · 程序化 SEO（流量引擎）

4. **产品详情页**：每个产品一个独立 URL（如 `/p/{slug}.html`），自动生成唯一 title / description / H1 / 结构化数据。2327 个产品 = 2327 个长尾收录页。

5. **分类落地页**：每个分类一个落地页（如 `/category/ai.html`），覆盖「AI 工具」「效率工具」「独立游戏」等搜索量大的词。

6. **结构化数据补全**：
   - 首页 / 分类页 → `CollectionPage` + `ItemList`
   - 产品页 → `SoftwareApplication`（name、description、url、category、author）
   - 全站 → `Organization`（含 `sameAs` 指向 GitHub / 知乎 / 公众号）

### P2 · GEO 基建（让 AI 引用）

7. **llms.txt + llms-full.txt**
   站点根目录放 AI 爬虫导航文件，引导模型优先抓取高价值页面。
   - `llms.txt`：一句话站点简介 + 核心页面清单（分类页、榜单页、关于页）。
   - `llms-full.txt`：全量产品索引（名称 + 一句话描述 + 链接），供 AI 完整读取。

8. **FAQPage schema**
   在「关于」页加问答，直接匹配「独立开发者都有哪些好产品」「中国有哪些独立开发作品」这类自然语言查询。

9. **实体一致性**
   - `Organization` 加 `sameAs`（GitHub 仓库、公众号「小猪哥 AI」等）。
   - 确保站名「独立制造所」在 GitHub README、知乎、公众号等跨平台描述统一，AI 会交叉验证。

### P3 · 持续运营

10. **内容集群**：围绕「独立开发」写榜单（如「本周最值得看的 10 个独立产品」）、工具测评，建话题权威（Topical Authority）。
11. **E-E-A-T 显性化**：作者署名、数据来源（同步自 1c7/chinese-independent-developer）、更新时间显性标注。
12. **AI 引用监控**：定期在豆包 / 元宝 / DeepSeek / ChatGPT 里问「中国独立开发者产品导航」，记录是否被引用、如何被描述。

---

## 四、GEO 与 SEO 的关系（30 秒看懂）

- **SEO**：让页面进入搜索结果前 10 名 → 争「排名」。
- **GEO**：让内容被 AI 引用、写进生成答案 → 争「引用」。
- **关系**：99% 的 AI Overview 引用来自传统搜索前 10 名，ChatGPT 引用主要对应 Bing 排名靠前结果。**SEO 是 GEO 的地基**——你连传统 SEO 都没做，GEO 无从谈起。

---

## 五、为什么现在就要做（关键数据）

- Gartner 预测 2026 年传统搜索流量下降 25%，超 50% 的 Google 搜索已触发 AI Overview。
- 中国 AI 搜索月活已破 4.5 亿：豆包 2.26 亿、DeepSeek 1.45 亿、腾讯元宝等紧随其后。
- 普林斯顿大学 GEO 研究（KDD 2024）：加统计数据 + 权威引用，AI 引用率提升 30–40%。
- 中国品牌在国际大模型中的提及率比国内模型低约 30 个百分点，出海/跨语言品牌更需 GEO。

---

## 六、技术实现要点（供开发参考）

### 6.1 构建脚本伪逻辑（scripts/build-seo.mjs）

```
读取 data/projects.json
按 product.slug 生成  dist/p/{slug}.html      （产品详情页）
按 category 聚合生成   dist/category/{cat}.html（分类落地页）
首页内嵌 <noscript> 或 <div class="static-content"> 产品列表快照
重新生成 sitemap.xml（全量 URL，域名 indiemaker.cn）
生成 llms.txt / llms-full.txt
```

### 6.2 产品详情页模板要点

- `<title>{产品名} - 独立制造所</title>`
- `<meta name="description">` = 产品一句话描述
- `<link rel="canonical" href="https://indiemaker.cn/p/{slug}.html">`
- H1 = 产品名，正文含描述、开发者、分类、链接
- `SoftwareApplication` JSON-LD

### 6.3 robots.txt 增强（显式放行 AI 爬虫）

```
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://indiemaker.cn/sitemap.xml
```

### 6.4 双语 hreflang（可选，P2）

```
<link rel="alternate" hreflang="zh-CN" href="https://indiemaker.cn/">
<link rel="alternate" hreflang="en" href="https://indiemaker.cn/en/">
```

---

## 七、执行顺序总结

1. 写构建脚本 → 生成静态页 + 修 sitemap（P0-1、P0-2）
2. 部署到 EdgeOne，验证 `curl` 能读到产品名（P0-1 验收）
3. 提交三大站长平台（P0-3）
4. 补结构化数据 + llms.txt（P1-6、P2-7）
5. 后续持续做内容集群 + AI 引用监控（P3）
