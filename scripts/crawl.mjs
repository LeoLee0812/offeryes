/**
 * 抓取牛客校招日程，产出「还活着的」秋招批次 + 每日增量事件。
 *
 * 这个脚本跑在 GitHub Actions 上（不是 Workers），所以没有 10ms CPU 限制，
 * 189 页可以一口气抓完。产物直接 commit 进仓库，站点是纯静态的。
 *
 * 用法：
 *   node scripts/crawl.mjs           # 正常抓取 + diff
 *   node scripts/crawl.mjs --dry     # 只抓不写盘，打印统计
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  classifyCareers,
  classifyCompanyType,
  normalizeCity,
  parseTags,
  cstDay,
} from './normalize.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 牛客一页 50 条。page ≥189 之后全是零字段空壳，多抓几页只是为了容错上游扩容 */
const MAX_PAGE = 200;
const CONCURRENCY = 6;
/** 事件历史保留天数——超过这个天数的旧事件不再进时间线 */
const KEEP_DAYS = 120;

async function fetchPage(page, attempt = 0) {
  const url = `https://www.nowcoder.com/school/schedule/data?page=${page}&order=0&type=0`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`code ${json.code}`);
    return json.data?.companyList ?? [];
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return fetchPage(page, attempt + 1);
    }
    console.error(`  page ${page} 抓取失败：${err.message}`);
    return null; // null 表示「这一页没拿到」，与「这一页是空的」区分开
  }
}

/** 固定并发地跑一批任务，保持结果顺序 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function crawlAll() {
  const pages = Array.from({ length: MAX_PAGE }, (_, i) => i);
  const results = await mapLimit(pages, CONCURRENCY, fetchPage);
  const failed = results.filter((r) => r === null).length;
  const raw = results.flatMap((r) => r ?? []);
  return { raw, failed };
}

/**
 * 把牛客原始记录规整成站内条目。
 *
 * ⚠️ 这里是整站最重要的一道闸：上游 9750 条里有 1100 多条零字段空壳、
 * 8200 多条早就结束的历史批次。全放进来就是上一版「15299 条截止时间未公布」的下场。
 * 只留 end===0（牛客自己标记进行中）或网申窗口还没过的。
 */
export function normalize(raw, now) {
  const seen = new Map();
  for (const c of raw) {
    const companyId = c.companyId ?? c.id;
    if (!companyId || !c.name) continue;

    const wd = Array.isArray(c.wangshenDate) && c.wangshenDate.length === 2 ? c.wangshenDate : null;
    const start = wd?.[0] || null;
    const end = wd?.[1] || null;
    const batch = c.batch || 0;

    // 闸门①：没有网申时间也没有批次号的，是纯空壳
    if (!wd && !batch) continue;
    // 闸门②：牛客标记已结束，且网申窗口也过了的，是历史批次
    const stillOpen = c.end === 0 || (end && end >= now);
    if (!stillOpen) continue;

    const key = `${companyId}-${batch}`;
    const tags = parseTags(c.tags);
    const careers = c.companyCareersStr ?? [];
    const cities = [...new Set((c.cities ?? []).map(normalizeCity).filter(Boolean))];
    // 上游更新时间：两个字段取较大者，作为「这条什么时候动过」的依据
    const upstreamAt = Math.max(c.updateTime || 0, c.wangshenUpdateTime || 0) || null;

    const schedules = (c.schedules ?? [])
      .filter((s) => s?.name || s?.content)
      .map((s) => ({ n: s.name || '', c: s.content || '', t: s.time || '', u: s.url || '' }));
    const applyUrl = schedules.find((s) => s.c === '网申' || s.n.includes('投递'))?.u || c.officalUrl || '';

    const item = {
      key,
      companyId,
      batch,
      name: String(c.name).trim(),
      logo: c.logoRadius || c.homeLogo || c.logo || '',
      tags,
      type: classifyCompanyType(c.name, tags),
      cats: classifyCareers(careers),
      careers: careers.slice(0, 40),
      cities,
      start,
      end,
      windowText: c.wangshenTime || '',
      testTime: c.testTime || '',
      interviewTime: c.interviewTime || '',
      offerTime: c.offerTime || '',
      neituiTime: c.neituiTime || '',
      applyUrl,
      officalUrl: c.officalUrl || '',
      schedules,
      important: !!c.importantCompany,
      upstreamAt,
      liveFlag: c.end === 0,
    };

    // 上游有完全重复的记录（同 companyId 同 batch 出现两次），留字段更全的那条
    const prev = seen.get(key);
    if (!prev || (item.upstreamAt || 0) > (prev.upstreamAt || 0)) seen.set(key, item);
  }
  return [...seen.values()];
}

