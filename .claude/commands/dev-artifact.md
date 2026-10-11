---
description: A-RMS 모듈(·도메인) 소스를 근거로 개발 산출물(요구사항정의서·SRS·SDS·API 정의서·테이블 정의서·단위테스트 케이스)을 Markdown 으로 생성한다
argument-hint: "<module> [domain] [--type req,srs,sds,api,table,test|all] [--task <name>] [--repo <path>] [--dry-run]"
allowed-tools: Read, Write, Edit, Glob, Grep, Skill, Agent, Bash(ls:*), Bash(find:*), Bash(cat:*), Bash(sed:*), Bash(wc:*), Bash(date:*), Bash(mkdir:*), Bash(cp:*), Bash(git -C:*), Bash(bash _shared/reentry-check.sh:*), AskUserQuestion
---

# Dev Artifact — 개발 산출물 생성

지정한 모듈(·도메인)의 **실제 소스를 근거로** 개발 산출물을 Markdown 으로 만들어
`tasks/<task>/artifacts/` 에 둔다. 사용자 입력: `$ARGUMENTS`

산출물은 외부 repo 를 건드리지 않는다(분석·문서화 작업 — CLAUDE.md Task Lifecycle 3).
소스는 **읽기만** 한다.

---

## 1. 파라미터

### 1.1 필수

| 파라미터 | 설명 |
|----------|------|
| `<module>` | 대상 모듈 별칭. 아래 §1.3 표의 왼쪽 값 중 하나 |

`<module>` 이 없거나 표에 없는 값이면 **묻지 말고** 허용 값 목록을 한 줄로 안내하고 종료한다.

### 1.2 선택 (미지정 시 기본값으로 진행하고 §7 보고에 전부 명시)

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `[domain]` | 없음 (모듈 전체) | 도메인·패키지 범위. 예) `reqadd` · `pdservice` · `wiki` · `aichat`. 모듈 소스에서 Glob 으로 실제 패키지·디렉터리를 찾아 범위를 좁힌다. 찾지 못하면 중단하고 후보를 보고한다 |
| `--type <list>` | `all` | `req` · `srs` · `sds` · `api` · `table` · `test` 를 `,` 로 구분. `all` = 6종 전부 |
| `--task <name>` | `dev-artifact-<module>[-<domain>]-<YYYYMMDD>` | 작업 폴더명 |
| `--repo <path>` | 워크스페이스 루트 하위 `Java-Service-Tree-Framework-<Module>/` | 모듈 저장소 경로 재지정 |
| `--dry-run` | off | 파일을 쓰지 않고 범위·근거 파일·생성 예정 목차만 출력 |

### 1.3 모듈 별칭 → 저장소 · 규약 스킬 · 도메인 에이전트

| `<module>` | 저장소 디렉터리 | 먼저 읽을 스킬 | 도메인 에이전트 |
|------------|----------------|---------------|----------------|
| `backend` | `Java-Service-Tree-Framework-Backend-Core` | `arms-backend-core` | `backend-expert` / DB 는 `database-expert` |
| `middleproxy` | `Java-Service-Tree-Framework-Middle-Proxy` | `middleproxy-expert` | `middleproxy-expert` |
| `engine` | `Java-Service-Tree-Framework-Engine-Fire` | `engine-expert` | `engine-expert` |
| `broker` | `Java-Service-Tree-Framework-Broker-Hub` | `broker-expert` | `broker-expert` |
| `config` | `Java-Service-Tree-Framework-Global-Config` | `config-expert` | `config-expert` |
| `ai` | `Java-Service-Tree-Framework-AI` | `ai-expert` | `ai-expert` |
| `frontend` | `Java-Service-Tree-Framework-Frontend-Web` | `arms-frontend-web` | `frontend-expert` |

모듈 저장소는 이 워크스페이스에 **중첩된 별개 git 저장소**다. `.gitignore` 대상이라 clone 직후에는 없을 수 있다.

### 1.4 모듈별 산출물 적용 범위

모듈 성격상 맞지 않는 산출물은 **대체 형태**로 만든다. 억지로 RDB 형식에 끼워 넣지 말 것.

