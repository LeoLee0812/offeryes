/**
 * 当天增量日报。跑在 GitHub Actions 上，抓取完成后调用。
 *
 * 只在当天确实有动静时才发——没有新东西还硬发一封空邮件，
 * 收几次就被划进垃圾箱了。
 *
 * 需要环境变量：RESEND_API_KEY、DIGEST_TO（收件人，逗号分隔）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE_URL = 'https://offeryes.leolee0812.site';
const FROM = 'OfferYes 秋招雷达 <claude@saveme505.help>';

const LABEL = {
  new: '新收录',
  batch: '开新批次',
  open: '网申开放',
  window: '时间调整',
  careers: '新增方向',
  upstream: '信息更新',
  gone: '已下架',
};
/** 邮件里按这个顺序分组，信息价值高的排前面 */
const ORDER = ['open', 'new', 'batch', 'careers', 'window', 'gone', 'upstream'];

const fmt = (ts) => {
  if (!ts) return '时间未公布';
  const d = new Date(ts + 8 * 3600e3);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.DIGEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!key || !to.length) {
    console.log('[digest] 未配置 RESEND_API_KEY / DIGEST_TO，跳过');
    return;
  }

  const meta = JSON.parse(await readFile(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  const events = JSON.parse(await readFile(path.join(ROOT, 'data', 'events.json'), 'utf8'));
  const today = meta.today;
  const todays = events.filter((e) => e.day === today);

  if (!todays.length) {
    console.log(`[digest] ${today} 没有新增动态，不发邮件`);
    return;
  }

  const groups = ORDER.map((type) => ({ type, list: todays.filter((e) => e.type === type) })).filter(
    (g) => g.list.length,
  );

  const headline = groups
    .map((g) => `${LABEL[g.type]} ${g.list.length}`)
    .join(' · ');

  const sections = groups
    .map((g) => {
      const rows = g.list
        .slice(0, 25)
        .map(
          (e) => `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #1e2f3c;color:#e8f1f5;font-size:14px">${esc(e.name)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #1e2f3c;color:#7c93a3;font-size:13px;white-space:nowrap">${fmt(e.start)} – ${fmt(e.end)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #1e2f3c;color:#7c93a3;font-size:13px">${esc((e.cities || []).slice(0, 3).join(' / ') || '—')}</td>
          </tr>`,
        )
        .join('');
      const more = g.list.length > 25 ? `<div style="color:#4a5f6e;font-size:12px;padding:6px 10px">还有 ${g.list.length - 25} 条，去站上看全部</div>` : '';
      return `<div style="margin:22px 0 0">
        <div style="color:#3ddc97;font-size:13px;font-weight:700;letter-spacing:.5px;padding:0 0 8px">
          ${LABEL[g.type]} · ${g.list.length} 条
        </div>
        <table style="width:100%;border-collapse:collapse;background:#111c25;border:1px solid #1e2f3c;border-radius:10px;overflow:hidden">${rows}</table>
        ${more}
      </div>`;
    })
    .join('');

  const html = `<div style="background:#080d12;padding:26px 18px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
    <div style="max-width:640px;margin:0 auto">
      <div style="color:#3ddc97;font-size:12px;letter-spacing:2px;text-transform:uppercase">OfferYes 秋招雷达 · ${today}</div>
      <h1 style="color:#e8f1f5;font-size:22px;margin:10px 0 4px">今天有 ${todays.length} 条动静</h1>
      <div style="color:#7c93a3;font-size:14px">${esc(headline)}</div>
      <div style="color:#4a5f6e;font-size:12px;margin-top:6px">
        当前在招批次 ${meta.itemCount} 个（网申进行中 ${meta.byState?.open ?? 0}）
      </div>
      ${sections}
      <a href="${SITE_URL}" style="display:inline-block;margin-top:24px;background:#3ddc97;color:#05140d;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;text-decoration:none">打开时间线</a>
      <div style="color:#4a5f6e;font-size:11px;margin-top:22px;line-height:1.8">
        数据来源：牛客校招日程 · 只统计仍在进行中的批次<br>信息以企业官网为准
      </div>
    </div>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to,
      subject: `秋招雷达 ${today}：${todays.length} 条动静 · ${headline}`,
      html,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`[digest] 发送失败 ${res.status} ${body}`);
    process.exit(1);
  }
  console.log(`[digest] 已发送给 ${to.join(', ')} · ${body}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