/** 网申窗口状态：未开始 / 进行中 / 已截止 */
export function windowState(item, now) {
  if (!item.start || !item.end) return 'unknown';
  if (now < item.start) return 'upcoming';
  if (now > item.end) return 'closed';
  return 'open';
}

/**
 * 与上一版快照对比，产出事件。
 *
 * 首次运行（没有上一版）时不生成上万条「新增」——那和空壳一样没信息量。
 * 改为用上游自己的 updateTime 回填，让时间线上线当天就有真实的近三个月历史。
 */
export function diff(prevItems, items, now, todayStr, seed) {
  const events = [];
  const prevMap = new Map((prevItems ?? []).map((x) => [x.key, x]));
  // 没有上一版快照、或者事件库是空的（比如被清过），都走回填。
  // 回填只依赖当前快照里的硬事实，是幂等的，重跑不会产生脏数据。
  const isFirstRun = seed || !prevItems || prevItems.length === 0;

  for (const it of items) {
    const base = {
      key: it.key,
      companyId: it.companyId,
      name: it.name,
      logo: it.logo,
      // 公司类型叫 ctype，不能叫 type——事件对象自己的 type 是事件类型，会把它覆盖掉
      ctype: it.type,
      cats: it.cats,
      cities: it.cities,
      batch: it.batch,
      start: it.start,
      end: it.end,
    };

    if (isFirstRun) {
      // 建库首日没有「上一版」可比，但时间线不能因此是空的。
      // 用上游自带的两个硬事实回填，让页面上线当天就有真实的三个月历史：
      //   ① 网申开始日 → open 事件（「这天这家开了网申」，最有价值的一条）
      //   ② 上游最后编辑日 → upstream 事件（补充「这天这条被动过」）
      const openDay = cstDay(it.start);
      const updDay = cstDay(it.upstreamAt);
      if (openDay) {
        // 未来才开的，压到今天并标 future，页面上显示成「即将开放」
        const future = it.start > now;
        events.push({
          ...base,
          day: future ? todayStr : openDay,
          type: 'open',
          at: it.start,
          ...(future ? { future: true } : {}),
        });
      }
      if (updDay && updDay !== openDay) {
        events.push({ ...base, day: updDay, type: 'upstream', at: it.upstreamAt });
      }
      continue;
    }

    const prev = prevMap.get(it.key);
    if (!prev) {
      // 我们库里第一次见到这个 公司+批次
      const sameCompany = (prevItems ?? []).some((p) => p.companyId === it.companyId);
      events.push({ ...base, day: todayStr, type: sameCompany ? 'batch' : 'new', at: now });
      continue;
    }

    // 网申窗口今天打开——这就是「今天哪家开了网申」。
    // 两种判定都要：窗口状态翻转（我们上次见到它时还没开）、
    // 以及开始日期就是今天（有些条目我们第一次见到时窗口已经开了）。
    const flipped = windowState(prev, now) === 'upcoming' && windowState(it, now) === 'open';
    if (flipped || (it.start && cstDay(it.start) === todayStr)) {
      events.push({ ...base, day: todayStr, type: 'open', at: it.start ?? now });
    }
    // 网申时间被上游改过（延长/提前/改期）
    if ((prev.start !== it.start || prev.end !== it.end) && (it.start || it.end)) {
      events.push({
        ...base,
        day: todayStr,
        type: 'window',
        at: now,
        from: { start: prev.start, end: prev.end },
      });
    }
    // 招聘方向变多了
    if ((it.careers?.length ?? 0) > (prev.careers?.length ?? 0)) {
      events.push({
        ...base,
        day: todayStr,
        type: 'careers',
        at: now,
        added: it.careers.filter((x) => !(prev.careers ?? []).includes(x)).slice(0, 12),
      });
    }
  }

  // 从库里消失的（上游下架或已结束）
  if (!isFirstRun) {
    const nowKeys = new Set(items.map((x) => x.key));
    for (const p of prevItems) {
      if (!nowKeys.has(p.key)) {
        events.push({
          key: p.key, companyId: p.companyId, name: p.name, logo: p.logo, type: 'gone',
          ctype: p.type, cats: p.cats, cities: p.cities, batch: p.batch, start: p.start, end: p.end,
          day: todayStr, at: now,
        });
      }
    }
  }

  return events;
}

