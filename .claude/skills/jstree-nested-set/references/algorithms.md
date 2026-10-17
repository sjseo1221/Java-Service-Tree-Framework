# nested-set 연산 상세 (NestedSetTree.java 기준)

표기: `s` = 구조 테이블, `N` = 대상 노드, `P` = 새 부모, `children` = `P` 의 직계 자식(`pid = P.id ORDER BY pos`).
모든 예시는 `scripts/NestedSetCheck.java` 로 실제 포트 코드를 돌려 확인한 값이다.

## 기준 트리 T0

```
root id=1 (1,10) lvl0 pid0 pos0
├ A  id=2 (2,7)  lvl1 pid1 pos0
│ ├ A1 id=3 (3,4) lvl2 pid2 pos0
│ └ A2 id=4 (5,6) lvl2 pid2 pos1
└ B  id=5 (8,9)  lvl1 pid1 pos1
```

## 공통: 삽입 기준점

```
position = clamp(position, 0, children.size())
refLft = position < size ? children[position].lft     : P.rgt
refRgt = position < size ? children[position].lft + 1 : P.rgt
```
- 끝에 붙이면 기준점은 부모의 `rgt` 다 → 부모 `rgt` 는 밀리고 부모 `lft` 는 그대로다.
- 형제 앞에 끼우면 그 형제의 `lft` 가 기준점 → 그 형제와 오른쪽 전부가 밀린다.

---

## mk(parentId, position, name) — 추가

```sql
UPDATE s SET pos = pos + 1 WHERE pid = :P AND pos >= :position;   -- 형제 자리 비우기
UPDATE s SET lft = lft + 2 WHERE lft >= :refLft;
UPDATE s SET rgt = rgt + 2 WHERE rgt >= :refRgt;
INSERT INTO s (lft, rgt, lvl, pid, pos) VALUES (:refLft, :refLft + 1, :P.lvl + 1, :P, :position);
-- 이어서 rn(newId, name) 으로 이름 저장
```
예: `mk(A, 1)` → `A(2,9) A1(3,4) new(5,6) pos1  A2(7,8) pos2  B(10,11) root(1,12)`.

## mv(id, parentId, position) — 이동

거부: `parentId == 0`, 루트(`pid == 0`) 이동, **`P.lft >= N.lft && P.rgt <= N.rgt`(자기 하위 트리 안으로)** → `"Could not move parent inside child"`.

```
if children 비어 있음          → position = 0
if N.pid == P.id && position > N.pos → position++      ★ 같은 부모 안에서 뒤로
position = clamp(position, 0, size)
ids   = N 과 그 하위 노드 id 전부
width = N.rgt - N.lft + 1
diff  = refLft - N.lft;  if (diff > 0) diff -= width   ★ 오른쪽으로 갈 때 보정
ldiff = (P.lvl + 1) - N.lvl
```
```sql
-- 1) 새 부모 쪽 자리 벌리기 (자기 하위 트리는 제외)
UPDATE s SET pos = pos + 1   WHERE id != :N AND pid = :P AND pos >= :position;
UPDATE s SET lft = lft + :width WHERE lft >= :refLft AND id NOT IN (:ids);
UPDATE s SET rgt = rgt + :width WHERE rgt >= :refRgt AND id NOT IN (:ids);
-- 2) 하위 트리 평행이동
UPDATE s SET lft = lft + :diff, rgt = rgt + :diff, lvl = lvl + :ldiff WHERE id IN (:ids);
UPDATE s SET pos = :position, pid = :P WHERE id = :N;
-- 3) 옛 자리 닫기 (N.rgt·N.pos 는 이동 전 값)
UPDATE s SET pos = pos - 1      WHERE pid = :N.oldPid AND pos > :N.oldPos;
UPDATE s SET lft = lft - :width WHERE lft > :N.oldRgt AND id NOT IN (:ids);
UPDATE s SET rgt = rgt - :width WHERE rgt > :N.oldRgt AND id NOT IN (:ids);
```

예 1 — 다른 부모로: `mv(B, A, 0)` → `A(2,9)  B(3,4) lvl2 pos0  A1(5,6) pos1  A2(7,8) pos2`.
`diff = 3 - 8 = -5`, `ldiff = 1`.

