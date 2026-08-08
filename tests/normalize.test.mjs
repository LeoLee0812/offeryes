import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOne,
  classifyCareers,
  classifyCompanyType,
  normalizeCity,
  parseTags,
  cstDay,
} from '../scripts/normalize.mjs';

test('岗位方向分类：规则顺序敏感', () => {
  // tech 必须排在 product 前面，否则「产品开发工程师」会被误判成产品岗
  assert.equal(classifyOne('产品开发工程师'), 'tech');
  // design 必须排在 operation 前面，否则「用户研究设计」会被误判成运营
  assert.equal(classifyOne('用户研究设计'), 'design');
  assert.equal(classifyOne('游戏策划'), 'product');
  assert.equal(classifyOne('电商运营'), 'operation');
  assert.equal(classifyOne('品牌营销'), 'market');
  assert.equal(classifyOne('人力资源'), 'function');
});

test('岗位方向分类：认不出来的一律 other，绝不猜成 tech', () => {
  assert.equal(classifyOne('乘务员'), 'other');
  assert.equal(classifyOne(''), 'other');
  assert.deepEqual(classifyCareers([]), ['other']);
});

test('岗位方向分类：一组方向去重', () => {
  const got = classifyCareers(['后端开发', '前端开发', '产品经理']);
  assert.deepEqual([...got].sort(), ['product', 'tech']);
});

test('公司类型：国企名 > 外企名 > 行业标签的判定顺序', () => {
  assert.equal(classifyCompanyType('中国人民保险', ['金融']), 'soe');
  assert.equal(classifyCompanyType('某某研究所', []), 'soe');
  assert.equal(classifyCompanyType('阿斯利康', []), 'foreign');
  assert.equal(classifyCompanyType('某某科技', ['互联网']), 'internet');
  assert.equal(classifyCompanyType('某某厂', ['机械制造']), 'other');
});

test('城市归一：带后缀与带区县都归到主城市', () => {
  assert.equal(normalizeCity('北京市'), '北京');
  assert.equal(normalizeCity('深圳-南山'), '深圳');
  assert.equal(normalizeCity('嘉兴'), '嘉兴'); // 非具名城市原样保留
  assert.equal(normalizeCity(''), null);
});

test('tags 解析：牛客给的是 JSON 字符串，坏数据要退化成空数组', () => {
  assert.deepEqual(parseTags('["互联网","游戏"]'), ['互联网', '游戏']);
  assert.deepEqual(parseTags('不是 json'), []);
  assert.deepEqual(parseTags(null), []);
  assert.deepEqual(parseTags(['已经是数组']), ['已经是数组']);
});

test('cstDay：按东八区切天，不受运行机器时区影响', () => {
  // 2026-08-08 00:30 CST = 2026-08-07 16:30 UTC，必须算成 08-08
  assert.equal(cstDay(Date.UTC(2026, 7, 7, 16, 30)), '2026-08-08');
  // 2026-08-07 23:30 CST = 2026-08-07 15:30 UTC，还算 08-07
  assert.equal(cstDay(Date.UTC(2026, 7, 7, 15, 30)), '2026-08-07');
  assert.equal(cstDay(0), null);
});
