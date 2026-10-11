# 요청 프롬프트 템플릿 — 개발 작업 공통 (프론트 · 백엔드 · DB · 연동 · 문서 · 테스트)

모든 개발 요청을 같은 항목으로 적기 위한 템플릿이다. 실행 방법은 두 가지다.

- **커맨드**: `/dev-task <요청문>` — 요청문을 이 템플릿 항목에 맞춰 해석하고 빈 항목은 아래 기본값으로 채워 작업을 만든다
- **붙여넣기**: 아래 블록을 채워 하네스 세션 채팅창에 붙여넣는다 (또는 `docs/file/요구사항_TASK_전환_Template.md 읽고 그대로 작업 만들어서 진행해줘`)

요청문 형식 규칙은 [요구사항_TASK_전환_Format.md](요구사항_TASK_전환_Format.md), 예시는 [요구사항_TASK_전환_Sample.md](요구사항_TASK_전환_Sample.md).

---

## 템플릿

```text
{ <참고 문서 경로> }을 모두 읽고,
( 최대한 자세하게 읽어, 이미 한번 읽은 file들이라면 이 단계는 skip 해. )

{ 전제 사항을 추가할 것 }

[요구사항]
<무엇이 되어 있으면 끝인지. 완료 조건 = ① ② ③ (빌드·테스트 통과 같은 확인 가능한 조건 포함)>

[작업의 특성]
작업 유형: <프론트 | 백엔드 | DB | 모듈 간 연동 | 문서·분석 | 테스트> (복수 가능)
데이터 방식: <실제 연동 | mock(JSON 파일)>
  - 상대 모듈(백엔드 등)이 아직 없으면 mock 으로 먼저 만들고, 나중에 실제 연동으로 바꾸기 쉬운 구조로 한다.

작업 대상은 <모듈 폴더 / 경로> 이다.
write_scope: <허용 경로 패턴 | none(diff 만 산출)>
윗 내용으로 작업을 만들고 진행한다.
승인이나 결정이 필요한 내용은 나에게 물어보지 말고 우선 진행을 하고,
로그에 임의 결정한 사항을 정리해서 남긴다.
<모듈>/docs/ai/ 밑에 재사용 가능한 하네스가 있으면 참고한다.
/reference 에 라이브러리·테마가 있으면 활용할 수 있다(수정 금지).
main worker는 claude-main 이 진행한다.
서브 에이전트는 <작업 유형별 도메인 에이전트 — 아래 표> 가 진행한다.
review role worker 는 claude-reviewer 가 진행한다.
review role worker의 subagent는 review-expert가 진행한다.
제약: <금지 사항 — 예: 기존 API 시그니처 변경 금지, 커밋 금지>
```

## 빈 항목 기본값

| 항목 | 비었을 때 |
|---|---|
| 참고 문서 | 읽기 단계를 생략한다 |
| 전제 사항 | 오케스트레이터가 문서·코드에서 추론해 `task.md` 전제에 적고 `log.md` `[DECISION]` 으로 남긴다 |
| 요구사항 | **추측하지 않는다.** "묻지 말고 진행" 문장이 있어도 요구사항이 비면 그것 하나만 묻는다 |
| 작업 유형 | 작업 대상 경로로 판정한다 (아래 표) |
| 데이터 방식 | 상대 모듈이 워크스페이스에 있으면 실제 연동, 없으면 mock |
| write_scope | `none` — 대상 저장소는 그대로 두고 `artifacts/` 에 diff 만 만든다 |
| 서브 에이전트 | 작업 유형 표의 기본 에이전트 |
| 제약 | 커밋은 작업 완료 후, 기본 브랜치 직접 push · force push 금지 |

## 작업 유형 → 서브 에이전트

