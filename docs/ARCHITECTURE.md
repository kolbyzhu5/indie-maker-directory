# 独立制造所 · 系统架构设计文档

> 中国独立开发者产品导航站。数据每日自动同步，双语展示，COS 数据中枢 + GitHub 副本双存储。

- 线上地址：https://kolbyzhu5.github.io/indie-maker-directory/
- 正式域名：`indiemaker.cn`（备案中，通过后切 EdgeOne Pages）
- 仓库：https://github.com/kolbyzhu5/indie-maker-directory

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────┐
│ 数据源层                                              │
│  ① 上游 GitHub README（1c7/chinese-independent-     │
│     developer，主版/程序员版/游戏版 3 个版面）        │
│  ② 人工收录 custom-projects.json（独立文件）          │
│  ③ 未来 API 源（Product Hunt / Gitee 等，可插拔）    │
└──────────────────────┬──────────────────────────────┘
                       │ 每天 06:20（北京时间）自动同步
                       ▼
┌─────────────────────────────────────────────────────┐
│ 合并管道（GitHub Actions → sync-data.mjs）            │
│  归一化 → 合并 → URL 去重 → 数据校验（<500 拒绝）     │
│  → 生成 projects.json + sitemap.xml                  │
└──────────────────────┬──────────────────────────────┘
                       │ 双写
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────────┐          ┌──────────────────┐
│ 腾讯云 COS（主库）│          │ GitHub 仓库（副本）│
│ 按天增量归档      │          │ 部署载体 + 容灾   │
└──────────────────┘          └──────────────────┘
       │ 浏览器直读（CORS）         │ GitHub Pages 部署
       ▼                           ▼
