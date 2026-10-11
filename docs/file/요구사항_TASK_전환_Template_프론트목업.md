# 요청 프롬프트 템플릿 — 프론트 전용 목업 화면 (JSON 데이터)

하네스 루트에서 실행한 Claude Code 세션 채팅창에 아래 블록을 붙여넣는다(파일에서 읽게 하려면 `요구사항_TASK_전환_Template_프론트목업.md 읽고 그대로 작업 만들어서 진행해줘`).
요청문 형식 규칙은 [요구사항_TASK_전환_Format.md](요구사항_TASK_전환_Format.md), 예시는 [요구사항_TASK_전환_Sample.md](요구사항_TASK_전환_Sample.md).

사용 전 확인:

- `{ 전제 사항을 추가할 것 }`, `[요구사항]` 을 채운다. 비워 두면 "묻지 말고 진행" 문장 때문에 오케스트레이터가 요구사항을 임의로 정한다.
- `Java-Service-Tree-Framework-Frontend-Web/` 을 하네스 루트 아래에 clone 해 둔다.
- `review-expert` 에이전트는 현재 `.claude/agents/` 에 없고, claude-reviewer 는 읽기 전용 워커라 서브에이전트를 부를 수 없다. 그 줄은 지우거나 에이전트를 먼저 추가한다.

---

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
