# jstree-nested-set-skill

## 메타

```yaml
status: done
created: 2026-10-17
updated: 2026-10-17
priority: medium
```

## Goal

`C:\dev\jstree-3.3.3\jstree-3.3.3\java-backend`(jstree 데모 PHP 백엔드의 Java 포트)를 근거로, backend-expert 가 쓸 수 있는 스킬 `.claude/skills/jstree-nested-set/` 을 만든다.

## Constraints

- write_scope: ".claude/skills/jstree-nested-set/**, .claude/agents/backend-expert.md, .claude/agents/README.md" (Orchestrator 직접 수행)
- 원본 jstree 디렉토리는 읽기 전용
- Backend-Core 소스는 이 PC에 없음 → Backend-Core 쪽 대응 관계는 `arms-backend-core` 스킬 문서 기준으로 적고, 확인하지 못한 부분은 "확인 필요"로 표시

## Acceptance Criteria

- [ ] SKILL.md frontmatter(name·description) + 본문 + references 3개
- [ ] 알고리즘 설명이 NestedSetTree.java 와 일치 (예시 수치 검산)
- [ ] backend-expert 정의에서 이 스킬을 가리킴, README 표 갱신
- [ ] /agent-check 정합성 ⑤ 통과

## Worker Plan

```yaml
workers_approved: []
planned_workers: []
```
