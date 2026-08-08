# OfferYes 秋招雷达

[![部署到 Cloudflare](https://img.shields.io/github/actions/workflow/status/LeoLee0812/offeryes/deploy.yml?branch=main&style=flat-square&logo=cloudflare&logoColor=white&label=deploy)](https://github.com/LeoLee0812/offeryes/actions/workflows/deploy.yml)
[![抓取增量](https://img.shields.io/github/actions/workflow/status/LeoLee0812/offeryes/refresh.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=refresh)](https://github.com/LeoLee0812/offeryes/actions/workflows/refresh.yml)
[![最近巡检](https://img.shields.io/github/last-commit/LeoLee0812/offeryes/main?style=flat-square&logo=git&logoColor=white&label=最近巡检)](https://github.com/LeoLee0812/offeryes/commits/main)
[![Node](https://img.shields.io/badge/node-22-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

> 每天告诉你：**哪些公司开了网申、动了批次、加了方向**。
>
> 线上：<https://offeryes.leolee0812.site>

## 这个站解决什么问题

牛客校招日程有近一万条记录，但里面**八成是早就结束的历史批次，还有一千多条连截止时间都没有的空壳**。
直接照搬上游，页面上就会滚出成千上万张「截止时间未公布」的卡片——看着很满，一条有用的都没有。

OfferYes 只做两件事：

1. **砍掉噪音**：只保留仍在进行中的批次（上游标记 `end=0`，或网申窗口还没过）。一万条进来，三百多条留下。
2. **只讲变化**：时间线不按公司排，按**日期倒序**排。今天 / 昨天 / 前天各自发生了什么，一眼看完。

每张卡片回答的不是「这家公司存在」，而是「这天它身上发生了什么」：

| 事件 | 含义 |
|---|---|
| 网申开放 | 这天网申通道打开了 |
| 即将开放 | 上游已排期，网申还没到开始日 |
| 新收录 | 我们库里第一次见到这家公司 |
| 开新批次 | 老公司又开了一批新的 |
| 新增方向 | 招聘方向变多了，列出新增的那些 |
| 时间调整 | 网申时间被上游改过，附旧值 |
| 信息更新 | 上游当天动过这条批次 |
| 已下架 | 上游把这条撤了 |

## 架构

```
GitHub Actions（每天 08:00 / 20:00 CST）
  └─ scripts/crawl.mjs   抓牛客 200 页 → 两道闸门过滤 → 与上一版快照 diff → data/*.json
  └─ scripts/build.mjs   聚合成按天分组的时间线 → site/data.js（带内容指纹）
  └─ scripts/digest.mjs  当天有动静才发 Resend 日报
  └─ git commit & push
       └─ deploy.yml → Cloudflare Workers（纯静态资源）
```

刻意**没有**数据库、队列和 Workers Cron：

- 抓取跑在 Actions 上，没有 Workers 免费版 10ms CPU 的限制，200 页一口气抓完；
- 数据是构建期产物，站点运行时只是静态文件，快且便宜；
- 不占 Workers Free 那 5 条/账号的 Cron 配额；
- 历史快照天然存在 git 里，回滚和溯源都是免费的。

## 本地开发

```bash
node scripts/crawl.mjs        # 抓取 + 增量 diff（--dry 只抓不写盘）
node scripts/build.mjs        # 编译 site/data.js
npm run dev                   # http://127.0.0.1:8899
npm test                      # 25 条单测
```

前端是零构建的单页：`site/index.html` + GSAP（ScrollSmoother / ScrollTrigger / DrawSVG / SplitText）。

## 几个踩过的坑

- **ScrollSmoother 会让 `position: sticky` 失效**。它靠 transform 推动内容容器，而 transform 会成为内部 fixed/sticky 的包含块，筛选栏会整块浮在时间线上挡住卡片。改用 ScrollTrigger 的 pin 同样会翻车。正解是筛选栏留在文档流里，另做一条挂在 smooth 容器**外面**的 fixed 紧凑条。
- **数据文件必须带内容指纹**。文件名不变而内容天天换，浏览器和 CDN 会一直吃旧缓存，页面上就出现「昨天的数据配今天的日期」。`build.mjs` 会把 sha1 前缀写进 `index.html` 的 script src。
- **牛客的 `updateTime` 不等于网申开始时间**，实测比 `wangshenDate[0]` 晚 4–11 天，不能拿它当「开网申的日子」。
- **牛客拿不到岗位明细**。企业主页「职位(0)」，上游自己就没有这份数据，所以详情页诚实地展示到「方向」这一层。

## 数据来源

牛客校招日程（`/school/schedule/data`）。信息以企业官网为准，本站不收集任何个人信息。

## License

MIT