| 모듈 | `api` 정의서 근거 | `table` 정의서 근거 |
|------|-------------------|--------------------|
| backend | `@Controller`/`@RestController` 매핑 + 상속 엔드포인트(TreeAbstractController) | Flyway `V*.sql` · 엔티티 · `DynamicDBMakerDao.xml`(동적 테이블) |
| middleproxy | WebFlux 컨트롤러 + 게이트웨이 라우트·`pathMatchers` | **Redis 키 정의서** (`@RedisHash`·`@RedisEntity`·키 패턴·TTL) |
| engine | 컨트롤러 엔드포인트 | **OpenSearch 인덱스 정의서** (`@ElasticSearchIndex`·롤링 인덱스·필드 매핑) |
| broker | **STOMP 채널 정의서** (`@MessageMapping`·구독 토픽) | **Redis 키 정의서** |
| config | 컨트롤러·웹훅 엔드포인트 | 해당 없음 — 설정 파일 목록(yml·스케줄 정의)으로 대체 |
| ai | 컨트롤러 엔드포인트 + `@Tool` 목록 | **벡터 인덱스 정의서** (VectorStore 인덱스·메타데이터 필드) |
| frontend | **화면 → 호출 엔드포인트 정의서** (AJAX URL·메서드·파라미터) | 해당 없음 — 화면 목록(`template.html?page=`)으로 대체 |

"해당 없음"은 대체 문서를 만들고, 그 사실을 문서 첫 줄에 적는다.

---

## 2. 착수 전 게이트 (하나라도 실패하면 생성하지 않고 보고)

```
① 저장소 존재   : --repo 또는 §1.3 경로가 실제 디렉터리인가
                  → 없으면 중단. "모듈 저장소가 워크스페이스에 없다 — clone 하거나 --repo 로 경로를 달라" 안내
② 스킬 로드     : §1.3 의 스킬을 Skill 도구로 읽었는가 (읽지 않고 추측으로 쓰지 않는다)
③ 도메인 범위   : [domain] 이 있으면 실제 패키지·디렉터리가 존재하는가
④ 작업 폴더     : tasks/<task>/ 가 이미 있는가
                  → 있으면 덮어쓰지 않는다. `bash _shared/reentry-check.sh tasks/<task>` 로 상태를 보고
                    재개(같은 폴더에 누락 산출물만 추가)인지 새 이름인지 AskUserQuestion 으로 확인
                  → 다른 작업의 후속이면 _shared/orchestrator-rules.md §3 새 작업 폴더 생성 게이트 적용
⑤ 형상 기준점   : git -C <repo> rev-parse --short HEAD 와 브랜치를 기록할 수 있는가 (모든 문서 머리에 넣는다)
```

---

## 3. 작업 폴더 준비 (CLAUDE.md Task Lifecycle)

1. `tasks/<task>/` 에 `task.md`(`_templates/task.md` 형식 그대로 — `## 메타` yaml 펜스, frontmatter 금지) ·
   `context.md`(≤1500자) · `log.md`(`_templates/log.md`) · `artifacts/` 생성.
2. `task.md`
   - Goal: `<module>[/<domain>] 개발 산출물(<type 목록>) Markdown 생성`
   - Constraints: `write_scope: tasks-only` · 소스 읽기 전용 · 근거 없는 내용 작성 금지
   - `workers_approved: []` — 이 command 는 **워커를 부르지 않는다**(Orchestrator 직접 — engineer·multimodal 슬롯).
3. `log.md` 에 `[DECISION]` 으로 범위·type·저장소 HEAD 를 남긴다.

모듈 전체를 대상으로 해서 읽을 파일이 많으면 `Explore` 에이전트나 §1.3 의 도메인 에이전트로
**읽기 전용 탐색**을 맡길 수 있다(둘 다 승인 게이트 비대상). 이때 결과는 근거 경로 목록으로 받는다.
`claude-main` · `claude-reviewer` 는 사용자가 요청할 때만 승인 절차를 거쳐 쓴다.

---

## 4. 생성 순서와 추적 ID

`all` 이면 아래 순서로 만든다. 앞 문서의 ID 를 뒤 문서가 참조해 추적성을 이어간다.
일부 type 만 요청됐으면 그 문서만 만들고, 참조할 상위 문서가 없으면 `(상위 문서 미생성)` 으로 둔다.

```
req → srs → sds → api · table → test
```

| ID 체계 | 정의 문서 | 형식 |
|---------|-----------|------|
| 요구사항 | req | `REQ-{F\|NF\|IF\|DA\|SE}-{NNN}` (요구사항정의서 작성 가이드와 동일) |
| 설계 요소 | sds | `ARC-nn` 아키텍처 결정 · `MOD-nn` 모듈 · `SCR-nn` 화면 · `API-nnn` · `TBL-nn` · `EXT-nn` 외부 인터페이스 |
| 테스트 | test | `TC-{REQ 유형}-{NNN}-{nn}` 예) `TC-F-003-01` |

---

## 5. 산출물별 규약

모든 문서 공통 머리말:

```markdown
# <문서명> — <module>[/<domain>]

| 항목 | 값 |
|------|----|
| 대상 저장소 | <repo 경로> |
| 기준 형상 | <branch> @ <short sha> |
| 작성일 | <YYYY-MM-DD> |
| 생성 방식 | /dev-artifact 소스 역추출 |
```

### 5.1 `req` — 요구사항정의서 → `artifacts/01_요구사항정의서.md`

