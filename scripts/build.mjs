/**
 * 把 data/ 下的抓取产物编译成站点直接读的 site/data.js。
 *
 * 站点是纯静态的，没有运行时数据库——所有聚合（按天分组、统计、
 * 批次序号）都在这一步算完，浏览器只负责筛选和渲染。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { cstDay } from './normalize.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'data.js');
const PAGE = path.join(SITE, 'index.html');

/**
 * 给 index.html 里的 data.js 引用打上内容指纹。
 * 数据每天都变而文件名不变，不打指纹的话浏览器和 CDN 会一直吃旧缓存，
 * 页面上就会出现「昨天的数据配今天的日期」。
 */
async function stampVersion(js) {
  const hash = createHash('sha1').update(js).digest('hex').slice(0, 10);
  const html = await readFile(PAGE, 'utf8');
  const next = html.replace(/src="data\.js(\?v=[a-f0-9]+)?"/, `src="data.js?v=${hash}"`);
  if (next !== html) await writeFile(PAGE, next, 'utf8');
  return hash;
}

/** 时间线上最多铺多少天——再往前的事件价值很低，留在 data/ 里备查即可 */
const TIMELINE_DAYS = 60;

async function readJson(file, fallback) {
  const p = path.join(DATA, file);
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
}

/** 同一家公司的多个批次按网申开始时间排序，得出「第几批」 */
function batchSeq(items) {
  const byCompany = new Map();
  for (const it of items) {
    const list = byCompany.get(it.companyId) ?? [];
    list.push(it);
    byCompany.set(it.companyId, list);
  }
  const seq = {};
  for (const list of byCompany.values()) {
    list
      .slice()
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.batch - b.batch)
      .forEach((it, i) => {
        seq[it.key] = { seq: i + 1, total: list.length };
      });
  }
  return seq;
}

/** 事件的展示权重：越「有新东西」的越靠前 */
const TYPE_WEIGHT = { new: 6, open: 5, batch: 4, careers: 3, window: 2, upstream: 1, gone: 0 };

function main() {
  return Promise.all([
    readJson('companies.json', []),
    readJson('events.json', []),
    readJson('meta.json', {}),
  ]).then(async ([items, events, meta]) => {
    const now = meta.crawledAt || Date.now();
    const today = meta.today || cstDay(now);
    const seq = batchSeq(items);
    const byKey = new Map(items.map((x) => [x.key, x]));

    // 按天分组，只保留最近 TIMELINE_DAYS 天且当天确实有事件的日子
    const cutoff = cstDay(now - TIMELINE_DAYS * 86400_000);
    const dayMap = new Map();
    for (const e of events) {
      if (!e.day || e.day < cutoff) continue;
      // 上游的 updateTime 有时是未来时间（后台预排的上线时间）。
      // 时间线不能出现「明天」，一律并进今天，另用 future 标记出来。
      const day = e.day > today ? today : e.day;
      const list = dayMap.get(day) ?? [];
      list.push(e.day > today ? { ...e, day, future: true } : e);
      dayMap.set(day, list);
    }

    const days = [...dayMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, list]) => ({
        day,
        events: list
          .sort(
            (a, b) =>
              (TYPE_WEIGHT[b.type] ?? 0) - (TYPE_WEIGHT[a.type] ?? 0) ||
              (b.at ?? 0) - (a.at ?? 0),
          )
          .map((e) => {
            const full = byKey.get(e.key);
            return {
              ...e,
              // 事件快照里的字段可能是旧的，能对上当前库就用当前库的
              name: full?.name ?? e.name,
              logo: full?.logo ?? e.logo,
              ctype: full?.type ?? e.ctype ?? 'other', // 公司类型，与事件类型 type 区分开
              cats: full?.cats ?? e.cats ?? ['other'],
              cities: full?.cities ?? e.cities ?? [],
              start: full?.start ?? e.start,
              end: full?.end ?? e.end,
              batch: full?.batch ?? e.batch,
              seq: seq[e.key] ?? { seq: 1, total: 1 },
              live: !!full,
            };
          }),
      }));

    const dayCount = (n) => {
      const from = cstDay(now - (n - 1) * 86400_000);
      return days.filter((d) => d.day >= from && d.day <= today).reduce((s, d) => s + d.events.length, 0);
    };

    // 抽屉要用的完整详情，按 key 建索引
    const detail = {};
    for (const it of items) {
      detail[it.key] = {
        key: it.key,
        companyId: it.companyId,
        name: it.name,
        logo: it.logo,
        tags: it.tags,
        type: it.type,
        cats: it.cats,
        careers: it.careers,
        cities: it.cities,
        start: it.start,
        end: it.end,
        windowText: it.windowText,
        testTime: it.testTime,
        interviewTime: it.interviewTime,
        offerTime: it.offerTime,
        neituiTime: it.neituiTime,
        applyUrl: it.applyUrl,
        officalUrl: it.officalUrl,
        schedules: it.schedules,
        batch: it.batch,
        seq: seq[it.key] ?? { seq: 1, total: 1 },
      };
    }

    const payload = {
      meta: {
        crawledAt: now,
        today,
        source: '牛客校招日程',
        tracking: items.length,
        open: meta.byState?.open ?? 0,
        upcoming: meta.byState?.upcoming ?? 0,
      },
      stats: {
        today: days.find((d) => d.day === today)?.events.length ?? 0,
        d7: dayCount(7),
        d30: dayCount(30),
        tracking: items.length,
      },
      days,
      detail,
    };

    const js = `window.__OFFERYES__ = ${JSON.stringify(payload)};\n`;
    await writeFile(OUT, js, 'utf8');
    const hash = await stampVersion(js);
    const kb = (js.length / 1024).toFixed(0);
    console.log(
      `[build] site/data.js 已生成 · ${kb}KB · v=${hash} · ${days.length} 天 / ${payload.stats.tracking} 个在招批次 / 今日 ${payload.stats.today} 条`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