/** 合并历史事件：同一天同一条目同一类型只留一条，超过保留期的丢弃 */
export function mergeEvents(history, fresh, now) {
  const cutoff = now - KEEP_DAYS * 86400_000;
  const map = new Map();
  for (const e of [...(history ?? []), ...fresh]) {
    if ((e.at ?? 0) < cutoff && e.day < cstDay(cutoff)) continue;
    map.set(`${e.day}|${e.type}|${e.key}`, e);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : (b.at ?? 0) - (a.at ?? 0)));
}

async function readJson(file, fallback) {
  const p = path.join(DATA, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const now = Date.now();
  const todayStr = cstDay(now);

  console.log(`[offeryes] 开始抓取牛客校招日程 · ${new Date(now + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)} CST`);
  const { raw, failed } = await crawlAll();
  console.log(`  上游原始记录 ${raw.length} 条，失败页 ${failed}`);

  if (raw.length < 1000) {
    // 上游整体挂掉时宁可不写盘，也不要把好数据覆盖成空的
    console.error('  ✗ 上游返回量异常偏低，放弃本次写入');
    process.exit(1);
  }

  const items = normalize(raw, now);
  const dropped = raw.length - items.length;
  console.log(`  过滤后仍在进行中的批次 ${items.length} 条（丢弃空壳与历史批次 ${dropped} 条）`);

  const prevItems = await readJson('companies.json', null);
  const history = await readJson('events.json', []);
  const fresh = diff(prevItems, items, now, todayStr, history.length === 0);
  const events = mergeEvents(history, fresh, now);

  const byState = { open: 0, upcoming: 0, closed: 0, unknown: 0 };
  for (const it of items) byState[windowState(it, now)]++;

  const meta = {
    crawledAt: now,
    today: todayStr,
    source: 'nowcoder-school-schedule',
    rawCount: raw.length,
    itemCount: items.length,
    failedPages: failed,
    byState,
    freshEvents: fresh.length,
    todayEvents: events.filter((e) => e.day === todayStr).length,
  };

  console.log(
    `  网申进行中 ${byState.open} · 即将开放 ${byState.upcoming} · 已截止 ${byState.closed}`,
  );
  console.log(`  本次新增事件 ${fresh.length} 条，事件库共 ${events.length} 条`);

  if (dry) {
    console.log('  --dry：不写盘');
    return;
  }

  await mkdir(DATA, { recursive: true });
  await writeFile(path.join(DATA, 'companies.json'), JSON.stringify(items), 'utf8');
  await writeFile(path.join(DATA, 'events.json'), JSON.stringify(events), 'utf8');
  await writeFile(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  console.log('  ✓ 已写入 data/companies.json · data/events.json · data/meta.json');
}

// 被测试 import 时不要跑抓取，只有直接执行才启动
if (process.argv[1] && process.argv[1].endsWith('crawl.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
