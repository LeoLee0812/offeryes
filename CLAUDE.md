# OfferYes 秋招雷达 · 项目约定

线上 <https://offeryes.leolee0812.site> · 仓库 `LeoLee0812/offeryes` · Cloudflare Worker `offeryes`（纯静态资源）

## 这个项目的核心主张

**不做存量列表，只做每日变化。** 上游牛客有近万条记录，八成是结束的历史批次、一千多条是零字段空壳。
`scripts/crawl.mjs` 里的两道闸门是整个项目最重要的代码，**改动前先想清楚会不会把空壳放回来**：

1. 没有网申时间也没有批次号 → 丢
2. 上游标记已结束、且网申窗口也过了 → 丢

首页时间线按**日期倒序**排（今天 / 昨天 / 前天 / 8月5日…），每张卡片回答「这天这条批次发生了什么」，
而不是「这家公司存在」。加任何新功能都不要破坏这个信息主张。

## 架构（刻意保持简单）

抓取跑在 GitHub Actions，产物 commit 进仓库，站点是纯静态的。
**没有 D1 / KV / Queue / Workers Cron**，别往回加：

- Workers 免费版 10ms CPU 抓不完 200 页，Actions 上没这个限制
- Workers Free 的 Cron 是 5 条/账号的全局配额，别拿这个项目去占
- 历史快照在 git 里，回滚和溯源是免费的

## 必须守住的几条

- **筛选栏不能用 `position: sticky`，也不能用 ScrollTrigger 的 pin**。ScrollSmoother 用 transform 推动
  `#smooth-content`，transform 会成为内部 fixed/sticky 的包含块 —— 筛选栏会整块浮起来把时间线挡死。
  正解是筛选栏留在文档流，紧凑吸顶条 `#filterbar` 挂在 `#smooth-wrapper` **外面**。
- **`site/data.js` 必须带内容指纹**。`build.mjs` 会把 sha1 前缀写进 `index.html` 的 script src，
  少了这一步，浏览器和 CDN 会吃旧缓存，页面上出现「昨天的数据配今天的日期」。
- **事件对象里公司类型叫 `ctype` 不叫 `type`**。`type` 是事件类型（open/new/window…），会互相覆盖。
- **牛客的 `updateTime` 不是网申开始时间**，实测晚 4–11 天，别拿它当「开网申的日子」。
- **牛客拿不到岗位明细**（企业主页「职位(0)」，上游自己就没有），详情页只展示到「方向」这一层，不要编造岗位数。
- 改完跑 `npm test`（25 条单测覆盖两道闸门和全部事件类型），再 `node scripts/build.mjs`。

## 常用命令

```bash
node scripts/crawl.mjs --dry   # 抓一遍看统计，不写盘
npm run refresh                # 抓取 + 编译
npm run dev                    # 本地 http://127.0.0.1:8899
npm test
```

## 部署

push 到 main 由 `deploy.yml` 自动部署，**不要手动 `wrangler deploy`**。
需要的 GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`RESEND_API_KEY`、`DIGEST_TO`。

## 二期可以接的信源

牛客只能给到「公司 + 批次」这一层。要做到岗位级，档案见上一版项目的信源侦察结论：
Workday（42 个在华租户、2629 个中国岗位，能到 JD 全文）> Greenhouse（约 50 家）> OfferFree（1196 条国企长尾）。
已确认走不通的：牛客岗位明细、Moka（响应体加密）、BOSS/拉勾/智联（TLS 指纹）、国聘网（有签名机制）。
