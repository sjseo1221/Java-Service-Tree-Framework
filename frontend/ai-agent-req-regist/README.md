# AIAGENT 화면 목업 (SCR-01 ~ 12)

요구사항 엑셀 업로드부터 실행 · 모니터링까지 10단계 개발 프로세스와 운영 화면 4개(MAT · Knot · 서브 에이전트 · Skill), 감사 추적 화면을
백엔드 없이 mock JSON 으로 동작시키는 정적 프론트 목업이다. 외부 라이브러리 · CDN 없이 vanilla JS 와 자체 CSS 로 만들었다.
설계 근거는 `tasks/aiagent-frontend-mock/workers/claude-main/result.md`(설계서)와 `docs/file/` 의 요구사항정의서 · SRS · SDS 다.

## 실행

Node 18 이상이면 된다(의존성 설치 없음).

```bash
node frontend/ai-agent-req-regist/tools/serve.mjs          # 기본 포트 8780
node frontend/ai-agent-req-regist/tools/serve.mjs 9000     # 포트 지정
```

브라우저에서 `http://localhost:8780/` 을 연다. `index.html` 을 파일로 직접 열면 `fetch` 가 막혀 동작하지 않는다.

- `/` 는 이 폴더, `/__docs/*` 는 저장소 `docs/file/*`(SRS · SDS PDF, 원본 엑셀 양식)에 연결된다.
- 새로고침하면 mock 메모리 상태(처리 결과 · 새 세션 · 감사 기록 추가분)가 초기화된다.

검사:

```bash
node frontend/ai-agent-req-regist/tools/check-i18n.mjs     # 언어팩 키 검사(실패 시 exit 1)
```

## URL 파라미터

| 파라미터 | 값 | 설명 |
|----------|----|------|
| `sid` | `1001`(기본) · `1002` | 세션 선택 |
| `lang` | `ko`(기본) · `en` · `ja` (`jp` 도 `ja` 로 받음) | 화면 언어. 헤더 선택 상자로도 바꿀 수 있다 |
| `mockFail` | `mat` · `knot` (쉼표로 여러 개) | 해당 연동만 실패(AGT-EXT-001)시킨다. MAT 모니터링 · Knot 뷰어 영역에만 오류 카드가 뜨고 상단 플로우 · 좌측 메뉴 · 다른 화면은 정상이다 |
| `mockUnset` | `mat` · `knot` | 좌측 메뉴의 해당 항목을 "미설정"으로 비활성 표시한다 |

예: `http://localhost:8780/?sid=1001&lang=en&mockFail=mat,knot#/ops/monitor`

화면 주소(hash): `#/stage/1` ~ `#/stage/10`(상단 10단계), `#/ops/monitor` · `#/ops/knowledge` · `#/ops/agents` · `#/ops/skills`(좌측 메뉴), `#/audit?reqId=REQ-F-001`(감사 추적).

## 세션 시나리오

| 세션 | 상태 | 볼 수 있는 것 |
|------|------|---------------|
| **1001** (기본) | 1~8단계 완료 · 9 실행 진행중 · 10 대기 | 업로드 rev 1 → rev 2 변경분, 검토 2회차 처리 결과, 확정된 SRS · SDS PDF, 구현 목록 35건(제외 1 · 미배정 2), 실행 7건(성공 · 실행중 · 대기 · 실패 · 취소 · 검증 실패), MAT 작업 5건, 감사 기록 39건 |
| **1002** | 1·2 완료 · 3 검토 진행중 · 4~10 잠김 | 지적사항 전부 OPEN(High 3건 → 확정 비활성), 잠긴 단계 클릭 시 선행 조건 안내 |
| 새 세션 | 1단계 대기 | 업로드 화면의 [새 세션]으로 만든다. 파일명에 `error` 가 들어가면 오류 샘플(rev 98), 아니면 정상 rev(99)로 처리된다 |

데모 포인트:

- 실행(9단계): REQ-F-002 실행의 형상 반영은 write_scope 위반으로 전건 차단(AGT-SCOPE-001), `main` · `master` 브랜치도 차단된다.
- MAT 모니터링: `aiagent-req-f-005` 는 실패, `aiagent-req-f-007` 은 상태-로그 불일치 경고. `aiagent-req-f-003` 로그는 최근 200줄만 표시된다.
- Knot 뷰어: `knot-vault/` 실제 문서 12건. 위키 링크 `[[slug]]` 를 누르면 해당 문서로 이동한다.
- Skill 관리: `arms-backend-core` 는 실행 중 작업(REQ-F-003)이 참조하므로 비활성할 수 없다(AGT-STATE-002). `sample-unlinked-skill` 은 미연결 예시(합성 데이터).
- 에이전트 · Skill 저장: 본문에 "사용자에게 질문" · `workers_approved` 등이 있으면 검사 위반으로 저장되지 않는다. 에이전트를 비활성하면 7 · 8단계 배정 후보에서도 빠진다.
- 감사 추적: 이 화면 밖에서 처리한 상태 변경(지적 처리 · 확정 · 실행 요청 · 취소 · 비활성 등)이 메모리 기록으로 추가된다.

## 구조

```
index.html              프레임(헤더 · SCR-01 · SCR-02 · 본문) + SVG 아이콘
css/aiagent.css         색 토큰 · 레이아웃 · 컴포넌트 · 반응형(1024 · 768 · 480px)
js/aiagent-config.js    설정(mode: 'mock' | 'live', 폴링 주기 하한 5초 등)
js/core/                events · i18n · api · mock-routes · mock-server · ui · poller · markdown · router
js/aiagent-flow.js      SCR-01 상단 10단계          js/aiagent-sidemenu.js  SCR-02 좌측 메뉴
js/views/               SCR-03 ~ 12 화면
mock/                   API 응답 형식 그대로의 JSON(언어팩 · 코드 · 세션 1001 · 1002 · 운영 · 감사)
assets/templates/       새 에이전트 · Skill 템플릿
tools/                  serve.mjs(정적 서버) · check-i18n.mjs(언어팩 검사)
```

- 데이터 접근은 `AIAGENT.api.request()` 한 곳뿐이다. `aiagent-config.js` 의 `mode` 를 `'live'` 로 바꾸면 같은 경로(`/api/aiagent/...`)로 실제 API 를 호출한다.
- mock 경로 → 파일 · 핸들러 매핑은 `js/core/mock-routes.js`, 상태 변경 · 서버 판정 흉내는 `js/core/mock-server.js` 에 있다.
- 화면 문구는 모두 언어팩 키(`aiagent.` 접두어)다. 키를 추가하면 `mock/i18n/messages.{ko,en,ja}.json` 세 파일에 함께 넣고 `check-i18n.mjs` 로 확인한다.
