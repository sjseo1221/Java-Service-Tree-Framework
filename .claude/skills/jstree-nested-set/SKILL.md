---
name: jstree-nested-set
description: >-
  jstree 3.3.3 데모 백엔드(class.tree.php 의 Java/Spring 포트, C:\dev\jstree-3.3.3)를 근거로 한
  nested-set 트리 알고리즘·정합성 검사·jstree AJAX 계약 레퍼런스. A-RMS Backend-Core TreeFramework
  (c_left · c_right · c_level · c_parentid · c_position)는 이 PHP 트리 클래스 계열 설계라서,
  addNode · removeNode · moveNode(copy 포함) 가 left/right 를 어떻게 밀고 당기는지, 같은 부모 안에서
  옮길 때 position 보정, 하위 트리 복사 시 id 재매핑, 트리가 깨졌을 때 진단(analyze)과 복구
  (adjacency list 로 lft/rgt 재계산) 를 판단할 때 읽는다. "nested set", "중첩 집합", "c_left/c_right 가 꼬였다",
  "트리가 깨졌다", "노드 이동이 이상하다", "형제 순서가 틀어졌다", "analyzeNode 구현", "트리 정합성 검사",
  "트리 복구", "jstree 백엔드", "jstree 3 연동", "lazy load 트리 API" 요청에서 arms-backend-core 와 함께 쓴다.
  Backend-Core 규약(Java 11 · Boot 2.6 · Hibernate Criteria · 동적 테이블 · egovframework 수정 금지)은
  arms-backend-core 스킬이 정본이고, 이 스킬은 알고리즘·계약 근거만 준다. 포트 코드(Java 17 record ·
  switch 식 · JdbcTemplate)를 Backend-Core 에 그대로 옮겨 붙이지 않는다.
---

# jstree nested-set 레퍼런스