┌─────────────────────────────────────────────────────┐
│ 前端：SPA 静态站（HTML/CSS/JS，零构建）               │
│  数据读取：COS 主库 → GitHub 本地副本（自动回退）     │
│  双语切换：zh / en（i18n 模块 + 浏览器语言智能默认）  │
│  SEO：JSON-LD + sitemap + OG 标签                    │
└─────────────────────────────────────────────────────┘
```

**设计原则**：
- 数据源可插拔：加一个源 = 加一个适配器，合并管道不变
- 源数据 vs 产物分离：用户/渠道数据是"源"（永不覆盖），合并结果是"产物"（每次重建）
- 主备双存储：COS 主库 + GitHub 副本，任一故障网站可用

## 2. 数据同步机制

### 2.1 触发方式（三种）

| 方式 | 时机 | 说明 |
|---|---|---|
| 定时任务 | 每天 06:20 北京时间 | GitHub Actions `cron "20 22 * * *"`（UTC） |
| 代码推送 | push 到 main | 立即重新同步 + 部署 |
| 手动触发 | 随时 | Actions 页 Run workflow |

### 2.2 流水线（约 30 秒）

1. **单元测试**：5 个测试（解析器 / diff 计算 / custom 兼容 / COS 跳过），失败即中止
2. **抓取**：3 个版面 README（上游不可用时用本地缓存兜底）
3. **解析**：Markdown → 结构化数据（名称/介绍/开发者/城市/状态/分类/URL）
4. **合并**：上游 + 人工收录，按 URL 去重（custom 与上游重复时保留上游）
5. **校验**：总数 <500 或任一版面 <20 → 拒绝覆盖（防脏数据）
6. **产出**：`data/projects.json` + `sitemap.xml`
7. **双写**：上传 COS + commit GitHub（带 rebase 防并发冲突）
8. **部署**：GitHub Pages 自动发布

### 2.3 容灾

| 故障 | 兜底 |
|---|---|
| 上游仓库挂了 | 本地缓存文件（/tmp/cid-*.md），不中断 |
| 数据异常（校验不过） | 拒绝覆盖，网站展示上次正常数据 |
| GitHub 平台挂了 | COS 数据独立存在；切 EdgeOne 后网站照常 |
| COS 挂了 | 前端自动回退 GitHub 本地副本 |

## 3. COS 数据中枢

- 存储桶：`indie-maker-data-1300618702`（ap-guangzhou，公有读私有写，单 AZ）
- 访问密钥：GitHub Actions Secrets（COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION）
- 签名：Node 内置 crypto 手写 COS V5 签名（零依赖）
- CORS：Origin `*`，GET/HEAD（浏览器直读主库）

### 3.1 目录结构

```
indie-maker-data-1300618702/
├── data/projects.json          ← 最新全量（覆盖写，网站读取）
├── history/YYYY-MM-DD.json     ← 每日快照（永久保留，可回溯）
├── changes/YYYY-MM-DD.json     ← 每日变化 diff（新增/更新/移除）
└── sources/custom/YYYY-MM-DD.json ← 人工收录源（各渠道数据归档）
```

### 3.2 增量归档

- 每次同步：覆盖 `data/projects.json`（最新）+ 追加 `history/当天.json`（快照）+ 生成 `changes/当天.json`（diff）
- diff 计算：以 URL 为键，对比前一天快照（无历史时对比当前最新全量）
- 数据量：约 1MB/天，一年 ~365MB，成本几元/年
- 用途：历史回溯、变化统计（未来可做"今日新增 X 个产品"展示）

## 4. 多数据源与人工收录

### 4.1 数据源抽象

每个源 = 一个适配器，统一输出格式：
```js
{ id, edition, addedAt, maker, city, name, url, status, description, categories, source }
```
- `source` 字段标识来源（`upstream` / `custom` / 未来渠道名）
- 合并管道（去重/校验/发布）对源无感知

### 4.2 人工收录机制

- 文件：`data/custom-projects.json`（git 跟踪，独立存储）
- 原则：**custom 是"源"不是"产物"**——全量同步只覆盖合并结果，custom 文件只被读取，永不被覆盖
- 流程：发现项目 → 加一条 → 触发同步 → 自动合并上线
- 去重：URL 与上游重复自动跳过（保留上游版本）
- 格式：
```json
{ "projects": [ { "name": "...", "url": "...", "description": "...", "maker": "...", "status": "online", "categories": ["效率工具"] } ] }
```

## 5. 前端设计

- **形态**：SPA 静态站，原生 HTML/CSS/JS，零构建、零依赖
- **数据读取**：`DATA_URLS` 顺序——COS 主库 → GitHub 本地副本（自动回退，console 有降级日志）
- **双语 i18n**：`i18n.js` 模块（zh/en 字典 + 动态函数）
  - 决策优先级：用户手动选择（localStorage 持久化）> 浏览器语言（zh* → zh，其他 → en）> IP 增强（api.country.is，失败降级）
  - 切换时同步更新 title / meta description / OG 标签
  - 卡片内产品名/介绍保留原样（来源数据，不翻译）
- **交互**：全文搜索、版面/状态/分类筛选、排序、渐进加载、URL 状态保留（可分享）
- **SEO**：
  - JSON-LD：WebSite（head 静态）+ ItemList（前 10 项目，动态注入）
  - meta / canonical / OG / Twitter 标签（双语切换同步更新）
  - `sitemap.xml` + `robots.txt`（sync 自动生成，SITE_URL 一处可改）

## 6. 部署与运维

| 环节 | 方案 |
|---|---|
| CI/CD | GitHub Actions（update-and-deploy.yml）：测试 → 同步 → 上传 COS → 提交数据 → 部署 Pages |
| 托管 | GitHub Pages（当前）/ EdgeOne Pages（备案后，国内节点） |
| 域名 | `indiemaker.cn` 备案中；通过后 DNS 智能分流：国内 → EdgeOne，海外 → GitHub Pages |
| 数据 | COS 主库 + GitHub 副本，双写双备 |
| 更新 | 全自动，无需人工干预 |

### GitHub Actions Secrets

| Secret | 用途 |
|---|---|
| COS_SECRET_ID / COS_SECRET_KEY | COS 上传签名 |
| COS_BUCKET | 存储桶名（含 APPID 后缀） |
| COS_REGION | 地域（ap-guangzhou） |

## 7. 当前状态与路线图

### 已完成（MVP）

- [x] 三版面数据每日自动同步（2,200+ 项目）
- [x] 中英双语切换 + 浏览器语言智能默认
- [x] COS 数据中枢（增量归档 + 多源合并 + 前端直读）
- [x] 人工收录机制（custom-projects.json）
- [x] 技术 SEO（sitemap / robots / JSON-LD / OG）
- [x] 页脚反馈邮箱

### 待办

- [ ] 备案通过 → EdgeOne Pages + `indiemaker.cn` + DNS 智能分流
- [ ] 内容 SEO：12 个分类独立页（/category/xxx.html，长尾关键词）
- [ ] "提交收录"前端表单（邮件/Issue → 审核 → 入库）
- [ ] 变化统计展示（"今日新增/更新"基于 changes/ 数据）
- [ ] 商业化（L2 置顶/赞助、L3 数据 API）——按用户反馈推进

## 8. 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | 原生 HTML / CSS / JavaScript（ES Modules） |
| 数据脚本 | Node.js（零第三方依赖，内置 fetch/crypto） |
| 数据存储 | 腾讯云 COS（对象存储） |
| 测试 | Node 内置 test runner（5 个用例） |
| CI/CD | GitHub Actions + GitHub Pages |
| 上游数据 | 1c7/chinese-independent-developer（MIT 精神的开源清单） |