`docs/file/요구사항정의서_엑셀양식_v3_1_3.xlsx` [요구사항정의서] 시트의 **12컬럼을 그대로** Markdown 표로 쓴다.
컬럼 순서·명칭을 바꾸지 않는다(엑셀 임포트 호환).

`요구사항 ID | 대분류 | 중분류 | 소분류 | 요구사항명 | 상세 내용 | 요청자 | 수용 여부 | 우선순위 | 담당자 | 진행 현황 | 비고`

- 요구사항명: 40자 이내 **명사형**(동사로 끝내지 않는다). 대분류 = 모듈, 중분류 = 기능 그룹, 소분류 = 세부 기능.
- 상세 내용: 셀 내 줄바꿈은 `<br>`. 블록은 양식 샘플 행(REQ-F-001) 구조를 따른다 —
  `[개요]` · `[상세 기능 요구사항]` · `[입력 / 출력]` · `[제약 조건 / 비기능 요구사항]` · `[검증 기준]` · `[작업 대상]`.
  이 구조는 `docs/file/요구사항_TASK_전환_Format.md` 매핑 규칙의 입력이므로 블록명을 바꾸지 않는다.
- 코드에 구현돼 있는 기능은 `진행 현황 = 완료`, `수용 여부 = 수용`.
- **요청자 · 담당자 · 우선순위는 소스로 알 수 없다 → `TBD`.** git 작성자를 요청자로 쓰지 않는다.
- 표 아래에 `## 근거` 절을 두고 ID별 근거 `파일:라인`을 단다.

### 5.2 `srs` — 소프트웨어 요구사항 명세서 → `artifacts/02_SRS.md`

`docs/file/SRS_소프트웨어요구사항명세서_v1.0.pdf` 목차를 따른다.

1 서론(목적·범위·정의 및 약어·참고 자료·문서 규약) · 2 전체 설명(제품 조망·제품 기능·사용자 클래스·운영 환경·설계/구현 제약·가정 및 의존성) ·
3 기능 요구사항(`3.x.y REQ-F-nnn <요구사항명> <우선순위>`) · 4 외부 인터페이스 요구사항(REQ-IF) · 5 데이터 요구사항(REQ-DA) ·
6 비기능 요구사항(REQ-NF · REQ-SE) · 7 프로세스 상태 모델(해당 시) · 8 검증 및 인수 · 9 추적성 매트릭스 · 10 미해결 사항(TBD)

- 요구사항 하나마다 인수 조건을 `C1, C2 …` 로 번호 매긴다.
- 소스로 확인할 수 없는 것(성능 수치·운영 환경 규모 등)은 지어내지 않고 §10 TBD 로 보낸다.

### 5.3 `sds` — 소프트웨어 설계 명세서 → `artifacts/03_SDS.md`

`docs/file/SDS_소프트웨어설계명세서_v1.0.pdf` 목차를 따른다.

1 설계 개요(목적과 위치·설계 원칙·식별자 체계·설계 전제) · 2 시스템 아키텍처(계층 구조·아키텍처 결정 ARC) ·
3 모듈 구조(MOD·모듈 간 의존 규칙) · 4 화면 설계(SCR — 화면 없는 모듈은 "해당 없음") · 5 API 설계(API 공통 규약 + 요약표, 상세는 04 문서 참조) ·
6 데이터 모델 설계(TBL 요약, 상세는 05 문서 참조) · 7 외부 인터페이스 설계(EXT·시퀀스) · 8 예외·오류 처리(오류 코드 체계·처리 원칙) · 9 SRS 추적 매트릭스(REQ → 설계 요소)

- 클래스·패키지 구조는 실제 패키지에서 가져온다. 스킬에 적힌 규약과 코드가 다르면 **코드를 정본**으로 쓰고 불일치를 §8 이 아니라 문서 끝 `## 확인 필요` 에 남긴다.

### 5.4 `api` — API 정의서 → `artifacts/04_API정의서.md`

엔드포인트(또는 §1.4 대체 대상)마다:

| API ID | 메서드 | URL | 설명 | 요청 파라미터/바디 | 응답 | 인증·권한 | 근거 | 관련 REQ |

- URL 은 컨트롤러 클래스 매핑 + 메서드 매핑을 합친 **실제 경로**. 게이트웨이 접두(`/auth-user` 등)가 붙는 모듈이면 외부 경로도 병기.
- 상속으로 생기는 엔드포인트(backend 의 TreeAbstractController 등)를 빠뜨리지 않는다 — 스킬에 목록이 있다.
- 응답 봉투(backend `jsonView` 등)는 문서 앞 공통 규약 절에 한 번만 적는다.

### 5.5 `table` — 테이블 정의서 → `artifacts/05_테이블정의서.md`

