# 한산 ver2 — jstree 지역·장소 탐색 화면

한산 data(`hansan/data`)를 **읽기 전용**으로 쓰는 화면입니다. 시도 → 시군구 → 장소를 jstree 3.3.3 트리로 lazy load 하고,
고른 장소의 기본 정보·점수·선택 날짜 추천을 상세 패널에 보여 줍니다. 설계 정본은
`tasks/hansan-v2-jstree/workers/claude-main/result.md` 입니다.

## 실행

```bash
node frontend/arms/html/ai-agent/tools/serve.mjs [port]     # 기본 8781, 127.0.0.1 에만 바인딩
# → http://127.0.0.1:8781/
node frontend/arms/html/ai-agent/tools/check-i18n.mjs       # 언어팩 키 검사, 실패 시 exit 1
```

- 한산 저장소 위치: 환경변수 `HANSAN_ROOT`, 없으면 이 저장소의 형제 폴더 `../hansan`.
- 데이터는 기동 때 한 번만 읽습니다. 한산 data 가 바뀌면 서버를 다시 시작하세요.
- Node 내장 모듈만 씁니다(npm 설치 없음).

## URL 파라미터

| 파라미터 | 값 | 기본 |
|---|---|---|
| `lang` | `ko` · `en` (그 밖의 값은 ko) | `ko` |
| `date` | `/api/dates` 목록에 있는 `YYYY-MM-DD` (목록 밖 값은 무시) | 오늘(KST), 없으면 이후 첫 날짜, 없으면 마지막 날짜 |

## API (모두 GET, 조회 전용)

| 경로 | 응답 |
|---|---|
| `/api/tree?operation=get_node&id=` | jstree 3 계약. `#` → 시도 8개, `prov-{2}` → 시군구, `sgg-{5}` → 장소(`children:false`), 장소 → `[]` |
| `/api/tree?operation=get_content&id=` | `{content:"시도/시군구/장소"}` |
| `/api/tree` 그 밖의 operation · 잘못된 id | 500 `text/plain` (`Unsupported operation: …` / `Invalid id: …`) |
| `/api/dates` | `{dates[], today, defaultDate}` |
| `/api/place?id=&date=` | `{date, place, score\|null, recommendation{asOf,status,item\|null}}`. 400 형식 오류, 404 `Not Found: place` / `Not Found: date` |

- 404 본문 `Not Found: date` 는 화면이 "이 날짜 자료 없음" 문구를 고르는 기준이라 바꾸면 `js/hansan-tree.js` 도 함께 바꿉니다.
- 서버는 `127.0.0.1` 전용 로컬 도구입니다. `tools/`·`*.md` 는 내보내지 않습니다.
- 언어를 바꿔도 장소명·주소·시도·시군구 이름은 데이터 원문(한국어) 그대로입니다. 바뀌는 것은 화면 문구뿐입니다.

## 파일

- `index.html` 화면 셸(위젯 마크업, 인라인 스크립트 없음) · `css/hansan-tree.css`
- `js/hansan-api.js` 데이터 접근 한 곳(`hansanApi.*`) · `js/hansan-locale.js` 언어팩(`hansanSetLocale`, `hansanT`) · `js/hansan-tree.js` 페이지 스크립트(`execDocReady`)
- `locales/ko.json` · `en.json` 중첩 JSON, 점 표기 키 `hansan.*`
- `tools/serve.mjs` · `tools/check-i18n.mjs`

## vendor 출처·라이선스 (원본에서 복사만, 수정 없음)

| 파일 | 원본 (`C:\dev\jstree-3.3.3\jstree-3.3.3\`) | 라이선스 |
|---|---|---|
| `vendor/jquery/jquery-1.11.0.min.js` | `demo/filebrowser/data/root/assets/dist/libs/jquery.js` (jQuery v1.11.0) | MIT (jquery.org/license) |
| `vendor/bootstrap/css/bootstrap.min.css` | `demo/filebrowser/data/root/assets/bootstrap/css/bootstrap.min.css` (Bootstrap **v3.0.2**) | **Apache-2.0** (머리말 유지. MIT 전환은 3.1부터) |
| `vendor/jstree/jstree.min.js`, `themes/default/*` | `dist/` (jsTree v3.3.3) | MIT (`vendor/jstree/LICENSE-MIT`) |

Bootstrap glyphicon 폰트는 쓰지 않아 복사하지 않았습니다.

## 이식 메모 (A-RMS Frontend-Web 으로 옮길 때)

- 위젯 마크업을 `arms/html/{page}/content-container.html` 로, `js/hansan-tree.js` 를 `arms/js/{page}.js` 로 옮기고
  마지막 줄 `$(execDocReady);` 는 지웁니다(common.js 가 호출).
- `hansanSetLocale`·`hansanT` 는 common.js `setLocale` + `data-locale` 로 바꿉니다.
- A-RMS 는 jQuery 3 · jstree pre1.0 입니다. 이 화면은 jQuery 1.11 · jstree 3.3.3 이라 트리 계약이 다릅니다
  (`.claude/skills/jstree-nested-set/references/ajax-contract.md` §3). 이식 시 contract-reviewer 로 양쪽을 대조하세요.
- Bootstrap 3.0.2 에는 `.container-fluid` 가 없어 `css/hansan-tree.css` 에서 여백을 보정했습니다. lightblue4 로 옮기면 지워도 됩니다.
- CSP(`default-src 'self'`) 때문에 jstree `core.worker: false` 로 둡니다(기본값은 blob: Web Worker).
- 검색(jstree `search` 플러그인)은 서버 `operation=search` 계약 확장이 필요해 넣지 않았습니다.
