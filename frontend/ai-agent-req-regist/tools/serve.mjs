#!/usr/bin/env node
/*
 * 의존성 없는 정적 서버(Node 내장 http).
 *   node frontend/ai-agent-req-regist/tools/serve.mjs [port]   (기본 8780)
 *   /          → frontend/ai-agent-req-regist/
 *   /__docs/*  → 저장소 docs/file/* (SRS·SDS PDF, 원본 xlsx — 복사하지 않고 그대로 제공)
 * 경로는 정규화 후 루트 접두어를 검사하고, 벗어나면 403.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_ROOT = path.resolve(APP_ROOT, '..', '..', 'docs', 'file');
const PORT = Number(process.argv[2]) || 8780;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function inside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad Request');

  let root = APP_ROOT;
  let rel = pathname;
  if (pathname === '/__docs' || pathname.startsWith('/__docs/')) {
    root = DOCS_ROOT;
    rel = pathname.slice('/__docs'.length);
  }

  let file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!inside(root, file)) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
    }
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) return send(res, 404, 'Not Found');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st2.size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
});

server.listen(PORT, () => {
  console.log(`[aiagent] http://localhost:${PORT}/  (docs: /__docs/)`);
});