테이블(또는 §1.4 대체 대상)마다 개요 1줄 + 컬럼 표:

| No | 컬럼명 | 타입 | NULL | 기본값 | PK/FK/IDX | 설명 | 근거 |

- backend: 트리 공통 컬럼(`c_id`·`c_parentid`·`c_left`·`c_right` 등)은 공통 절에 한 번만 쓰고 테이블별로는 생략 표기.
  `_LOG` 짝 테이블·트리거 3종·제품별 동적 테이블(`T_ARMS_REQADD_<pdServiceId>`)은 별도 절로 쓴다.
- 최종 스키마는 Flyway 를 **버전 순서대로 누적 적용한 결과**다. 최초 CREATE 만 보고 쓰지 않는다.
- 엔티티 필드와 DDL 이 어긋나면 `## 확인 필요` 에 남긴다.

### 5.6 `test` — 단위테스트 케이스 → `artifacts/06_단위테스트케이스.md`

| TC ID | 관련 REQ / API | 대상(클래스#메서드) | 사전 조건 | 입력 | 기대 결과 | 유형(정상/경계/예외) | 기존 테스트 |

- REQ 하나에 정상 1개 이상 + 예외 1개 이상. SRS 인수 조건(C1…)이 있으면 조건마다 1건 이상 대응시킨다.
- `기존 테스트` 열: `src/test/**` 에 이미 대응 테스트가 있으면 `파일:메서드`, 없으면 `미작성`.
- 테스트 **코드는 쓰지 않는다** — 케이스 문서만 만든다.

---

## 6. 작성 원칙 (모든 산출물)

- **근거 없는 내용 금지.** 모든 요구사항·설계 요소·API·테이블은 `파일:라인` 근거가 있어야 한다.
  소스에서 추론한 해석은 `(추정)` 을 붙인다. 근거를 찾지 못한 항목은 쓰지 않고 `TBD` 로 남긴다.
- 문서 간 ID 는 서로 일치해야 한다(REQ ↔ SRS 절 ↔ SDS 추적 매트릭스 ↔ TC).
- 도메인 범위가 있으면 그 범위 밖 기능은 쓰지 않는다. 범위 밖 의존(호출하는 다른 모듈)은 EXT 로만 적는다.
- 시크릿·접속 정보(비밀번호·토큰·내부 IP)는 설정 파일에 있어도 옮겨 적지 않는다 — `<마스킹>` 표기.

---

## 7. 검증과 보고

생성 후 아래를 확인하고 `log.md` 에 `[VERIFICATION]` 으로 남긴 뒤 `task.md` status 를 `done` 으로 바꾼다.

```
□ 요청한 type 의 파일이 artifacts/ 에 전부 있다
□ req 표 헤더가 엑셀 양식 12컬럼과 글자까지 같다
□ 문서 간 ID 참조가 끊기지 않는다 (참조된 REQ/API/TBL ID 가 정의 문서에 실제로 있다)
□ 근거 경로를 샘플링(문서당 3건 이상)해 실제 파일·라인에 해당 내용이 있다
□ 소스 저장소에 변경이 없다 (git -C <repo> status --porcelain 이 실행 전과 같다)
□ context.md ≤ 1500자
```

사용자 보고 (한국어):

1. 생성 파일 목록과 각 문서의 항목 수 (REQ n건 · API n건 · TBL n개 · TC n건)
2. 기본값을 쓴 파라미터 목록
3. `TBD` · `(추정)` · `## 확인 필요` 건수와 대표 사례 — **사용자가 채워야 할 것**
4. 요구사항정의서를 엑셀에 옮길 때의 주의 (`<br>` → 셀 내 줄바꿈 Alt+Enter)

---

## 8. Do NOT

- 모듈 저장소·`_shared/`·`_templates/` 에 쓰기 (산출물은 `tasks/<task>/artifacts/` 만)
- 소스로 확인되지 않는 요구사항·성능 수치·요청자·담당자 창작
- 엑셀 양식 컬럼명·순서 변경
- 기존 `tasks/<task>/` 덮어쓰기
- 승인 없이 `claude-main` · `claude-reviewer` 호출
- 테스트 코드·구현 코드 생성 (이 command 는 문서만 만든다)

---

## 9. 사용 예

```
/dev-artifact backend                              # Backend-Core 전체, 6종 전부
/dev-artifact backend reqadd --type req,srs        # 요구사항 도메인만, 요구사항정의서·SRS
/dev-artifact engine --type api,table              # Engine-Fire API 정의서 + OpenSearch 인덱스 정의서
/dev-artifact broker --type test --task broker-tc  # Broker-Hub 단위테스트 케이스, 작업 폴더명 지정
/dev-artifact ai --repo D:/work/Java-Service-Tree-Framework-AI --dry-run
```
