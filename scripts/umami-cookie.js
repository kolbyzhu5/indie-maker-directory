/**
 * Umami 会话 Cookie 提取片段（仅在需要重新登录时使用）
 *
 * 背景：Umami 免费版（Hobby）没有 API 权限，但仪表盘自己的内部接口
 *   https://cloud.umami.is/api/websites/<id>/*
 * 是【同域 + cookie 鉴权】的，返回结构与付费版 API 完全一致。
 * 从 Node 直接带 Cookie 请求即可，**不需要浏览器、不受 CORS / CSP 限制**。
 *
 * 因此只需在「cookie 过期」或「换账号」时重新提取一次：
 *
 *   1) 用 Playwright 打开 https://cloud.umami.is （若跳登录页则人工登录一次）
 *   2) 执行本文件内容，拿到 cookieHeader
 *   3) 写入仓库外的文件（仓库是 public，绝不能提交）：
 *        printf '%s' '<cookieHeader>' > ~/.workbuddy/umami-cookie && chmod 600 ~/.workbuddy/umami-cookie
 *   4) node scripts/umami-report.mjs
 *
 * Cookie 有效期约 1 个月（__Secure-umami.session_token，expires 字段可查）。
 */

async (page) => {
  if (!/cloud\.umami\.is/.test(page.url())) {
    await page.goto("https://cloud.umami.is/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
  }

  const cookies = await page.context().cookies(["https://cloud.umami.is"]);
  const c = cookies.find((x) => x.name === "__Secure-umami.session_token");

  if (!c) {
    return JSON.stringify({
      found: false,
      onLoginPage: /\/login/.test(page.url()),
      hint: "未找到会话 cookie。若停在登录页，请在该浏览器窗口登录一次后重新执行本片段。"
    });
  }

  return JSON.stringify(
    {
      found: true,
      name: c.name,
      cookieHeader: `${c.name}=${c.value}`,
      expiresAt: c.expires ? new Date(c.expires * 1000).toISOString() : "session",
      saveHint: `printf '%s' '${c.name}=${c.value}' > ~/.workbuddy/umami-cookie && chmod 600 ~/.workbuddy/umami-cookie`
    },
    null,
    1
  );
};