예 2 — 같은 부모 안에서 뒤로: `mv(A1, A, 1)` → `A2(3,4) pos0  A1(5,6) pos1`.
클라이언트가 보낸 `position=1` 이 `++` 로 2 가 되어 `refLft = A.rgt = 7`, `diff = 7-3 = 4 → 4-2 = 2`.
**`++` 를 빼면** `refLft = A2.lft = 5`, `diff = 0` 이 되어 A1 이 제자리에 남는다(의도보다 한 칸 앞).

### position 의미

jstree 3 의 `move_node.jstree` 이벤트가 주는 `data.position` 은 **이동이 끝난 뒤 새 부모 안에서의 인덱스**다
(`src/jstree.js` `move_node`(3950행~) — 같은 부모 안에서 뒤로 옮기면 클라이언트가 먼저 `pos--` 한다).
서버는 "N 이 아직 옛 자리에 있는 상태의 자식 목록"으로 기준점을 고르기 때문에, 같은 부모 안에서
뒤로 옮길 때만 한 칸 보정이 필요하다. Backend-Core `moveNode` 에서 같은 증상(같은 부모 안 이동만 한 칸씩
어긋남)이 나면 이 보정 유무부터 본다.

## cp(id, parentId, position) — 하위 트리 복사

거부: `parentId == 0`, 루트 복사. 같은 부모 `++` 보정은 **없다**(원본이 그대로 남으므로).

```sql
UPDATE s SET pos = pos + 1      WHERE pid = :P AND pos >= :position;
UPDATE s SET lft = lft + :width WHERE lft >= :refLft;
UPDATE s SET rgt = rgt + :width WHERE rgt >= :refRgt;
```
그다음 `[N] + N 의 하위 노드(lft 순)` 를 차례로 insert:
```
lft = refLft + (n.lft - N.lft)
rgt = refLft + (n.rgt - N.lft)
lvl = n.lvl + ldiff
pid = (n == N) ? P : newIds[n.pid]     ← lft 순이라 부모가 항상 먼저 복사돼 맵에 있다
pos = (n == N) ? position : n.pos
```
이름 행도 새 id 로 복사한다. 반환값은 **복사된 최상위 노드의 새 id**(클라이언트가 `set_id` 에 쓴다).

예: `cp(A, B, 0)` → `B(8,15)  A'(9,14) pid5  A1'(10,11) pid=A'  A2'(12,13) pid=A'  root(1,16)`.

Backend-Core 대응: `moveNode` 의 `copy=1` 분기 + `setFieldFromNewInstance`(제목에 `copy_` 붙이기) 훅.
포트는 이름을 그대로 복사한다.

## rm(id) — 하위 트리 삭제

거부: 루트 삭제 (포트 메시지는 PHP 원본 그대로 `"Could not create inside roots"` 라 오해하기 쉽다).

```sql
DELETE FROM s WHERE lft >= :N.lft AND rgt <= :N.rgt;
UPDATE s SET lft = lft - :width WHERE lft > :N.rgt;
UPDATE s SET rgt = rgt - :width WHERE rgt > :N.lft;      -- 조상의 rgt 도 여기서 줄어든다
UPDATE s SET pos = pos - 1      WHERE pid = :N.pid AND pos > :N.pos;
DELETE FROM data WHERE id IN (:ids);
```
예: `rm(A)` → `root(1,4)  B(2,3) pos0`.

## rn(id, name) — 이름 변경

존재하지 않으면 예외. `name == null` 이면 아무것도 안 하고 성공. data 테이블에 UPDATE, 0행이면 INSERT(upsert).
Backend-Core 는 `c_title` 이 같은 테이블이므로 `alterNode` 가 대응한다(`Util_TitleChecker.StringReplace()` 정제 포함).

---

## 동시성·성능 메모

- 한 번의 쓰기가 **lft/rgt 가 기준점 이상인 모든 행**을 건드린다. 트리 앞쪽에 넣을수록 갱신 행이 많고,
  행 락 범위가 사실상 테이블 전체다. 동시 쓰기는 직렬화해야 한다(Backend-Core: `SERIALIZABLE`, 대량은 Kafka 순차 처리).
- 포트는 한 단계당 집합 UPDATE 한 문장이다. Backend-Core `stretchLeft/Right` 는 노드 단건 UPDATE 루프라
  같은 연산이 노드 수만큼의 UPDATE 가 된다(arms-backend-core `pitfalls.md` C3).
- 읽기는 adjacency(`pid`·`pos`)로 직계 자식, nested set(`lft`·`rgt`)으로 하위 전체·조상 경로를 조회한다.
  두 표현이 어긋나면 화면마다 다른 트리가 보인다 → `consistency-check.md`.
