# 트리 정합성 검사와 복구

Backend-Core `/analyzeNode.do` 는 항상 `"true"` 를 돌려주는 스텁이다(arms-backend-core `tree-framework.md` §6).
트리가 깨졌는지는 아래 쿼리로 직접 확인한다. **읽기 전용**이라 운영 DB 에서도 돌릴 수 있지만,
대형 테이블에서 자기 조인이 무거우니 사용자에게 알리고 돌린다.

## 1. 포트의 `analyze()` — 원본 검사 항목

| 메시지 | 뜻 |
|---|---|
| No or more than one root node. | `pid = 0` 행이 정확히 1개가 아님 |
| Root node's left index is not 1. | 루트 lft ≠ 1 |
| Missing parents. | `pid` 가 없는 행을 가리킴 |
| Right index does not match node count. | `max(rgt) / 2 ≠ 노드 수` ⚠️ 아래 참고 |
| Duplicates in nested set. / Left·Right indexes not unique. | lft·rgt 중복 |
| Nested set - matching left and right indexes. | 어떤 lft 가 다른 노드의 rgt 와 같음 |
| Positions not correct. | 형제 pos 가 범위 밖이거나 중복 |
| Adjacency and nested set do not match. | `pid` 로 센 자식 수 ≠ lft/rgt 안의 `lvl+1` 노드 수 |
| Missing records / Dangling records in data table. | 구조·이름 테이블 짝이 안 맞음 |

⚠️ **원본 검사의 구멍**: `max(rgt) / 2` 가 정수 나눗셈이라 `max(rgt)` 가 `2N+1` 이면 통과한다.
T0(노드 5개)에서 루트 rgt 를 10 → 11 로 망가뜨려도 `analyze()` 는 `[]` 를 돌려준다(`scripts/NestedSetCheck.java` 로 확인).
아래 쿼리는 `max(rgt) = 2 × 노드 수` 로 검사한다.

## 2. Backend-Core 용 검사 쿼리

`scripts/nested-set-check.sql` — `T_TREE` 를 실제 테이블명(`T_ARMS_REQADD_<pdServiceId>` 등)으로 바꿔서 돌린다.
결과는 `(chk, bad)` 10행이고 **`bad > 0` 인 행이 문제**다.

| chk | 잡는 것 |
|---|---|
| `ROOT_COUNT` | `C_PARENTID = 0` 이 1행이 아님 |
| `ROOT_LEFT_NOT_1` | 루트 `C_LEFT ≠ 1` |
| `MAX_RIGHT_NE_2N` | `max(C_RIGHT) ≠ 2 × 행 수` (원본 구멍 보완) |
| `LEFT_GE_RIGHT` | `C_LEFT >= C_RIGHT` |
| `DUP_LEFT_RIGHT` | lft·rgt 전체 값 중 중복 (원본 중복 검사 3종 + "matching left and right" 를 한 번에) |
| `MISSING_PARENT` | 없는 부모를 가리킴 |
| `NOT_INSIDE_PARENT` | 부모의 lft·rgt 범위 밖이거나 `C_LEVEL ≠ 부모 + 1` (원본 adjacency 검사보다 엄격) |
| `BAD_POSITION_SET` | 형제 pos 가 `0..n-1` 연속·중복 없음이 아님 |
| `POS_ORDER_NE_LEFT_ORDER` | 형제 pos 순서와 lft 순서가 다름 — "목록 순서와 트리 순서가 다르다" 증상 |
| `EMPTY_TITLE` | `C_TITLE` 비었음 (원본 data 테이블 짝 검사를 대체 — Backend-Core 는 같은 테이블) |

Backend-Core 고정 루트 2행(`c_id=1` root `pid=0`, `c_id=2` drive `pid=1`)은 **일반 nested-set 노드와 같은 규칙**을
지키므로 검사를 그대로 적용한다. 루트가 1행 이상으로 나오면(`ROOT_COUNT`) 시드나 마이그레이션이 루트를 중복 삽입한 것이다.

검증 범위: H2 2.2.224 `MODE=MySQL` 에서 정상 트리 = 전부 0, 의도적으로 망가뜨린 5가지
(루트 rgt +1 · 형제 pos 중복 · 형제 pos 뒤바뀜 · pid 만 변경 · lft/rgt 충돌)가 각각 해당 chk 로 잡히는 것을 확인했다.
**실제 MySQL 8 에서는 아직 돌려보지 않았다** — 첫 실행 결과를 보고에 함께 적는다.

## 3. 복구 — `reconstruct()` 방식

adjacency list(`pid`, `pos`)를 **정답으로 보고** lft·rgt·lvl·pos 를 다시 매긴다:

1. `analyze()` 가 비어 있으면 아무것도 안 한다.
2. 전체 행을 `(pid → [자식])` 으로 묶고 형제는 `pos`, 같으면 `id` 순으로 정렬한다.
3. `pid = 0` 에서 시작해 DFS — 들어갈 때 `lft = counter++`, 자식을 다 돈 뒤 `rgt = counter++`, 깊이 = `lvl`, 형제 순번 = 새 `pos`.
4. **구조 테이블을 전부 DELETE 하고** 다시 INSERT 한다(id 유지). 루트에서 닿지 않는 행(고아·순환)은 **사라진다.**
5. 이름이 없는 행은 id 문자열로 채우고, 짝 없는 이름 행은 지운다.

예: T0 에서 A2 의 pos 를 0 으로 망가뜨린 뒤 복구하면 `(id 순 정렬로) A1 pos0, A2 pos1` 로 되돌아가고 analyze 는 `[]` 가 된다.

Backend-Core 에 적용할 때:
- **adjacency 가 정답이라는 가정**부터 확인한다. lft/rgt 쪽이 맞고 pid 가 틀린 경우(예: 부분 UPDATE 로 `C_PARENTID` 만 바뀜)에는 이 방식이 오히려 트리를 틀리게 만든다. `NOT_INSIDE_PARENT` 행을 하나씩 보고 어느 쪽이 맞는지 판정한다.
- DELETE + 재INSERT 대신 **UPDATE 로만** lft/rgt/lvl/pos 를 고친다 — `_LOG` 짝 테이블의 삭제·삽입 트리거가 전 행에 발화하는 것을 피하고, 고아 행이 조용히 사라지지 않게 한다. 고아 행은 별도로 보고한다.
- 제품별 동적 테이블마다 따로 수행한다. 운영 DB 복구는 **사용자 승인 + 백업 후**에만 한다.
- 이 작업은 `egovframework/` 수정이 아니라 일회성 데이터 보정 스크립트로 둔다. 상시 기능으로 넣는다면 승인 대상이다.
