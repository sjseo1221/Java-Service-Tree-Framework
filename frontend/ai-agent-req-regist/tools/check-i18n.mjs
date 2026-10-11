#!/usr/bin/env node
/*
 * 언어팩 키 검사(AGT-I18N-001 빌드 검사 대응). 실패 시 exit 1.
 *   node frontend/ai-agent-req-regist/tools/check-i18n.mjs
 * 1) mock/i18n/messages.{ko,en,ja}.json 키 집합 일치
 * 2) index.html · js/**.js 의 data-locale · data-locale-attr · 'aiagent.…' 리터럴 키, mock/menu.json 의 *Key 값이 ko 에 존재
 *    ('.' 으로 끝나는 리터럴은 동적 키 접두어로 보고 건너뜀)
 * 3) 동적 키: codes.json {group, code} → aiagent.code.{group}.{code}, config.errorCodes + UNKNOWN → aiagent.error.{code},
 *    단계 1~10 → aiagent.flow.stage.{n}.short/name · aiagent.flow.next.{n}, 2~10 → aiagent.flow.prereq.{n}
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['ko', 'en', 'ja'];
const problems = [];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function walk(dir, ext, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// 1) 키 집합 일치
const packs = {};
for (const lang of LANGS) packs[lang] = readJson(`mock/i18n/messages.${lang}.json`);
const koKeys = new Set(Object.keys(packs.ko));
for (const lang of LANGS) {
  if (lang === 'ko') continue;
  const keys = new Set(Object.keys(packs[lang]));
  for (const k of koKeys) if (!keys.has(k)) problems.push(`[${lang}] 키 누락: ${k}`);
  for (const k of keys) if (!koKeys.has(k)) problems.push(`[${lang}] ko 에 없는 키: ${k}`);
  for (const [k, v] of Object.entries(packs[lang])) if (typeof v !== 'string' || !v.trim()) problems.push(`[${lang}] 빈 값: ${k}`);
}
for (const [k, v] of Object.entries(packs.ko)) {
  if (!k.startsWith('aiagent.')) problems.push(`[ko] 접두어 위반: ${k}`);
  if (typeof v !== 'string' || !v.trim()) problems.push(`[ko] 빈 값: ${k}`);
}

// 2) 정적 참조
const used = new Map(); // key → 첫 출처
function use(key, where) {
  if (!key || key.endsWith('.')) return;
  if (!used.has(key)) used.set(key, where);
}

const sources = [path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'js'), '.js')];
for (const file of sources) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of src.matchAll(/data-locale="([^"]+)"/g)) use(m[1], rel);
  for (const m of src.matchAll(/data-locale-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.split(':')[1];
      if (key) use(key.trim(), rel);
    }
  }
  for (const m of src.matchAll(/['"](aiagent\.[A-Za-z0-9_.\-]+)['"]/g)) use(m[1], rel);
}
const menu = readJson('mock/menu.json');
for (const it of menu.items || []) {
  use(it.labelKey, 'mock/menu.json');
  use(it.reasonKey, 'mock/menu.json');
}

// 3) 동적 키
const codes = readJson('mock/codes.json');
for (const c of codes) use(`aiagent.code.${c.group}.${c.code}`, 'mock/codes.json');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/aiagent-config.js'), 'utf8'), sandbox);
const config = sandbox.window.AIAGENT.config;
for (const code of [...config.errorCodes, 'UNKNOWN']) use(`aiagent.error.${code}`, 'config.errorCodes');
for (const s of config.stages) {
  use(`aiagent.flow.stage.${s.no}.short`, 'config.stages');
  use(`aiagent.flow.stage.${s.no}.name`, 'config.stages');
  use(`aiagent.flow.next.${s.no}`, 'config.stages');
  if (s.no >= 2) use(`aiagent.flow.prereq.${s.no}`, 'config.stages');
}

for (const [key, where] of used) if (!koKeys.has(key)) problems.push(`[ko] 미정의 키: ${key}  (${where})`);

if (problems.length) {
  console.error(`check-i18n: 실패 ${problems.length}건`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-i18n: 통과 — 언어 ${LANGS.length}종 · 키 ${koKeys.size}개 · 참조 ${used.size}개 확인`);
