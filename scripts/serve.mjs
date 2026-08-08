/** 本地预览用的极简静态服务器，只服务 site/ 目录。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SITE = path.resolve(import.meta.dirname, '..', 'site');
const PORT = Number(process.env.PORT || 8899);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  // 只允许读 site/ 内的文件，挡掉 ../ 穿越
  const file = path.join(SITE, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', // 本地调试永远拿最新的
    }).end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://127.0.0.1:${PORT}`));
