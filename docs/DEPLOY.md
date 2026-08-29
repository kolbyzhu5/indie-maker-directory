# 独立制造所 · 上线部署手册

> 记录本项目从"GitHub Pages 裸站"到"正式域名 + 双线分流"的完整上线路径，供以后扩第二个站点直接照做。

- 正式域名：`https://www.indiemaker.cn`
- GitHub Pages 回退：`https://kolbyzhu5.github.io/indie-maker-directory/`
- 仓库：https://github.com/kolbyzhu5/indie-maker-directory

---

## 0. 部署架构一览

```
                用户访问 indiemaker.cn / www.indiemaker.cn
                              │
                    DNSPod 智能解析分流
                 ┌────────────┴────────────┐
          国内线路                     境外线路
                 │                          │
         CNAME → EdgeOne Pages       CNAME → GitHub Pages
   (www.indiemaker.cn.pages.dnsoe5.com)   (kolbyzhu5.github.io)
                 │                          │
         边缘节点静态托管              GitHub Pages 静态托管
                 └────────────┬────────────┘
                       同一份源码（main 分支）
```

- **国内**：走 EdgeOne Pages（腾讯云边缘节点，速度快、免备案服务器）
- **境外**：走 GitHub Pages（免费、全球节点，境外访问快）
- 两个部署源指向同一份代码，天然一致

---

## 1. 前置准备

| 项 | 说明 |
|---|---|
| GitHub 仓库 | 已含完整源码 + GitHub Actions 每日同步 |
| 数据中枢 | 腾讯云 COS（`indie-maker-data-1300618702`），详见 `ARCHITECTURE.md` |
| 域名 | 在 DNSPod / 腾讯云购买（本项目：`indiemaker.cn`） |
| 主体信息 | 个人备案需本人身份证 + 手机号 + 人脸认证 |

> 注意：备案主体信息（姓名/证件号）与后续公安备案、域名实名必须**完全一致**。

---

## 2. 域名购买与实名

1. DNSPod / 腾讯云购买域名（`.cn` 需实名认证）
2. 完成域名实名（个人：身份证 + 人脸；通常 1 个工作日内通过）
3. 记下**域名注册服务商 + 所属地区**（公安备案要用，可从 whois 查）

---

## 3. ICP 备案（工信部）

> 法定期限：网站开通前必须完成。`.cn` 域名备案在腾讯云走。

1. 腾讯云控制台 → 备案 → 开始备案
2. 需绑定一个**云资源**（CVM / 轻量应用服务器，最便宜档即可"占坑"）
3. 填写：主办者（个人）、网站名称、域名、接入信息
4. 提交 → 管局审核（约 1–3 周）→ 下发 **ICP 备案号**

本项目 ICP 备案号：`湘ICP备2026036319号`

> ⚠️ **网站名称一旦填定，公安备案、页脚展示都要一字不差沿用**（本项目为"独立制造所"）。

---

## 4. 公安联网备案

> 法定期限：网站开通后 30 天内。入口 `https://beian.mps.gov.cn`（**不是** `gaj.beian.mps.gov.cn`，后者已失效）。

1. 注册/登录（个人 → 扫码下载「公安一网通办」App 实人认证）
2. 新办网站申请 → 填 4 步：开办主体 → 网站基本信息 → 网站负责人 → 提示说明

### 4.1 关键字段填写（踩坑点）

| 字段 | 填什么 | 说明 |
|---|---|---|
| **IP** | 域名**实际解析到**的 IP | 不是备案时买的 CVM IP！见下方说明 |
| 接入商名称 | 腾讯云计算（北京）有限责任公司 | 下拉选择 |
| 网站接入方式 | 租赁虚拟空间 | EdgeOne Pages 算"虚拟空间" |
| 网站类型 | **Z（其他）** | 导航/目录站选 Z，**别选 E（信息咨询）或 G（计算机应用）**，会触发额外审核 |
| 是否提供互联网交互服务 | **否** | 只读静态站选否；选"是"会触发 UGC 审核 |
| 是否涉及管制物品 / 前置许可 | 否 | 默认 |
| 域名服务商 | 按 whois 实际结果填 | 填错直接打回 |

**IP 字段说明**：公安备案要的是"网站真实接入的 IP"，即 `dig` 你的域名看到的 IP。EdgeOne Pages 没有传统服务器，`dig` 出来的是边缘节点 IP（本项目 `113.240.66.7`）。ICP 备案时买的 CVM 只是"占坑资源"，网站没跑在上面，**填它反而算接入信息不实**。

