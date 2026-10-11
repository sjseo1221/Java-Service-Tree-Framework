/*
 * mock 라우트 표(설계서 §2.5). 경로는 config.apiBase(/api/aiagent) 를 뺀 실제 API 경로다.
 *
 *  { id, method, path, file }      정적 파일. file 은 mock/ 기준 "논리 경로"({변수} 치환).
 *                                    mock-server.store 에 같은 논리 경로가 있으면 그것을 우선한다(오버레이).
 *                                    실제로 읽는 파일은 aliases 를 거친 "물리 경로"다.
 *  { id, method, path, handler }   AIAGENT.mockServer.handlers[handler](params, query, body, headers)
 *  { id, method, path, url }       파일 다운로드·iframe 용(api.url 전용). 문자열 또는 function(params)
 *  fallback                         파일이 404 일 때 돌려줄 값(예: [] · null)
 *
 * ── 확장 지점 ──
 * 새 행은 ROUTES 배열에 추가하고, handler 행이면 mock-server.js 의 handlers 에 같은 이름의 함수를 추가한다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});

  var ROUTES = [
    // ── 공통 ──
    { id: 'API-605', method: 'GET', path: '/i18n/messages', handler: 'i18nMessages' },
    { id: 'API-604', method: 'GET', path: '/codes', handler: 'codes' },
    { id: 'G4', method: 'GET', path: '/products', file: 'products.json' },
    { id: 'G6', method: 'GET', path: '/menu', handler: 'menu' },
    { id: 'API-403', method: 'GET', path: '/workers', file: 'workers.json' },

    // ── 세션 · 단계 ──
    { id: 'API-101', method: 'POST', path: '/sessions', handler: 'createSession' },
    { id: 'G1', method: 'GET', path: '/sessions/{sid}', file: 'sessions/{sid}/session.json' },
    { id: 'API-102', method: 'GET', path: '/sessions/{sid}/stages', file: 'sessions/{sid}/stages.json' },

    // ── 1·2단계 (SCR-03 · SCR-04) ──
    { id: 'API-103', method: 'POST', path: '/sessions/{sid}/uploads', handler: 'upload' },
    { id: 'API-104', method: 'GET', path: '/sessions/{sid}/uploads/{rev}/preview', handler: 'preview' },
    {
      id: 'API-105',
      method: 'GET',
      path: '/sessions/{sid}/uploads/{rev}/file',
      url: function () {
        return A.config.docsBase + encodeURIComponent('요구사항정의서_엑셀양식_v3_1_3.xlsx');
      }
    },
    { id: 'API-106', method: 'GET', path: '/sessions/{sid}/uploads/{rev}/validation', file: 'sessions/{sid}/uploads/{rev}/validation.json' },
    // API-107(validation/export) 는 mock 에서 클라이언트 CSV 생성으로 대체(설계서 I-08) — 라우트 없음
    { id: 'API-108', method: 'POST', path: '/sessions/{sid}/uploads/{rev}/register', handler: 'register' },
    { id: 'G2', method: 'GET', path: '/sessions/{sid}/uploads/{rev}/register', file: 'sessions/{sid}/uploads/{rev}/register.json' },
    { id: 'API-109', method: 'GET', path: '/sessions/{sid}/uploads/{rev}/diff', file: 'sessions/{sid}/uploads/{rev}/diff.json', fallback: null },
    { id: 'API-110', method: 'GET', path: '/requirements/{reqId}/history', file: 'requirements/history/{reqId}.json', fallback: [] },

    // ── 3단계 (SCR-05) ──
    { id: 'API-201', method: 'POST', path: '/sessions/{sid}/reviews', handler: 'startReview' },
    { id: 'API-202', method: 'GET', path: '/sessions/{sid}/reviews', handler: 'reviews' },
    { id: 'API-203', method: 'GET', path: '/sessions/{sid}/reviews/{round}/findings', handler: 'findings' },
    { id: 'API-204', method: 'PATCH', path: '/findings/{findingId}', handler: 'disposeFinding' },
    { id: 'API-205', method: 'PATCH', path: '/requirements/{reqId}', handler: 'editRequirement' },
    { id: 'API-206', method: 'POST', path: '/sessions/{sid}/stages/REVIEW/confirm', handler: 'confirmReview' },
    { id: 'API-207', method: 'DELETE', path: '/sessions/{sid}/stages/{stage}/confirm', handler: 'releaseStage' },

    // ── 4~6단계 (SCR-06) ──
    { id: 'API-301', method: 'POST', path: '/sessions/{sid}/srs', handler: 'generateSrs' },
    { id: 'API-302', method: 'POST', path: '/sessions/{sid}/sds', handler: 'generateSds' },
    { id: 'API-303', method: 'GET', path: '/sessions/{sid}/artifacts', handler: 'artifacts' },
    {
      id: 'API-304',
      method: 'GET',
      path: '/artifacts/{artifactId}/pdf',
      url: function (params) {
        return A.mockServer.pdfUrl(params.artifactId); // artifacts 의 mockPdf(mock 전용 필드, 설계서 I-01) → /__docs/
      }
    },
    { id: 'API-305', method: 'POST', path: '/artifacts/{artifactId}/confirm', handler: 'confirmArtifact' },
    { id: 'API-306', method: 'POST', path: '/artifacts/{artifactId}/reject', handler: 'rejectArtifact' },
    { id: 'API-307', method: 'GET', path: '/sessions/{sid}/traceability', handler: 'traceability' },

    // ── 7~9단계 (SCR-07 · SCR-08) ──
    { id: 'API-401', method: 'GET', path: '/sessions/{sid}/backlog', handler: 'backlog' },
    { id: 'API-402', method: 'PATCH', path: '/backlog/{itemId}', handler: 'excludeItem' },
    { id: 'API-404', method: 'PUT', path: '/backlog/{itemId}/assignment', handler: 'assign' },
    { id: 'API-405', method: 'POST', path: '/executions/preview', handler: 'previewExecution' },
    { id: 'API-406', method: 'POST', path: '/executions', handler: 'createExecutions' },
    { id: 'G5', method: 'GET', path: '/sessions/{sid}/executions', handler: 'executions' },
    { id: 'API-407', method: 'GET', path: '/executions/{execId}', handler: 'execution' },
    { id: 'API-408', method: 'POST', path: '/executions/{execId}/cancel', handler: 'cancelExecution' },
    { id: 'API-410', method: 'POST', path: '/executions/{execId}/scm', handler: 'scm' },

    // ── 공통 비동기 작업 ──
    { id: 'API-601', method: 'GET', path: '/jobs/{jobId}', handler: 'job' },

    // ── 운영 기능(SCR-09 · 10 · 11) · 감사(SCR-12) ──
    // 파일 존재를 핸들러가 먼저 확인한다(없는 파일을 요청하지 않음 — 콘솔 404 방지). mockFail=mat|knot 은 핸들러가 판정.
    { id: 'API-501', method: 'GET', path: '/monitor/tasks', handler: 'monitorTasks' },
    { id: 'API-502', method: 'GET', path: '/monitor/tasks/{taskName}/log', handler: 'monitorLog' },
    { id: 'API-503', method: 'GET', path: '/knowledge/tree', handler: 'knowledgeTree' },
    { id: 'API-504', method: 'GET', path: '/knowledge/docs', handler: 'knowledgeDoc' },
    { id: 'API-505', method: 'GET', path: '/agents', handler: 'agents' },
    { id: 'G3', method: 'GET', path: '/agents/{name}', handler: 'agentDetail' },
    { id: 'API-506', method: 'PUT', path: '/agents/{name}', handler: 'saveAgent' },
    { id: 'API-507', method: 'PATCH', path: '/agents/{name}', handler: 'setAgentEnabled' },
    { id: 'API-508', method: 'GET', path: '/skills', handler: 'skills' },
    { id: 'G3', method: 'GET', path: '/skills/{name}', handler: 'skillDetail' },
    { id: 'API-509', method: 'PUT', path: '/skills/{name}', handler: 'saveSkill' },
    { id: 'API-510', method: 'PATCH', path: '/skills/{name}', handler: 'setSkillEnabled' },
    { id: 'API-602', method: 'GET', path: '/audit', handler: 'audit' },
    { id: 'API-603', method: 'GET', path: '/requirements/{reqId}/trace', handler: 'trace' }
  ];

  // 논리 경로 → 물리 경로 별칭(설계서 §4.2 · §4.3). 위에서부터 첫 일치 1건만 적용.
  var ALIASES = [
    [/^sessions\/\d+\/uploads\/99\//, 'sessions/1001/uploads/2/'], // 정상 업로드 시나리오(rev 2 별칭)
    [/^sessions\/\d+\/uploads\/98\//, 'sessions/1001/uploads/98/'], // 오류 샘플 시나리오
    [/^sessions\/1002\/uploads\/1\//, 'sessions/1001/uploads/2/']
  ];

  function compile(route) {
    var names = [];
    var src = route.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\w+)\\?\}/g, function (m, n) {
      names.push(n);
      return '([^/]+)';
    });
    route._re = new RegExp('^' + src + '$');
    route._names = names;
    return route;
  }

  function fill(template, params) {
    return template.replace(/\{(\w+)\}/g, function (m, n) {
      return params[n] != null ? params[n] : m;
    });
  }

  A.mockRoutes = {
    routes: ROUTES,

    /** 런타임 추가(선택). 표에 직접 적는 것을 기본으로 한다. */
    add: function (route) {
      ROUTES.push(compile(route));
    },

    match: function (method, path) {
      var m = String(method).toUpperCase();
      for (var i = 0; i < ROUTES.length; i++) {
        var r = ROUTES[i];
        if (!r._re) compile(r);
        if (r.method !== m) continue;
        var hit = r._re.exec(path);
        if (!hit) continue;
        var params = {};
        r._names.forEach(function (n, idx) {
          params[n] = decodeURIComponent(hit[idx + 1]);
        });
        return { route: r, params: params };
      }
      return null;
    },

    fill: fill,

    /** 논리 경로 → 물리 경로 */
    resolve: function (logical) {
      for (var i = 0; i < ALIASES.length; i++) {
        if (ALIASES[i][0].test(logical)) return logical.replace(ALIASES[i][0], ALIASES[i][1]);
      }
      return logical;
    }
  };
})(window);
