#!/usr/bin/env node
/*
 * 언어팩 키 검사. 실패 시 exit 1.
 *   node frontend/arms/html/ai-agent/tools/check-i18n.mjs
 * 1) locales/ko.json · en.json 평탄화 키 집합 일치, 빈 값 없음, 접두어 hansan.
 * 2) index.html 의 data-locale 값, js/*.js 의 hansanT("hansan.…") 리터럴(따옴표 종류 무관) 키가 ko 에 존재
 *    ('.' 으로 끝나는 리터럴은 동적 키 접두어로 보고 건너뜀)
 * 3) 동적 키: type 6×(label·desc), category 8, indoor 3, likelihood 3, weekday 0~6, pattern 2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['ko', 'en'];
const problems = [];

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const packs = {};
for (const lang of LANGS) {
  try {
    packs[lang] = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang + '.json'), 'utf8')), '', {});
  } catch (e) {
    problems.push(`[${lang}] 파싱 실패: ${e.message}`);
    packs[lang] = {};
  }
}

// 1) 키 집합 일치 · 빈 값 · 접두어
const koKeys = new Set(Object.keys(packs.ko));
for (const lang of LANGS) {
  for (const [k, v] of Object.entries(packs[lang])) {
    if (!k.startsWith('hansan.')) problems.push(`[${lang}] 접두어 위반: ${k}`);
    if (typeof v !== 'string' || !v.trim()) problems.push(`[${lang}] 빈 값: ${k}`);
  }
  if (lang === 'ko') continue;
  const keys = new Set(Object.keys(packs[lang]));
  for (const k of koKeys) if (!keys.has(k)) problems.push(`[${lang}] 키 누락: ${k}`);
  for (const k of keys) if (!koKeys.has(k)) problems.push(`[${lang}] ko 에 없는 키: ${k}`);
}

// 2) 정적 참조
const used = new Map(); // key → 첫 출처
function use(key, where) {
  if (!key || key.endsWith('.')) return;
  if (!used.has(key)) used.set(key, where);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/data-locale="([^"]+)"/g)) use(m[1], 'index.html');

const jsDir = path.join(ROOT, 'js');
for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/hansanT\(\s*(["'])(hansan\.[^"']*)\1/g)) use(m[2], 'js/' + f);
}

// 3) 동적 키
const TYPES = ['timing_game', 'famous_spot', 'moderate_hotspot', 'time_slot', 'hidden_classic', 'early_hotspot'];
const CATEGORIES = ['nature_park', 'heritage', 'exhibition', 'theme_park', 'festival', 'leisure_sports', 'street_market', 'walking_trail'];
for (const t of TYPES) {
  use(`hansan.type.${t}.label`, 'dynamic:type');
  use(`hansan.type.${t}.desc`, 'dynamic:type');
}
for (const c of CATEGORIES) use(`hansan.category.${c}`, 'dynamic:category');
for (const v of ['indoor', 'outdoor', 'mixed']) use(`hansan.indoor.${v}`, 'dynamic:indoor');
for (const v of ['high', 'medium', 'low']) use(`hansan.likelihood.${v}`, 'dynamic:likelihood');
for (let i = 0; i < 7; i++) use(`hansan.weekday.${i}`, 'dynamic:weekday');
for (const v of ['measured', 'estimated']) use(`hansan.pattern.${v}`, 'dynamic:pattern');

for (const [key, where] of used) if (!koKeys.has(key)) problems.push(`[ko] 미정의 키: ${key}  (${where})`);

if (problems.length) {
  console.error(`check-i18n: 실패 ${problems.length}건`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-i18n: 통과 — 언어 ${LANGS.length}종 · 키 ${koKeys.size}개 · 참조 ${used.size}개 확인`);