查当前实际 IP：
```bash
dig +short www.indiemaker.cn A
```

### 4.2 提交与结果

- 提交后送属地公安网监大队审核（本项目：湖南省长沙市岳麓区）
- 1–3 个工作日出结果，短信通知
- 通过后查 `beian.mps.gov.cn/#/query/webSearch` 得**公安备案号**（形如 `湘公网安备 43xxxxxxxxxxxxx 号`）

---

## 5. EdgeOne Pages 部署

1. 连接 EdgeOne Makers（WorkBuddy 的 edgeone-pages connector）
2. 部署本地 `dist/` 目录到项目 `indie-maker-directory`

> ⚠️ **EdgeOne Pages 部署源是本地 `dist/`，不是 GitHub 自动构建**。改代码后要 `cp` 到 `dist/` 再重新 deploy：
> ```bash
> cp index.html dist/index.html
> cp index.html dist/.edgeone/assets/index.html
> # 然后用 edgeone-pages deploy_folder 重新部署
> ```

---

## 6. 绑定自定义域名

1. EdgeOne Pages 控制台 → 添加自定义域名 `www.indiemaker.cn`
2. 按提示在 DNSPod 加一条 **TXT 验证记录**（归属校验）：
   - 主机记录：`edgeonereclaim.www`
   - 记录值：EdgeOne 给的 `reclaim-xxx`
3. 验证通过后拿到 **CNAME 目标**：`www.indiemaker.cn.pages.dnsoe5.com`
4. DNSPod 把 `www` 解析切过去（CNAME）

---

## 7. HTTPS 与安全配置

| 项 | 值 | 说明 |
|---|---|---|
| 证书 | 免费证书（EdgeOne 自动签发） | 几分钟下证 |
| HTTP→HTTPS 跳转 | **301**（不是 302） | 永久重定向，SEO 权重完全转移 |
| 强制 HTTPS | 开 | HTTP 自动跳 HTTPS |
| HSTS | 缓存 365 天（平台上限），**包含子域名开**，**预加载关** | 预加载几乎不可撤回，新站先别开 |
| OCSP 装订 | 开 | 减少 TLS 握手延迟 |

---

## 8. DNSPod 智能解析分流

| 主机记录 | 类型 | 记录值 | 线路 |
|---|---|---|---|
| `www` | CNAME | `www.indiemaker.cn.pages.dnsoe5.com` | 默认（国内） |
| `www` | CNAME | `kolbyzhu5.github.io` | 境外 |
| `@` | 显性URL | `https://www.indiemaker.cn` | 默认 |

- 主域 `@` 用**显性 URL 跳转**到 www（301，权重传递，零风险），不必再走 EdgeOne 绑主域流程
- 境外线路可后补，流量起来再加

---

## 9. 备案号挂载到页脚

`index.html` footer 依次展示：

```
独立制造所 · 让认真做出来的东西被看见
湘ICP备2026036319号          ← ICP（链接 https://beian.miit.gov.cn/）
湘公网安备 43xxxxxxxxxxxxx 号  ← 公安（链接 beian.mps.gov.cn，带图标）
反馈建议：kolbyzhu5@gmail.com
```

- ICP 号是硬编码中文（合规要求，海外也保留）
- 公安备案通过后，把备案号 + 图标 URL 发给维护者补上

---

## 10. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 浏览器显示证书不匹配（⚠️） | 证书未配置或 DNS 未生效 | EdgeOne「配置」→ 免费证书，等几分钟 |
| 访问 `indiemaker.cn`（不带 www）打不开 | 主域没配解析 | DNSPod 加 `@` 显性 URL 跳转 |
| 改代码后线上没变 | EdgeOne 部署源是 dist，不是 GitHub 自动构建 | 同步 dist 后重新 deploy |
| 公安备案打回 | 主体不一致 / 网站打不开 / 网站类型选错 | 见 §4.1 逐项核对 |
| `gaj.beian.mps.gov.cn` 解析不到 | 该子域名已失效 | 用主站 `beian.mps.gov.cn` |

---

## 11. 上线后待办清单

- [ ] 公安备案通过 → 挂公安备案号 + 图标到页脚
- [ ] 境外线路分流（流量起来后）
- [ ] 内容 SEO：分类独立页
- [ ] "提交收录"前端表单
- [ ] 变化统计展示