| 작업 대상 · 유형 | 구현 서브 에이전트 | 함께 쓰면 좋은 검토 에이전트 |
|---|---|---|
| Frontend-Web 화면 (jQuery · Bootstrap) | frontend-expert | review-expert |
| Backend-Core API · 도메인 | backend-expert | review-expert |
| DB 스키마 · Flyway | database-expert | review-expert |
| Engine-Fire 수집 · 집계 (OpenSearch) | engine-expert | review-expert |
| Middle-Proxy 게이트웨이 · Redis · Kafka 발행 | middleproxy-expert | review-expert · security-auditor |
| Broker-Hub 웹소켓 · 동시편집 | broker-expert | review-expert |
| Global-Config 설정 · 스케줄 · 언어팩 | config-expert | review-expert |
| AI 모듈 (Spring AI · RAG) | ai-expert | review-expert |
| 여러 모듈에 걸친 변경 | 모듈별 도메인 에이전트 | contract-reviewer (계약 대조) |
| 인증 · 권한 · 외부 노출 변경 | 해당 도메인 에이전트 | security-auditor |
| 테스트 작성 | test-writer | review-expert |
| 설계 산출물 (SDS · 시퀀스 · ERD) | design | plan-challenger |

- 비가역 결정(스키마 · 공개 API · 모듈 간 계약)이 들어가면 구현 전에 plan-challenger 로 계획을 검증한다.
- **review-expert 호출 주체**: claude-reviewer 는 읽기 전용 워커라 서브에이전트를 부를 수 없다. 오케스트레이터가 claude-reviewer 와 review-expert 를 나란히 호출하고 두 결과를 함께 반영한다.
- 대상 모듈 폴더가 워크스페이스에 없으면 clone 이 먼저다. 없는 채로 진행하면 오케스트레이터가 대체 위치를 정하고 `[DECISION]` 으로 남긴다.

## 예시 — 프론트 목업 (백엔드 없이 JSON 으로 화면 먼저)

```text
{ Java-Service-Tree-Framework-Frontend-Web/docs/file }을 모두 읽고,
( 최대한 자세하게 읽어, 이미 한번 읽은 file들이라면 이 단계는 skip 해. )

{ 전제 사항을 추가할 것 }

[요구사항]

[작업의 특성]
이 작업은 단순히 프론트 작업만 진행하게 될 것이고, 백엔드 처리는 추후 있을 예정이니까
우선 json 같은 파일로 화면의 정보를 표시할 수 있어야 한다.

작업 대상은 Java-Service-Tree-Framework-Frontend-Web 모듈의 arms\html\ai-agent-dev 이다.
윗 내용으로 작업을 만들고 진행한다.
승인이나 결정이 필요한 내용은 나에게 물어보지 말고 우선 진행을 하고,
로그에 임의 결정한 사항을 정리해서 남긴다.
Java-Service-Tree-Framework-Frontend-Web 모듈에는 /docs/ai/ 밑에 재사용 가능한 하네스가 있다.( 참고 )
/reference 에는 다양하 라이브러리와 테마가 있으니, 활용할 수 있는 요소가 있다면 활용해도 된다.
main worker는 claude-main 이 진행한다.
서브 에이전트는 frontend-expert 가 진행한다.
review role worker 는 claude-reviewer 가 진행한다.
review role worker의 subagent는 review-expert가 진행한다.
```

## 예시 — 백엔드 API 추가

```text
{ docs/file }을 모두 읽고, ( 이미 한번 읽은 file들이라면 skip 해. )

[요구사항]
요구사항 도메인에 담당자별 집계 API 추가. 완료 조건 = ① GET /reqAdd/assigneeStats 응답에 담당자별 건수 ② gradlew compileJava 통과

[작업의 특성]
작업 유형: 백엔드
데이터 방식: 실제 연동

작업 대상은 Java-Service-Tree-Framework-Backend-Core 모듈이다.
write_scope: "src/main/java/com/arms/api/**"
승인이나 결정이 필요한 내용은 나에게 물어보지 말고 우선 진행을 하고, 로그에 임의 결정한 사항을 정리해서 남긴다.
main worker는 claude-main, 서브 에이전트는 backend-expert, review 는 claude-reviewer + review-expert.
제약: 기존 API 시그니처 수정 금지
```
