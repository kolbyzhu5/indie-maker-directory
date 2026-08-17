# 独立开发者导航站 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 将 `1c7/chinese-independent-developer` 的三份项目列表转换为一个可搜索、可筛选、每日自动更新的静态导航网站。

**Architecture:** 使用无依赖 Node.js 脚本按日抓取上游 Markdown，解析开发者、城市、产品名称、链接、介绍、状态与版面后输出 `data/projects.json`。前端使用原生 HTML/CSS/JavaScript 读取 JSON 并完成检索、筛选、排序和渐进加载；GitHub Actions 负责每日更新数据并发布 GitHub Pages。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、Node.js 20、Node test runner、GitHub Actions、GitHub Pages。

---

### Task 1: 数据解析器

**Files:**
- Create: `scripts/sync-data.mjs`
- Create: `tests/parser.test.mjs`
- Create: `data/projects.json`

**Steps:**
1. 编写包含开发者标题、状态、产品名和链接的 Markdown 测试样例。
2. 编写断言，覆盖普通产品、程序员项目、游戏项目、城市和可选链接字段。
3. 运行 `node --test tests/parser.test.mjs`，确认测试先失败。
4. 实现标题和产品条目解析、去重、分类推断与统计汇总。
5. 运行测试并确认通过。
6. 执行 `node scripts/sync-data.mjs` 生成真实数据。

### Task 2: 导航站页面

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `app.js`

**Steps:**
1. 创建语义化页面骨架：品牌区、搜索区、版面切换、筛选栏、统计区、产品卡片和空状态。
2. 建立具有中文信息门户气质的视觉系统：米白纸张背景、墨色文字、朱红强调色和紧凑内容密度。
3. 实现数据加载、全文检索、版面筛选、状态筛选和排序。
4. 实现 URL 查询参数同步、搜索快捷键 `/`、清空筛选和“加载更多”。
5. 增加移动端布局、键盘可访问性和加载失败提示。

### Task 3: 每日更新和发布

**Files:**
- Create: `.github/workflows/update-and-deploy.yml`
- Create: `package.json`

**Steps:**
1. 配置每日北京时间清晨自动执行的数据同步任务。
2. 配置手动触发和推送触发。
3. 数据变化时自动提交 `data/projects.json`。
4. 使用 GitHub Pages 官方 Action 发布整个静态站目录。
5. 在 `package.json` 中提供 `sync`、`test` 和 `serve` 命令。

### Task 4: 验证

**Files:**
- Test: `tests/parser.test.mjs`
- Verify: `index.html`, `styles.css`, `app.js`, `data/projects.json`

**Steps:**
1. 运行 Node 测试。
2. 启动本地静态服务器。
3. 用真实浏览器验证首页加载、搜索、筛选、排序、加载更多和移动端布局。
4. 检查控制台错误与无效链接属性。
5. 修复发现的问题并重新验证。