근거 소스: `C:\dev\jstree-3.3.3\jstree-3.3.3\` (읽기 전용)

| 파일 | 내용 |
|---|---|
| `java-backend/.../sitebrowser/NestedSetTree.java` (371줄) | **핵심.** `class.tree.php` 포트 — mk · mv · cp · rm · rn · analyze · reconstruct |
| `java-backend/.../sitebrowser/SiteBrowserController.java` | `?operation=` 디스패처 — jstree 3 AJAX 계약 |
| `java-backend/.../filebrowser/FileSystemTree.java` | 파일시스템 트리(경로 = id). nested-set 아님, 경로 탈출 방어 참고용 |
| `java-backend/src/main/resources/db/h2/{schema,data}.sql` | `tree_struct`(lft·rgt·lvl·pid·pos) + `tree_data`(nm) 시드 |
| `demo/sitebrowser/index.html` | 클라이언트 쪽 호출 방식(이벤트 → `$.get`, 실패 시 `refresh()`) |

이 스킬에 딸린 파일:

| 파일 | 용도 |
|---|---|
| `references/algorithms.md` | mk·mv·cp·rm·rn 의 SQL 순서와 실측 예시 |
| `references/consistency-check.md` | 정합성 검사 항목·Backend-Core 용 쿼리·복구 방식 |
| `references/ajax-contract.md` | jstree 3 operation 계약, A-RMS(jstree pre1.0 · `*.do`)와의 차이 |
| `scripts/nested-set-check.sql` | `C_` 컬럼용 읽기 전용 검사 쿼리 (bad > 0 이 문제) |
| `scripts/NestedSetCheck.java` | 포트 코드를 H2 에서 돌려 연산 결과를 보는 검증 하네스 |

포트 스택은 **Spring Boot 3.3.5 · Java 17 · JdbcTemplate · H2/MySQL** 이다. Backend-Core(Java 11 · Boot 2.6 ·
Hibernate 5 Criteria)와 다르므로 **이 스킬은 알고리즘·계약의 근거로만 쓰고 코드는 Backend-Core 관례로 다시 쓴다.**

---

## 1. 이 스킬을 쓰는 상황

| 상황 | 볼 곳 |
|---|---|
| 노드 추가·이동·복사·삭제 결과가 이상하다 (left/right·형제 순서) | §3 → `references/algorithms.md` |
| 트리 테이블이 깨졌는지 확인하고 싶다 / `analyzeNode.do` 를 제대로 구현하고 싶다 | `references/consistency-check.md` |
| 깨진 트리를 복구하고 싶다 | `references/consistency-check.md` §3 |
| jstree 3.x 화면에 붙일 lazy-load 트리 API 를 만든다 | `references/ajax-contract.md` |
| A-RMS 기존 화면(jstree pre1.0)과 무엇이 다른지 | `references/ajax-contract.md` §3 |

**먼저 `arms-backend-core` 스킬을 읽는다.** 그 스킬의 금지 사항이 이 스킬보다 우선한다:
`egovframework/` 베이스 수정 금지 · `c_left`/`c_right`/`c_level`/`c_position` 직접 계산 금지(TreeServiceImpl 경유) ·
동적 테이블 라우팅 유지. 이 스킬은 **"왜 그렇게 동작하는가 / 결과가 맞는가"를 판정하는 근거**이고,
도메인 코드에서 nested-set 을 따로 구현하라는 뜻이 아니다.

---

## 2. 모델 대응표

`tree_struct` 하나에 **nested set(lft·rgt·lvl)과 adjacency list(pid·pos)를 함께 둔다.** Backend-Core 도 같은 이중 구조다.

| jstree 포트 | Backend-Core (`TreeBaseEntity`) | 의미 / 불변식 |
|---|---|---|
| `id` | `c_id` | PK. IDENTITY |
| `pid` | `c_parentid` | 부모 id. 루트만 0 |
| `pos` | `c_position` | 형제 안 순서, 0부터 **빈칸 없이** 연속 |
| `lft` / `rgt` | `c_left` / `c_right` | 루트 lft=1, `max(rgt) = 2 × 노드 수`. 모든 lft·rgt 가 서로 다름 |
| `lvl` | `c_level` | 루트 0, 자식은 부모+1 |
| `tree_data.nm` (별도 테이블) | `c_title` (같은 테이블) | 노드명. 포트는 이름을 **별도 테이블**에 둔다 |
| — | `c_type` (`root`/`drive`/`folder`/`default`) | 포트에는 타입이 없다. 리프 밑 추가 금지는 Backend-Core 고유 규칙 |
| 루트 1개 (`id=1, pid=0`) | 고정 루트 2행 (`c_id=1` root, `c_id=2` drive) | Backend-Core 는 실제 노드를 `c_id=2` 밑에 붙인다 |

파생 판정(포트 `TreeNode`):
- 자식 있음: `rgt - lft > 1`
- 하위 트리 폭: `width = rgt - lft + 1` (= 2 × 하위 노드 수)
- 하위 노드 전부: `lft > node.lft AND rgt < node.rgt ORDER BY lft` (부모가 항상 자식보다 먼저 나온다)
- 조상 경로: `lft < node.lft AND rgt > node.rgt ORDER BY lft`
- 직계 자식: `pid = node.id ORDER BY pos` — **nested set 이 아니라 adjacency 로 조회한다**

---

## 3. 연산 요약 (자세한 SQL 순서·검산 예는 `references/algorithms.md`)

모든 쓰기는 **트랜잭션 하나**다(포트 `@Transactional`, Backend-Core `Isolation.SERIALIZABLE`). 중간에 실패하면 반쯤 밀린 트리가 남으므로 롤백이 필수다.

공통 기준점 — 부모 `P` 밑 `position` 자리에 넣을 때:
```
position = clamp(position, 0, 자식 수)
refLft = position < 자식 수 ? children[position].lft : P.rgt
refRgt = position < 자식 수 ? children[position].lft + 1 : P.rgt
```

| 연산 | 핵심 | 거부 조건 |
|---|---|---|
| **mk** (추가) | 형제 pos+1 → `lft>=refLft` +2, `rgt>=refRgt` +2 → `(refLft, refLft+1, P.lvl+1)` insert | 부모 0 |
| **mv** (이동) | 하위 트리 id 목록을 **제외하고** 새 자리를 width 만큼 벌림 → 하위 트리를 `diff`·`ldiff` 만큼 평행이동 → 옛 자리를 width 만큼 닫음 | 루트 이동, 0 안으로, **자기 하위로 이동** (`P.lft >= N.lft && P.rgt <= N.rgt`) |
| **cp** (복사) | 새 자리를 width 만큼 벌림 → 하위 트리를 lft 순으로 insert 하며 **옛 id→새 id 맵**으로 pid 재연결 | 루트 복사, 0 안으로 |
| **rm** (삭제) | `lft >= N.lft AND rgt <= N.rgt` 삭제 → `lft > N.rgt` 와 `rgt > N.lft` 를 width 만큼 당김 → 형제 pos-1 | 루트 삭제 |
| **rn** (이름) | 존재 확인 후 data 테이블 upsert | 없는 노드 |

꼭 기억할 함정 3개:
1. **같은 부모 안에서 뒤로 옮기면 `position++`** (`node.pid == P.id && position > node.pos`). 자기 자신이 아직 자식 목록에 남아 있는 상태로 refLft 를 고르기 때문이다. 이걸 빼면 한 칸 앞에 떨어진다.
2. **mv 의 `diff` 는 오른쪽으로 갈 때 width 를 뺀다** (`diff = refLft - N.lft; if (diff > 0) diff -= width`). 벌리는 단계에서 자기 자신은 밀리지 않았으므로 보정한다.
3. **pos 는 adjacency 값이라 left/right 와 따로 관리된다.** left/right 만 맞추고 pos 를 안 고치면(또는 반대) `analyze` 의 "Positions not correct" / "Adjacency and nested set do not match" 가 뜬다. 증상은 "목록 순서와 트리 순서가 다르다"다.

---

## 4. Backend-Core 에 적용할 때 판단 기준

- **Backend-Core 소스가 정본이다.** 이 스킬의 대응 관계는 `arms-backend-core/references/tree-framework.md` 서술 기준이며,
  `TreeServiceImpl` 실제 코드와 다르면 코드를 따르고 차이를 보고한다.
- Backend-Core `stretchLeft`/`stretchRight` 는 **노드 단건 UPDATE 루프**다(arms-backend-core `pitfalls.md` C3).
  포트는 **집합 UPDATE 한 문장**(`UPDATE ... SET lft = lft + ? WHERE lft >= ?`)이다. 성능 개선 근거로 쓸 수 있지만
  `egovframework/` 수정이므로 **승인 대상**이다 — 먼저 영향 범위를 보고한다.
- `/analyzeNode.do` 는 Backend-Core 에서 **항상 `"true"` 를 돌려주는 스텁**이다. 정합성 검사가 필요하면
  `references/consistency-check.md` 의 쿼리를 **읽기 전용 진단**으로 먼저 돌리고(c_ 컬럼명으로 치환), 결과를 보고한다.
- 동적 테이블(`T_ARMS_REQADD_<pdServiceId>` 등)은 **제품마다 따로 검사**한다. 테이블 하나가 정상이어도 다른 제품 테이블은 깨져 있을 수 있다.
- 고정 루트 2행(`c_id=1` root, `c_id=2` drive)도 일반 nested-set 노드라 검사 쿼리는 그대로 적용된다.
  포트의 이름 테이블 짝 검사 2개만 `C_TITLE` 검사로 바뀐다 — `consistency-check.md` §2.
- 포트 `analyze()` 의 노드 수 검사(`max(rgt)/2`)는 정수 나눗셈이라 `rgt` 가 1 넘친 트리를 놓친다. 검사는 `scripts/nested-set-check.sql` 을 쓴다.
- **복구(reconstruct)는 파괴적이다**(구조 테이블 전량 DELETE 후 재삽입, 루트에서 닿지 않는 노드 삭제). 운영 DB 에는
  사용자 승인 없이 돌리지 않는다. `_LOG` 짝 테이블 트리거가 대량으로 발화한다는 점도 함께 알린다.

---

## 5. 하지 말 것

- 포트의 `record`·`switch` 식·`List.of`·`Path.of` 를 Backend-Core(Java 11)에 그대로 붙이기 — 컴파일 실패
- 도메인 서비스에서 `c_left`/`c_right` 를 직접 계산해 저장하기 (TreeServiceImpl 경유가 규약)
- 이 스킬만 보고 Backend-Core `TreeServiceImpl` 동작을 단정하기 — 실제 소스로 확인한다
- 정합성 검사 결과 없이 "트리가 깨졌다/정상이다" 단정하기
- 포트의 하위 트리 id 목록 문자열 연결(`id NOT IN (" + ids + ")`)을 문자열 입력에 그대로 쓰기 — 포트는 `long` 이라 안전할 뿐이다. Backend-Core 에서는 `Restrictions.in` 등 바인딩을 쓴다
