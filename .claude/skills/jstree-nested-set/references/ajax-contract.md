# jstree AJAX 계약

## 1. jstree 3.3.3 데모 계약 (sitebrowser)

클라이언트(`demo/sitebrowser/index.html`):
```javascript
$('#tree').jstree({
  core: {
    data: { url: 'api?operation=get_node', data: function (node) { return { id: node.id }; } },
    check_callback: true            // 없으면 create/rename/move/delete 가 클라이언트에서 막힌다
  },
  force_text: true,                 // 노드명을 HTML 이 아닌 텍스트로 렌더 (XSS 방어)
  plugins: ['state', 'dnd', 'contextmenu', 'wholerow']
})
.on('move_node.jstree', function (e, data) {
  $.get('api?operation=move_node', { id: data.node.id, parent: data.parent, position: data.position })
   .fail(function () { data.instance.refresh(); });   // 실패하면 서버 상태로 다시 그린다
})
```

서버(`SiteBrowserController`, 전부 `GET /demo/sitebrowser/api?operation=...`):

| operation | 요청 파라미터 | 응답 | 서버 동작 |
|---|---|---|---|
| `get_node` | `id` (`#` = 최상위) | `[{id, text, children: boolean}]` | 직계 자식. `children` 은 `rgt - lft > 1` |
| `get_content` | `id` (다중 선택은 `:` 로 이은 문자열) | `{content}` | 조상 경로를 `/` 로 이은 문자열 |
| `create_node` | `id`=부모, `position`, `text` | `{id: 새 id}` | `mk` — 클라이언트가 `set_id` 로 임시 id 교체 |
| `rename_node` | `id`, `text` | `true` | `rn` |
| `delete_node` | `id` | `true` | `rm` (하위 포함) |
| `move_node` | `id`, `parent`, `position` | `true` | `mv` |
| `copy_node` | `id`=원본(`data.original.id`), `parent`, `position` | 새 id 숫자 하나 (객체 아님) | `cp` — 클라이언트는 성공·실패 무관 `refresh()` |
| `analyze` | — | `["문제 설명", ...]` (빈 배열 = 정상) | 정합성 검사 |

계약 포인트:
- **`#` 는 jstree 3 의 가상 루트 id**다. 서버는 `#` → 0(최상위)으로 바꾼다. 포트는 루트 행(`pid=0`) 하나를 최상위로 돌려준다.
- `children: true/false` 로 lazy load 한다 — `true` 면 펼칠 때 `get_node` 를 다시 부른다. 자식 배열을 넣으면 즉시 렌더.
- 그 밖에 노드 JSON 이 받는 키: `icon`, `type`, `state: {opened, disabled, selected}`, `li_attr`, `a_attr` (filebrowser 예).
- **오류 계약**: 실패는 HTTP 500 + `text/plain` 메시지(`ErrorHandler`). 클라이언트는 `.fail` 에서 `refresh()` 로 서버 상태를 다시 읽는다 —
  즉 화면은 **낙관적으로 먼저 바뀌고**, 서버 실패 시에만 되돌아간다. 서버가 실패를 200 으로 감싸서 돌려주면 화면과 DB 가 어긋난 채 남는다.
- 포트는 쓰기 연산까지 `GET` 이다(PHP 데모 호환). 실서비스 API 로 옮길 때는 쓰기를 POST/PUT/DELETE 로 둔다.

## 2. filebrowser (참고 — nested-set 아님)

id 가 **기준 디렉토리 기준 상대 경로**(`/` = 루트)다. `FileSystemTree.real()` 이 `toRealPath()` 후 `startsWith(base)` 로
기준 밖 경로(`..`, 심볼릭 링크 탈출)를 거부하고, 이름은 화이트리스트 정규식(`[^ a-zа-я\-_0-9.]` 가 하나라도 있으면 거부)으로 검사한다.
경로가 id 인 트리 API 를 만들 때 이 두 방어를 기준으로 삼는다.

## 3. A-RMS 와의 차이 — 혼동 주의

A-RMS Frontend-Web 은 jstree 3 이 아니라 **jstree v.pre1.0** 을 쓴다(`reference/jquery-plugins/jstree-v.pre1.0/`, `common.js` `jsTreeBuild()`).
자세한 클라이언트 쪽 내용은 `arms-frontend-web` 스킬 `references/common-js-api.md` §jsTreeBuild.

| 항목 | jstree 3.3.3 데모 | A-RMS (pre1.0 + TreeFramework) |
|---|---|---|
| 플러그인 | `core.data` · `dnd` · `contextmenu` · `state` | `json_data` · `crrm` · `dnd` · `search` · `types` |
| 엔드포인트 | 단일 `api?operation=` | 연산별 `*.do` (`getChildNode.do`, `addNode.do`, `moveNode.do`, …) |
| 부모 파라미터 | `id`/`parent` | `ref` (+ `c_position`, `copy`, `multiCounter`) |
| 노드 id 표기 | 숫자 그대로 | DOM id `node_{c_id}` (`searchNode` 는 `"#node_" + c_id` 반환) |
| 노드 타입 | 없음 | `rel` 속성 = `c_type` (`drive`/`folder`/`default`) |
| 이동·복사 | 별개 operation | `moveNode.do` 하나에 `copy` 플래그 |
| 응답 | 맨 JSON | Backend-Core 응답 봉투(`arms-backend-core` 스킬) |

→ **A-RMS 화면을 jstree 3 으로 올리는 일은 프론트·백엔드 계약 변경**이다. 백엔드만 바꾸지 말고
`contract-reviewer` 로 양쪽을 대조한다. 기존 `*.do` 를 깨지 말고 새 경로로 추가하는 쪽을 기본으로 제안한다.
