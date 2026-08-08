import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, diff, mergeEvents, windowState } from '../scripts/crawl.mjs';

const NOW = Date.UTC(2026, 7, 8, 4, 0); // 2026-08-08 12:00 CST
const TODAY = '2026-08-08';
const day = (d) => Date.UTC(2026, 7, d) - 8 * 3600e3; // 当天 00:00 CST

/** 构造一条上游原始记录 */
function raw(over = {}) {
  return {
    companyId: 1,
    name: '测试公司',
    batch: 1210,
    end: 0,
    wangshenDate: [day(1), day(31)],
    companyCareersStr: ['后端开发'],
    cities: ['北京'],
    tags: '["互联网"]',
    updateTime: day(7),
    schedules: [{ name: '投递链接', content: '网申', time: '即日起', url: 'https://example.com/apply' }],
    ...over,
  };
}

test('闸门①：没有网申时间也没有批次号的空壳被丢掉', () => {
  const out = normalize([raw({ wangshenDate: null, batch: 0 })], NOW);
  assert.equal(out.length, 0);
});

test('闸门②：已结束且网申窗口也过了的历史批次被丢掉', () => {
  const out = normalize([raw({ end: 1, wangshenDate: [day(-40), day(-10)] })], NOW);
  assert.equal(out.length, 0);
});

test('闸门②：标记已结束但窗口还没过的仍然保留', () => {
  const out = normalize([raw({ end: 1, wangshenDate: [day(1), day(31)] })], NOW);
  assert.equal(out.length, 1);
});

test('正常记录被规整出完整字段', () => {
  const [it] = normalize([raw()], NOW);
  assert.equal(it.key, '1-1210');
  assert.equal(it.type, 'internet');
  assert.deepEqual(it.cats, ['tech']);
  assert.deepEqual(it.cities, ['北京']);
  assert.equal(it.applyUrl, 'https://example.com/apply');
});

test('上游重复记录按 key 去重，留上游更新时间更新的那条', () => {
  const out = normalize([raw({ updateTime: day(3) }), raw({ updateTime: day(7) })], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].upstreamAt, day(7));
});

test('windowState：三种窗口状态', () => {
  assert.equal(windowState({ start: day(10), end: day(20) }, NOW), 'upcoming');
  assert.equal(windowState({ start: day(1), end: day(20) }, NOW), 'open');
  assert.equal(windowState({ start: day(1), end: day(3) }, NOW), 'closed');
  assert.equal(windowState({ start: null, end: null }, NOW), 'unknown');
});

test('首次建库：用网申开始日回填 open 事件，日期落在开始那天而不是今天', () => {
  const items = normalize([raw({ wangshenDate: [day(3), day(31)] })], NOW);
  const evts = diff(null, items, NOW, TODAY);
  const open = evts.find((e) => e.type === 'open');
  assert.ok(open, '应该产出 open 事件');
  assert.equal(open.day, '2026-08-03');
  assert.equal(open.future, undefined);
});

test('首次建库：未来才开的网申压到今天并标 future', () => {
  const items = normalize([raw({ wangshenDate: [day(20), day(40)] })], NOW);
  const open = diff(null, items, NOW, TODAY).find((e) => e.type === 'open');
  assert.equal(open.day, TODAY);
  assert.equal(open.future, true);
});

test('首次建库：上游编辑日与开始日不同才额外产一条 upstream', () => {
  const items = normalize([raw({ wangshenDate: [day(3), day(31)], updateTime: day(7) })], NOW);
  const types = diff(null, items, NOW, TODAY).map((e) => e.type).sort();
  assert.deepEqual(types, ['open', 'upstream']);

  const same = normalize([raw({ wangshenDate: [day(3), day(31)], updateTime: day(3) })], NOW);
  assert.deepEqual(diff(null, same, NOW, TODAY).map((e) => e.type), ['open']);
});

test('日常增量：库里没见过的公司算 new，同公司的新批次算 batch', () => {
  const prev = normalize([raw()], NOW);
  const nextNewCompany = normalize([raw(), raw({ companyId: 2, name: '另一家' })], NOW);
  assert.equal(diff(prev, nextNewCompany, NOW, TODAY).find((e) => e.name === '另一家').type, 'new');

  const nextNewBatch = normalize([raw(), raw({ batch: 1211 })], NOW);
  assert.equal(diff(prev, nextNewBatch, NOW, TODAY).find((e) => e.key === '1-1211').type, 'batch');
});

test('日常增量：网申时间被改过产出 window 事件，并带上旧值', () => {
  const prev = normalize([raw({ wangshenDate: [day(1), day(20)] })], NOW);
  const next = normalize([raw({ wangshenDate: [day(1), day(31)] })], NOW);
  const e = diff(prev, next, NOW, TODAY).find((x) => x.type === 'window');
  assert.equal(e.from.end, day(20));
  assert.equal(e.end, day(31));
});

test('日常增量：方向变多产出 careers 事件，只列新增的那些', () => {
  const prev = normalize([raw({ companyCareersStr: ['后端开发'] })], NOW);
  const next = normalize([raw({ companyCareersStr: ['后端开发', '产品经理'] })], NOW);
  const e = diff(prev, next, NOW, TODAY).find((x) => x.type === 'careers');
  assert.deepEqual(e.added, ['产品经理']);
});

test('日常增量：网申开始日就是今天时产出 open 事件', () => {
  const prev = normalize([raw({ wangshenDate: [day(8), day(31)] })], NOW);
  const next = normalize([raw({ wangshenDate: [day(8), day(31)] })], NOW);
  assert.ok(diff(prev, next, NOW, TODAY).some((e) => e.type === 'open'));
});

test('日常增量：上游下架的条目产出 gone，且带得上公司类型', () => {
  const prev = normalize([raw()], NOW);
  const e = diff(prev, [], NOW, TODAY).find((x) => x.type === 'gone');
  assert.equal(e.key, '1-1210');
  assert.equal(e.ctype, 'internet');
});

test('日常增量：什么都没变时不产生任何事件', () => {
  const prev = normalize([raw()], NOW);
  const next = normalize([raw()], NOW);
  assert.deepEqual(diff(prev, next, NOW, TODAY), []);
});

test('事件合并：同一天同一条目同一类型只留一条', () => {
  const e = { day: TODAY, type: 'open', key: '1-1210', at: NOW };
  const merged = mergeEvents([e], [{ ...e, name: '改过名' }], NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '改过名');
});

test('事件合并：结果按日期倒序，最新在最前', () => {
  const merged = mergeEvents(
    [
      { day: '2026-08-01', type: 'open', key: 'a', at: day(1) },
      { day: '2026-08-08', type: 'open', key: 'b', at: day(8) },
    ],
    [],
    NOW,
  );
  assert.deepEqual(merged.map((e) => e.day), ['2026-08-08', '2026-08-01']);
});

test('事件合并：超过保留期的旧事件被丢掉', () => {
  const old = { day: '2026-01-01', type: 'open', key: 'x', at: Date.UTC(2026, 0, 1) };
  assert.equal(mergeEvents([old], [], NOW).length, 0);
});
