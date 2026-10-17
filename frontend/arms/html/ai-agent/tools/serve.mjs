#!/usr/bin/env node
/*
 * 한산 ver2 로컬 서버(Node 내장 모듈만 사용).
 *   node frontend/arms/html/ai-agent/tools/serve.mjs [port]   (기본 8781)
 *   /           → frontend/arms/html/ai-agent/ 정적 파일
 *   /api/tree   → jstree 3 계약 get_node · get_content (조회 전용, 오류는 500 text/plain)
 *   /api/dates  → 추천 날짜 목록
 *   /api/place  → 장소 상세(기본 정보 · 점수 · 선택 날짜 추천)
 * 한산 data(HANSAN_ROOT)는 기동 때 한 번 읽기만 한다. 쓰지 않고, 정적으로 노출하지도 않는다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// APP_ROOT = <repo>/frontend/arms/html/ai-agent → 다섯 단계 위가 저장소의 상위 폴더(hansan 의 형제 위치)
const HANSAN_ROOT = path.resolve(process.env.HANSAN_ROOT || path.resolve(APP_ROOT, '..', '..', '..', '..', '..', 'hansan'));
const PORT = Number(process.argv[2]) || 8781;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"
};

function fail(msg) {
  console.error('[hansan-v2] 기동 실패: ' + msg);
  process.exit(1);
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(HANSAN_ROOT, rel), 'utf8'));
}

// ---------- 데이터 로딩 (기동 시 한 번, 읽기 전용) ----------

// 1) 시도: config/regions.yaml 의 provinces: 블록 한 줄 형식만 읽는다
const provinces = []; // [{code, name}]
try {
  const lines = fs.readFileSync(path.join(HANSAN_ROOT, 'config', 'regions.yaml'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^provinces:\s*$/.test(l));
  if (start < 0) fail('regions.yaml 에 provinces: 블록이 없습니다');
  const re = /^\s*-\s*\{\s*code:\s*"(\d{2})",\s*name:\s*([^}]+?)\s*\}/;
  for (let i = start + 1; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) break;
    provinces.push({ code: m[1], name: m[2] });
  }
} catch (e) {
  fail('regions.yaml 읽기 오류: ' + e.message);
}
if (provinces.length !== 8) fail('시도가 8개가 아닙니다: ' + provinces.length);
const provinceName = new Map(provinces.map((p) => [p.code, p.name]));

// 2) 시군구: 배열 순서가 정렬 기준
let sigunguList;
try {
  sigunguList = readJson('data/sources/regions/sigungu.json').sigungu;
  if (!Array.isArray(sigunguList)) throw new Error('sigungu 배열 없음');
} catch (e) {
  fail('sigungu.json 읽기 오류: ' + e.message);
}
const sigunguName = new Map(sigunguList.map((s) => [s.code, s.name]));

// 3) 장소: 숨김 제외
const byId = new Map();
const bySigungu = new Map(); // code → [id] (이름순)
const provinceCount = new Map();
const sigunguCount = new Map();
try {
  const all = readJson('data/places/places.json').places;
  if (!Array.isArray(all)) throw new Error('places 배열 없음');
  for (const p of all) {
    if (p.hidden === true) continue;
    const r = p.region || {};
    if (!provinceName.has(r.provinceCd) || !sigunguName.has(r.signguCd)) {
      console.warn('[hansan-v2] 지역 코드 불일치로 제외: ' + p.placeId);
      continue;
    }
    byId.set(p.placeId, p);
    if (!bySigungu.has(r.signguCd)) bySigungu.set(r.signguCd, []);
    bySigungu.get(r.signguCd).push(p.placeId);
    provinceCount.set(r.provinceCd, (provinceCount.get(r.provinceCd) || 0) + 1);
    sigunguCount.set(r.signguCd, (sigunguCount.get(r.signguCd) || 0) + 1);
  }
  for (const ids of bySigungu.values()) ids.sort((a, b) => byId.get(a).name.localeCompare(byId.get(b).name, 'ko'));
} catch (e) {
  fail('places.json 읽기 오류: ' + e.message);
}

// 4) 점수
let scores;
let scoreAsOf;
try {
  const s = readJson('data/scores/places.json');
  scores = s.places || {};
  scoreAsOf = s.asOf || null;
} catch (e) {
  fail('scores/places.json 읽기 오류: ' + e.message);
}

// 5) 날짜별 추천
const recoByDate = new Map(); // date → {asOf, itemById, candidateSet}
try {
  const dir = path.join(HANSAN_ROOT, 'data', 'recommendations');
  for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      recoByDate.set(f.slice(0, 10), {
        asOf: r.asOf || null,
        itemById: new Map((r.items || []).map((it) => [it.placeId, it])),
        candidateSet: new Set((r.candidates && r.candidates.hidden_classic) || [])
      });
    } catch (e) {
      console.warn('[hansan-v2] 추천 파일 제외: ' + f + ' (' + e.message + ')');
    }
  }
} catch (e) {
  fail('recommendations 폴더 읽기 오류: ' + e.message);
}
if (recoByDate.size === 0) fail('추천 날짜가 0개입니다');
const dates = [...recoByDate.keys()].sort();

// ---------- 응답 도우미 ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8' }, SECURITY_HEADERS, extra));
  res.end(body);
}

function sendJson(res, obj) {
  send(res, 200, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function inside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

const pick = (v) => (v === undefined ? null : v);

// ---------- /api/tree (jstree 3 계약) ----------

function nodeKind(id) {
  if (typeof id !== 'string') return null;
  if (/^prov-\d{2}$/.test(id) && provinceName.has(id.slice(5)) && provinceCount.get(id.slice(5))) return 'prov';
  if (/^sgg-\d{5}$/.test(id) && sigunguCount.get(id.slice(4))) return 'sgg';
  if (/^[\w-]+$/.test(id) && byId.has(id)) return 'place';
  return null;
}

function getNode(id) {
  if (id === '#') {
    return provinces
      .filter((p) => provinceCount.get(p.code))
      .map((p) => ({ id: 'prov-' + p.code, text: p.name + ' (' + provinceCount.get(p.code) + ')', children: true }));
  }
  const kind = nodeKind(id);
  if (kind === 'prov') {
    const cd = id.slice(5);
    return sigunguList
      .filter((s) => s.code.slice(0, 2) === cd && sigunguCount.get(s.code))
      .map((s) => ({ id: 'sgg-' + s.code, text: s.name + ' (' + sigunguCount.get(s.code) + ')', children: true }));
  }
  if (kind === 'sgg') {
    return bySigungu.get(id.slice(4)).map((pid) => ({ id: pid, text: byId.get(pid).name, children: false, icon: 'jstree-file' }));
  }
  if (kind === 'place') return [];
  throw new HttpError(500, 'Invalid id: ' + id);
}

function getContent(id) {
  if (typeof id === 'string' && id.indexOf(':') >= 0) return { content: 'Multiple selected' };
  const kind = nodeKind(id);
  if (kind === 'prov') return { content: provinceName.get(id.slice(5)) };
  if (kind === 'sgg') {
    const cd = id.slice(4);
    return { content: provinceName.get(cd.slice(0, 2)) + '/' + sigunguName.get(cd) };
  }
  if (kind === 'place') {
    const p = byId.get(id);
    return { content: provinceName.get(p.region.provinceCd) + '/' + sigunguName.get(p.region.signguCd) + '/' + p.name };
  }
  throw new HttpError(500, 'Invalid id: ' + id);
}

function apiTree(q) {
  const op = q.get('operation');
  const id = q.get('id');
  if (op === 'get_node') return getNode(id);
  if (op === 'get_content') return getContent(id);
  throw new HttpError(500, 'Unsupported operation: ' + op);
}

// ---------- /api/dates ----------

function todayKst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function apiDates() {
  const today = todayKst();
  let def = dates.indexOf(today) >= 0 ? today : dates.find((d) => d > today);
  if (!def) def = dates[dates.length - 1];
  return { dates: dates, today: today, defaultDate: def };
}

// ---------- /api/place ----------

function apiPlace(q) {
  const id = q.get('id');
  const date = q.get('date');
  if (!id || !/^[\w-]+$/.test(id) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Bad Request');
  const p = byId.get(id);
  if (!p) throw new HttpError(404, 'Not Found: place');
  const reco = recoByDate.get(date);
  if (!reco) throw new HttpError(404, 'Not Found: date');

  const op = p.operation;
  const place = {
    id: p.placeId,
    name: p.name,
    address: pick(p.address),
    provinceCd: p.region.provinceCd,
    provinceName: provinceName.get(p.region.provinceCd),
    signguCd: p.region.signguCd,
    signgu: sigunguName.get(p.region.signguCd),
    category: pick(p.category),
    indoor: pick(p.indoor),
    operation: op ? { rest: pick(op.rest), hours: pick(op.hours), updatedAt: pick(op.updatedAt) } : null,
    stale: p.stale === true,
    staleSince: pick(p.staleSince),
    lastSeenAt: pick(p.lastSeenAt)
  };

  const s = scores[id];
  const score = s
    ? {
        asOf: scoreAsOf,
        popularity: pick(s.popularity),
        popularityBasis: pick(s.popularityBasis),
        searchPct: pick(s.searchPct),
        blogPct: pick(s.blogPct),
        navPct: pick(s.navPct),
        navRank: pick(s.navRank),
        trend: pick(s.trend),
        longTerm: pick(s.longTerm),
        patternLabel: pick(s.patternLabel),
        patternBasis: pick(s.patternBasis)
      }
    : null;

  const it = reco.itemById.get(id);
  let status = 'none';
  let item = null;
  if (it) {
    status = 'recommended';
    item = {
      forecast: pick(it.forecast),
      usual: pick(it.usual),
      likelihood: pick(it.likelihood),
      types: Array.isArray(it.types) ? it.types.slice() : [],
      representative: pick(it.representative),
      beta: it.beta === true,
      slot: it.slot ? { start: pick(it.slot.start), end: pick(it.slot.end), quietToPeak: pick(it.slot.quietToPeak) } : null,
      reason: pick(it.reason),
      reasonMethod: pick(it.reasonMethod)
    };
  } else if (reco.candidateSet.has(id)) {
    status = 'candidate';
  }

  return { date: date, place: place, score: score, recommendation: { asOf: reco.asOf, status: status, item: item } };
}

// ---------- 정적 파일 ----------

function serveStatic(req, res, pathname) {
  let file = path.resolve(APP_ROOT, '.' + path.posix.normalize('/' + pathname));
  if (!inside(APP_ROOT, file)) return send(res, 403, 'Forbidden');
  // 화면에 필요 없는 도구 소스·문서는 내보내지 않는다
  if (inside(path.join(APP_ROOT, 'tools'), file) || path.extname(file).toLowerCase() === '.md') return send(res, 404, 'Not Found');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) return send(res, 404, 'Not Found');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': st2.size }, SECURITY_HEADERS));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
    });
  });
}

// ---------- 라우팅 ----------

const API = { '/api/tree': apiTree, '/api/dates': apiDates, '/api/place': apiPlace };

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'Bad Request');
    }
    if (pathname.includes('\0')) return send(res, 400, 'Bad Request');

    const handler = API[pathname];
    if (!handler) return serveStatic(req, res, pathname);
    try {
      return sendJson(res, handler(url.searchParams));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.message);
      throw e;
    }
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    if (!res.headersSent) send(res, 500, 'Internal Error');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    '[hansan-v2] http://' + HOST + ':' + PORT + '/  HANSAN_ROOT=' + HANSAN_ROOT + '  장소 ' + byId.size + '건 · 날짜 ' + dates.length + '개'
  );
});
