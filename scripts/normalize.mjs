/**
 * 归一化规则：把牛客的自由文本字段映射成站内可筛选的枚举。
 *
 * 这套规则是纯函数、零依赖、可单测的——不用 LLM，因为它要在
 * GitHub Actions 里每天跑两次，必须可解释、结果稳定、零成本。
 */

/** 岗位方向的 7 个类别。⚠️ 规则顺序敏感：每条文本只归入第一个命中的类别。 */
const CATEGORY_RULES = [
  // tech 必须排在 product 前面——「产品开发工程师」应判为 tech
  [
    'tech',
    /开发|工程师|算法|测试|运维|后端|前端|客户端|服务端|全栈|数据|安全|网络工程|硬件|嵌入式|芯片|软件|机器学习|深度学习|人工智能|大模型|技术|研发|架构|java|python|golang|c\+\+|ios|android|sre|devops|qa|it/i,
  ],
  // design 必须排在 operation 前面——「用户研究设计」应判为 design
  ['design', /设计|视觉|交互|美术|原画|ui|ue|ux|动效|插画/i],
  ['product', /产品|游戏策划|策划/i],
  ['operation', /运营|内容|编辑|客服|电商|主播|直播/i],
  [
    'market',
    /市场|营销|销售|商务|品牌|公关|广告|商业化|增长|投资|融资|投融资|风控|金融|证券|银行|保险|渠道/i,
  ],
  [
    'function',
    /人事|人力|hr|财务|会计|法务|行政|职能|审计|采购|供应链|物流|秘书|翻译|培训/i,
  ],
];

/** 单条方向文本 → 类别；未命中一律 other，绝不猜成 tech */
export function classifyOne(career) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(career)) return category;
  }
  return 'other';
}

/** 一组方向文本 → 去重后的类别列表。空输入返回 ['other'] */
export function classifyCareers(careers) {
  if (!careers || careers.length === 0) return ['other'];
  const seen = new Set();
  for (const c of careers) seen.add(classifyOne(c));
  return [...seen];
}

/** 行业标签 → 互联网系 */
const INTERNET_TAGS = new Set([
  '互联网',
  '互联网综合',
  '游戏',
  '电商',
  '社交',
  '视频直播',
  '文娱内容',
  '企业服务',
  '人工智能',
  '数据服务',
  '信息安全',
  '消费生活',
]);

/** 国企央企的公司名特征 */
const SOE_NAME =
  /^中国|^国家|^中共|^中铁|^中建|^中交|^中冶|^中核|^中船|^中航|^中电|^中粮|^中储|^中远|^中石油|^中石化|^中海油|国家电网|南方电网|铁路局|烟草|人民银行|工商银行|农业银行|中国银行|建设银行|交通银行|邮政|航天科技|航天科工|兵器工业|电子科技集团|研究院|研究所/;

/** 知名外企（中文名或音译名） */
const FOREIGN_NAME =
  /微软|谷歌|苹果|亚马逊|特斯拉|英特尔|英伟达|高通|博世|西门子|飞利浦|宝洁|联合利华|欧莱雅|雀巢|辉瑞|阿斯利康|罗氏|拜耳|三星|索尼|丰田|本田|大众汽车|奔驰|宝马|麦肯锡|德勤|普华永道|安永|毕马威|摩根|高盛|汇丰|渣打|花旗|基恩士|MPS|欧姆龙/;

export function classifyCompanyType(name, tags) {
  const t = tags || [];
  if (SOE_NAME.test(name) || t.includes('国企') || t.includes('央企')) return 'soe';
  if (FOREIGN_NAME.test(name) || t.includes('外企')) return 'foreign';
  if (t.some((x) => INTERNET_TAGS.has(x))) return 'internet';
  return 'other';
}

/** 首页筛选栏里露出的目标城市，其余归入「其他城市」 */
export const TOP_CITIES = [
  '北京', '上海', '深圳', '杭州', '广州', '成都', '南京', '武汉',
  '西安', '苏州', '天津', '长沙', '合肥', '重庆', '青岛', '大连',
  '厦门', '郑州',
];

/** 城市名归一：「北京市」「北京-海淀」都算北京 */
export function normalizeCity(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  for (const c of TOP_CITIES) {
    if (s.startsWith(c)) return c;
  }
  return s.replace(/市$/, '') || null;
}

/** 牛客的 tags 是 JSON 字符串，解析失败时退化为空数组 */
export function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 把毫秒时间戳转成东八区的 YYYY-MM-DD（站点所有「天」都以 CST 为准） */
export function cstDay(ms) {
  if (!ms) return null;
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
