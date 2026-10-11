---
description: 개발 요청(프론트·백엔드·DB·연동·문서·테스트)을 공통 템플릿 항목으로 해석해 작업 폴더를 만들고 하네스 흐름대로 진행한다
argument-hint: "<요청문 — 자유 형식 또는 템플릿을 채운 블록>"
---

# Dev Task — 개발 요청 공통 진입점

사용자 요청: `$ARGUMENTS`

## 1. 요청을 템플릿 항목으로 해석

`docs/file/요구사항_TASK_전환_Template.md` 를 읽고, 요청을 그 템플릿의 항목(참고 문서 · 전제 · 요구사항 · 작업 유형 · 데이터 방식 · 작업 대상 · write_scope · 워커 · 제약)으로 나눈다.

- 빈 항목은 템플릿의 **빈 항목 기본값** 표대로 채운다. 채운 값은 모두 `log.md` `[DECISION]` 으로 남긴다.
- **요구사항이 비어 있으면 추측하지 않는다.** 다른 항목은 기본값으로 채워도, 요구사항만은 사용자에게 한 번 묻는다.
- 서브 에이전트를 지정하지 않았으면 템플릿의 **작업 유형 → 서브 에이전트** 표로 고른다.
- 지정한 에이전트가 `.claude/agents/` 에 없으면 그 사실을 `[DECISION]` 으로 남기고 표의 대체 에이전트를 쓴다.

## 2. 참고 문서 읽기

참고 문서 경로가 있으면 전부 읽는다. 같은 세션에서 이미 읽은 파일은 건너뛰고 그 사실을 로그에 적는다. PDF 는 `pdftotext -enc UTF-8` 로 추출한다(`-layout` 은 한글이 깨진다).

## 3. 하네스 흐름대로 진행

`CLAUDE.md` Task Lifecycle 을 그대로 따른다 — `tasks/<task>/task.md`(템플릿 `_templates/task.md` 형식) 작성, 워커 승인, `gate.sh`, brief(≤1200자), result 저장, Verification, `log.md`.

- 요청에 "묻지 말고 진행" 위임 문장이 있으면 `_shared/approval-policy.md` 의 프롬프트 사전 승인(`approved_by: user-prompt`)으로 처리하고, 끝날 때 `[DECISION-SUMMARY]` 를 남긴다.
- 위임 문장이 없으면 워커 승인과 target_repo 를 사용자에게 확인한다.
- 구현은 도메인 서브에이전트에 맡기되, 쓰기 범위는 task.md 의 write_scope 로 제한하고 사후에 `git status` 로 범위를 확인한다.
- 리뷰는 claude-reviewer(워커)와 review-expert(서브에이전트)를 오케스트레이터가 나란히 호출한다. claude-reviewer 는 서브에이전트를 부를 수 없다.
- 데이터 방식이 mock 이면, 데이터 접근을 한 곳(api 모듈 등)에 모아 나중에 실제 연동으로 바꾸기 쉽게 만든다.

## 4. 마무리

수락 기준 충족을 확인하고 `status: done`, 교훈은 `_shared/learnings.md`. 커밋·push 는 기억된 git 위임 규칙과 요청의 제약을 따른다.
