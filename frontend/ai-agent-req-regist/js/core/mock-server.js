/*
 * mock 서버: 메모리 오버레이 · 상태 변경 핸들러 · 단계 게이트(서버 판정 흉내).
 * 화면 비활성화는 보조 수단이고, 판정은 여기 gate 한 곳에서 다시 한다(설계서 P4, SDS ARC-02).
 * 새로고침하면 메모리 상태는 초기화된다(목업 범위).
 *
 * ── 확장 지점 ──
 * 5단계 이후 핸들러(startReview · disposeFinding · generateDoc · job …)는 아래 handlers 객체에 추가한다.
 * 핸들러 시그니처: function (params, query, body, headers) → 값 | Promise<값>. 오류는 MS.fail(...) 을 throw.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var ACTOR = '이민규'; // mock 사용자(단일 사용자 가정, 설계서 I-16)
  var store = {}; // 논리 경로 → 객체(오버레이)
  var seq = { session: 2000 };

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseFlags() {
    var q = new URLSearchParams(w.location.search);
    function list(name) {
      return (q.get(name) || '')
        .split(',')
        .map(function (s) {
          return s.trim().toLowerCase();
        })
        .filter(Boolean);
    }
    return { fail: list('mockFail'), unset: list('mockUnset') };
  }

  function fail(status, code, details, message) {
    return { status: status, code: code, message: message || code, details: details || [], traceId: 'mock-' + Date.now().toString(36) };
  }

  function fetchFile(physical) {
    return fetch(A.config.mockBase + physical, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw fail(res.status, res.status === 404 ? 'NOT_FOUND' : 'UNKNOWN', [physical]);
      return res.json();
    });
  }

  var MS = {
    store: store,
    flags: parseFlags(),
    fail: fail,
    clone: clone,
    nowIso: nowIso,
    actor: ACTOR,

    /** 오버레이 우선 읽기(복제본 반환). 파일 라우트용. */
    read: function (logical) {
      if (Object.prototype.hasOwnProperty.call(store, logical)) return Promise.resolve(clone(store[logical]));
      return fetchFile(A.mockRoutes.resolve(logical));
    },

    /** 변경용 로드: store 에 올려 두고 그 객체(참조)를 돌려준다. */
    load: function (logical) {
      if (Object.prototype.hasOwnProperty.call(store, logical)) return Promise.resolve(store[logical]);
      return fetchFile(A.mockRoutes.resolve(logical)).then(function (data) {
        if (!Object.prototype.hasOwnProperty.call(store, logical)) store[logical] = data;
        return store[logical];
      });
    },

    put: function (logical, value) {
      store[logical] = value;
      return value;
    }
  };

  // ── 단계 상태 ──
  function stagesKey(sid) {
    return 'sessions/' + sid + '/stages.json';
  }

  function sessionKey(sid) {
    return 'sessions/' + sid + '/session.json';
  }

  function loadSession(sid) {
    return MS.load(sessionKey(sid)).catch(function (err) {
      if (err && err.status === 404) throw fail(404, 'NOT_FOUND', ['session ' + sid]);
      throw err;
    });
  }

  /** changes: {stageNo: status}. COMPLETED 로 바뀌는 단계에 확정자·시각을 기록한다. */
  function setStages(sid, changes) {
    return Promise.all([MS.load(stagesKey(sid)), loadSession(sid)]).then(function (r) {
      var stages = r[0];
      var session = r[1];
      Object.keys(changes).forEach(function (no) {
        var s = stages[Number(no) - 1];
        if (!s) return;
        s.status = changes[no];
        if (s.status === 'COMPLETED') {
          s.confirmedBy = ACTOR;
          s.confirmedAt = nowIso();
        } else {
          s.confirmedBy = null;
          s.confirmedAt = null;
        }
      });
      var cur = stages.filter(function (s) {
        return s.status === 'RUNNING';
      })[0] || stages.filter(function (s) {
        return s.status === 'WAITING';
      })[0];
      session.currentStage = cur ? cur.stage : stages[stages.length - 1].stage;
      session.overallState = cur ? 'RUNNING' : 'COMPLETED';
      return stages;
    });
  }

  MS.setStages = setStages;

  // ── 감사 기록(API-602 오버레이): 상태 변경 핸들러가 성공 시 적재한다. 수정 · 삭제 경로 없음 ──
  var auditLog = [];
  seq.audit = 90000;

  MS.audit = function (action, targetType, targetId, reqId, reason, aiMeta) {
    auditLog.push({
      auditId: ++seq.audit,
      actedAt: nowIso(),
      actor: ACTOR,
      action: action,
      targetType: targetType,
      targetId: String(targetId),
      reqId: reqId || null,
      reason: reason || null,
      aiMeta: aiMeta || null
    });
  };

  function aiMeta(inputSummary) {
    return { model: 'claude-main', inputSummary: inputSummary, generatedAt: null }; // 생성 완료 시각은 job 완료 후 확정(목업은 미기록)
  }

  /** 단일 판정점: 직전 단계가 COMPLETED 가 아니면 409 AGT-GATE-001 */
  MS.gate = {
    assertEnterable: function (sid, stageNo) {
      return MS.load(stagesKey(sid)).then(
        function (stages) {
          if (stageNo <= 1) return stages;
          var prev = stages[stageNo - 2];
          if (!prev || prev.status !== 'COMPLETED') {
            throw fail(409, 'AGT-GATE-001', [prev ? prev.stage : 'STAGE_' + (stageNo - 1), prev ? prev.status : 'UNKNOWN']);
          }
          return stages;
        },
        function (err) {
          if (err && err.status === 404) throw fail(404, 'NOT_FOUND', ['session ' + sid]);
          throw err;
        }
      );
    }
  };

  function uploadKey(sid, rev, name) {
    return 'sessions/' + sid + '/uploads/' + rev + '/' + name;
  }

  function stageNoOf(code) {
    var def = A.config.stages.filter(function (s) {
      return s.code === code;
    })[0];
    return def ? def.no : null;
  }

  function blank(v) {
    return v == null || !String(v).trim();
  }

  // ── 서버 판정 흉내(5단계 이후분). 모든 AGT 오류 판정은 gate 에서만 한다 ──
  var DEFAULT_BRANCHES = ['main', 'master'];
  // 설계서 §4.6: 형상 반영 시 write_scope 밖 변경이 검출되는 시드 실행(REQ-F-002)
  var MOCK_SCOPE_VIOLATION_ID = 'd4b7f2a9-5e6c-4d8b-9a1f-000000000002';
  var MOCK_SCOPE_VIOLATION_PATHS = ['docs/file/요구사항정의서_엑셀양식_v3_1_3.xlsx'];

  Object.assign(MS.gate, {
    /** 확정된 단계의 대상은 수정 불가(AGT-IMM-001) */
    assertMutable: function (sid, stageNo) {
      return MS.load(stagesKey(sid)).then(function (stages) {
        var s = stages[stageNo - 1];
        if (s && s.status === 'COMPLETED') throw fail(409, 'AGT-IMM-001', [s.stage + '=COMPLETED']);
        return stages;
      });
    },

    /** 확정 해제는 확정(COMPLETED) 단계에서만 */
    assertCompleted: function (sid, stageNo) {
      return MS.load(stagesKey(sid)).then(function (stages) {
        var s = stages[stageNo - 1];
        if (!s || s.status !== 'COMPLETED') throw fail(409, 'AGT-STATE-001', [(s ? s.stage : stageNo) + '=' + (s ? s.status : 'UNKNOWN')]);
        return stages;
      });
    },

    /** 반려 · 제외 · 취소 · 확정 해제 사유(AGT-VAL-004) */
    requireReason: function (reason) {
      if (blank(reason)) throw fail(400, 'AGT-VAL-004', ['reason']);
      return String(reason).trim();
    },

    /** 검토 확정: High 미처리 0건(AGT-GATE-003). 설계서 I-09 — 서버는 High OPEN 만 판정 */
    assertNoOpenHigh: function (findings) {
      var ids = findings
        .filter(function (f) {
          return f.severity === 'HIGH' && f.state === 'OPEN';
        })
        .map(function (f) {
          return f.findingId;
        });
      if (ids.length) throw fail(409, 'AGT-GATE-003', ids);
    },

    assertNotConfirmed: function (artifact) {
      if (artifact.confirmed) throw fail(409, 'AGT-IMM-001', [artifact.type + ' v' + artifact.version]);
      if (artifact.rejected) throw fail(409, 'AGT-STATE-001', [artifact.type + ' v' + artifact.version + '=REJECTED']);
    },

    /** 같은 대상의 비동기 작업 중복 금지 */
    assertNoActiveJob: function (scopeKey) {
      var active = Object.keys(jobs).some(function (id) {
        var j = jobs[id];
        return j.scopeKey === scopeKey && (j.state === 'QUEUED' || j.state === 'RUNNING');
      });
      if (active) throw fail(409, 'AGT-STATE-001', [scopeKey]);
    },

    /** 배정: main≠sub(AGT-VAL-005), 미승인 워커(AGT-AUTH-002), 미등록 값(AGT-VAL-002) */
    assertAssignment: function (a, workersDoc) {
      if (a.mainWorker && a.subWorker && a.mainWorker === a.subWorker) throw fail(400, 'AGT-VAL-005', [a.mainWorker]);
      var workers = workersDoc.workers || [];
      ['mainWorker', 'subWorker'].forEach(function (field) {
        if (!a[field]) return;
        var w2 = workers.filter(function (x) {
          return x.name === a[field];
        })[0];
        if (!w2) throw fail(400, 'AGT-VAL-002', [field + '=' + a[field]]);
        if (!w2.approved) throw fail(403, 'AGT-AUTH-002', [a[field]]);
      });
      if (a.subAgent) {
        var ok = (workersDoc.subAgents || []).some(function (x) {
          return x.name === a.subAgent && x.enabled;
        });
        if (!ok) throw fail(400, 'AGT-VAL-002', ['subAgent=' + a.subAgent]);
      }
    },

    /** 실행 대상: 제외 아님 + 메인 워커 배정 + 진행 중 실행 없음(AGT-STATE-001) */
    assertExecutable: function (items, executions) {
      var bad = [];
      items.forEach(function (it) {
        var active = executions.some(function (e) {
          return e.itemId === it.itemId && (e.state === 'QUEUED' || e.state === 'RUNNING');
        });
        if (it.excluded) bad.push(it.itemId + ': excluded');
        else if (!it.assignment || !it.assignment.mainWorker) bad.push(it.itemId + ': mainWorker');
        else if (active) bad.push(it.itemId + ': active');
      });
      if (bad.length) throw fail(409, 'AGT-STATE-001', bad);
    },

    assertApprovedWorkers: function (items, workersDoc) {
      items.forEach(function (it) {
        MS.gate.assertAssignment(it.assignment || {}, workersDoc);
      });
    },

    /** 7필드 누락 시 전송 거부(API-405 비고) */
    assertPayloadComplete: function (previews) {
      var missing = [];
      previews.forEach(function (p) {
        Object.keys(p.payload).forEach(function (k) {
          if (blank(p.payload[k])) missing.push(p.itemId + ': ' + k);
        });
      });
      if (missing.length) throw fail(400, 'AGT-VAL-002', missing);
    },

    assertCancelable: function (exec) {
      if (exec.state !== 'QUEUED' && exec.state !== 'RUNNING') throw fail(409, 'AGT-STATE-001', [exec.execId + '=' + exec.state]);
    },

    /** 형상 반영: 사용자 승인 · 기본 브랜치 금지 · 검증 통과 · write_scope 준수(AGT-SCOPE-001) */
    assertScm: function (exec, body) {
      if (!body || body.approve !== true) throw fail(400, 'AGT-VAL-002', ['approve']);
      if (blank(body.branch)) throw fail(400, 'AGT-VAL-002', ['branch']);
      var branch = String(body.branch).trim();
      if (DEFAULT_BRANCHES.indexOf(branch.toLowerCase()) >= 0) throw fail(409, 'AGT-SCOPE-001', ['branch=' + branch]);
      if (exec.scm) throw fail(409, 'AGT-IMM-001', [exec.scm.branch]);
      if (exec.state !== 'SUCCEEDED' || !exec.verification || exec.verification.result !== 'PASSED') {
        throw fail(409, 'AGT-STATE-001', ['state=' + exec.state, 'verification=' + (exec.verification ? exec.verification.result : 'NONE')]);
      }
      if (exec.execId === MOCK_SCOPE_VIOLATION_ID) throw fail(409, 'AGT-SCOPE-001', MOCK_SCOPE_VIOLATION_PATHS.slice());
      return branch;
    }
  });

  // ── job 시뮬레이터(API-601, 설계서 §2.6): 조회마다 +25, 100 이면 완료 콜백 실행 ──
  var jobs = {};
  var jobHooks = {};
  seq.job = 0;

  function startJob(type, scopeKey, onDone) {
    var id = 'job-' + Date.now().toString(36) + '-' + ++seq.job;
    jobs[id] = { jobId: id, type: type, state: 'QUEUED', progress: 0, startedAt: nowIso(), error: null, scopeKey: scopeKey };
    jobHooks[id] = onDone;
    return jobs[id];
  }

  function publicJob(j) {
    return { jobId: j.jobId, type: j.type, state: j.state, progress: j.progress, startedAt: j.startedAt, error: j.error };
  }

  // ── 공통 조회 도우미 ──
  /** 파일이 없으면 def 를 store 에 올린다(변경 대상 컬렉션용). */
  var SEED_SIDS = [1001, 1002];

  /** 파일이 없는 세션(새로 만든 세션)의 리소스는 요청하지 않는다(콘솔 404 방지). */
  function noFile(logical) {
    if (Object.prototype.hasOwnProperty.call(store, logical)) return false;
    var m = /^sessions\/(\d+)\//.exec(A.mockRoutes.resolve(logical));
    return !!m && SEED_SIDS.indexOf(Number(m[1])) < 0;
  }

  MS.loadOr = function (logical, def) {
    if (noFile(logical)) return Promise.resolve((store[logical] = clone(def)));
    return MS.load(logical).catch(function (err) {
      if (err && err.status === 404) {
        if (!Object.prototype.hasOwnProperty.call(store, logical)) store[logical] = clone(def);
        return store[logical];
      }
      throw err;
    });
  };

  /** 파일이 없으면 def 의 복제본(store 에 올리지 않음). */
  MS.readOr = function (logical, def) {
    if (noFile(logical)) return Promise.resolve(clone(def));
    return MS.read(logical).catch(function (err) {
      if (err && err.status === 404) return clone(def);
      throw err;
    });
  };

  /** store 의 sessions/{sid}/{name} 컬렉션에서 id 로 찾는다. 없으면 시드 세션 파일을 올린 뒤 다시 찾는다. */
  function findInSessions(name, idField, id) {
    function scan() {
      var re = new RegExp('^sessions/(\\d+)/' + name.replace('.', '\\.') + '$');
      var keys = Object.keys(store);
      for (var i = 0; i < keys.length; i++) {
        var m = re.exec(keys[i]);
        if (!m || !Array.isArray(store[keys[i]])) continue;
        var list = store[keys[i]];
        for (var j = 0; j < list.length; j++) {
          if (String(list[j][idField]) === String(id)) return { sid: m[1], item: list[j], list: list };
        }
      }
      return null;
    }
    var hit = scan();
    if (hit) return Promise.resolve(hit);
    return Promise.all(
      SEED_SIDS.map(function (sid) {
        return MS.loadOr('sessions/' + sid + '/' + name, []);
      })
    ).then(function () {
      var again = scan();
      if (!again) throw fail(404, 'NOT_FOUND', [idField + '=' + id]);
      return again;
    });
  }

  function latestRows(sid) {
    return loadSession(sid).then(function (session) {
      var rev = session.latestRevision;
      if (!rev) return [];
      return MS.load(uploadKey(sid, rev, 'preview.json')).then(function (p) {
        return p.rows.filter(function (r) {
          return r.reqId;
        });
      });
    });
  }

  /** 요구사항 상세 내용(7블록)에서 [블록명] 본문을 꺼낸다. */
  function block(detail, title) {
    var re = new RegExp('\\[' + title.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\]\\n([\\s\\S]*?)(?:\\n\\n\\[|$)');
    var m = re.exec(detail || '');
    return m ? m[1].trim() : '';
  }

  function workTypeOf(status) {
    return status === '개발중' || status === '테스트중' ? 'CODE' : 'ANALYSIS'; // 설계서 I-11(유도값)
  }

  function findingsKey(sid, round) {
    return 'sessions/' + sid + '/reviews/' + round + '/findings.json';
  }

  function parseFindingId(id) {
    var m = /^FND-(\d+)-(\d+)-\d+$/.exec(String(id));
    if (!m) throw fail(404, 'NOT_FOUND', ['findingId=' + id]);
    return { sid: m[1], round: Number(m[2]) };
  }

  function severityCount(list) {
    var c = { high: 0, medium: 0, low: 0 };
    list.forEach(function (f) {
      var k = String(f.severity).toLowerCase();
      if (c[k] != null) c[k]++;
    });
    return c;
  }

  function uuid() {
    return A.api.newIdempotencyKey();
  }

  // 생성 산출물이 가리키는 mock PDF(실제 docs/file 원본, SHA-256 은 원본 파일 기준)
  var MOCK_PDF = {
    SRS: { file: 'SRS_소프트웨어요구사항명세서_v1.0.pdf', checksum: 'd86ad66379ecd56653d1f659a4cf5fab68932acc33261836801e58126b3988dc' },
    SDS: { file: 'SDS_소프트웨어설계명세서_v1.0.pdf', checksum: 'efc175993b692dde674e58e8d22a644db1c17daca90887eda1480acce677d333' }
  };
  var DOC_STAGE = { SRS: { gen: 4, confirm: 5 }, SDS: { gen: 6, confirm: 6 } };

  /** API-304 URL(api.url 은 동기). artifacts 가 store 에 올라와 있어야 한다(API-303 조회 시 올라감). */
  MS.pdfUrl = function (artifactId) {
    var keys = Object.keys(store);
    for (var i = 0; i < keys.length; i++) {
      if (!/^sessions\/\d+\/artifacts\.json$/.test(keys[i])) continue;
      var hit = store[keys[i]].filter(function (a) {
        return a.artifactId === artifactId;
      })[0];
      if (hit && hit.mockPdf) return A.config.docsBase + encodeURIComponent(hit.mockPdf);
    }
    return '#';
  };

  /** SDS 확정 시 구현 목록 자동 생성(파일이 없는 세션만). 배정은 [Worker Settings] 추천값(설계서 I-04 대체 규칙). */
  var itemSeq = 9000;
  function ensureBacklog(sid) {
    return MS.loadOr('sessions/' + sid + '/backlog.json', []).then(function (list) {
      if (list.length) return list;
      return Promise.all([latestRows(sid), MS.readOr('sessions/' + sid + '/traceability-sds.json', null)]).then(function (r) {
        var trace = r[1];
        return (trace ? Promise.resolve(trace) : MS.read('sessions/1001/traceability-sds.json')).then(function (tr) {
          var refs = {};
          tr.forEach(function (x) {
            refs[x.sourceId] = x.targetIds.filter(function (id) {
              return /^(SCR|API)-/.test(id);
            });
          });
          r[0].forEach(function (row) {
            var m = /MainWorker-SubAgent\s*:\s*([\w-]+)/.exec(row.detail || '');
            list.push({
              itemId: ++itemSeq,
              reqId: row.reqId,
              sdsRefs: refs[row.reqId] || [],
              excluded: false,
              excludeReason: null,
              assignment: { mainWorker: 'claude-main', subWorker: 'claude-reviewer', subAgent: m ? m[1] : null, recommendApplied: true }
            });
          });
          return list;
        });
      });
    });
  }

  // 실행 시뮬레이터(API-407): 새 실행만 조회 횟수로 전이. 시드 실행은 그대로 둔다.
  var MAX_CONCURRENT = 3; // 동시 실행 상한(가정값, TBD-02)
  var execSim = {}; // execId → {polls, labels}
  var idem = {}; // Idempotency-Key → 응답
  var prSeq = 12;

  function advanceExec(exec) {
    var sim = execSim[exec.execId];
    if (!sim || (exec.state !== 'QUEUED' && exec.state !== 'RUNNING')) return;
    sim.polls++;
    if (sim.polls >= 2 && exec.state === 'QUEUED') {
      exec.state = 'RUNNING';
      exec.startedAt = nowIso();
    }
    if (sim.polls >= 4) {
      exec.state = 'SUCCEEDED';
      exec.finishedAt = nowIso();
      exec.artifacts = [
        { artifactId: uuid(), type: 'CODE_DIFF', name: exec.reqId + '.diff' },
        { artifactId: uuid(), type: 'LOG', name: 'tasks/aiagent-' + exec.reqId.toLowerCase() + '/log.md' }
      ];
      exec.verification = {
        result: 'PASSED',
        items: sim.labels.map(function (label) {
          return { label: label, passed: true };
        })
      };
      delete execSim[exec.execId];
    }
  }

  function payloadOf(item, row) {
    var a = item.assignment || {};
    var out = block(row && row.detail, '입력 / 출력')
      .split('\n')
      .filter(function (l) {
        return /^-\s*출력/.test(l);
      })
      .map(function (l) {
        return l.replace(/^-\s*출력\s*:\s*/, '');
      })
      .join('\n');
    var repos = [];
    block(row && row.detail, '작업 대상')
      .split('\n')
      .forEach(function (l) {
        var m = /Java-Service-Tree-Framework[ -]([A-Za-z]+(?:-[A-Za-z]+)*)/.exec(l);
        if (m) {
          var name = 'Java-Service-Tree-Framework-' + m[1];
          if (repos.indexOf(name) < 0) repos.push(name);
        }
      });
    return {
      목표: block(row && row.detail, '개요'),
      성격: workTypeOf(row && row.status),
      target_repo: repos.join(', '),
      write_scope: '', // 쓰기 범위는 사용자가 명시 승인한다(REQ-SE-002) — 기본값 없음
      워커: [a.mainWorker, a.subWorker, a.subAgent].filter(Boolean).join(' / '),
      산출물: out,
      제약: block(row && row.detail, '제약 조건 / 비기능 요구사항')
    };
  }

  function findItems(itemIds) {
    if (!Array.isArray(itemIds) || !itemIds.length) return Promise.reject(fail(400, 'AGT-VAL-002', ['itemIds']));
    return Promise.all(
      itemIds.map(function (id) {
        return findInSessions('backlog.json', 'itemId', id);
      })
    ).then(function (hits) {
      var sid = hits[0].sid;
      if (
        hits.some(function (h) {
          return h.sid !== sid;
        })
      )
        throw fail(400, 'AGT-VAL-002', ['itemIds: mixed sessions']);
      return {
        sid: sid,
        items: hits.map(function (h) {
          return h.item;
        })
      };
    });
  }

  function buildPreviews(sid, items) {
    return latestRows(sid).then(function (rows) {
      var byReq = {};
      rows.forEach(function (r) {
        byReq[r.reqId] = r;
      });
      return items.map(function (it) {
        return { itemId: it.itemId, payload: payloadOf(it, byReq[it.reqId]) };
      });
    });
  }

  function finishDocJob(sid, type) {
    var st = DOC_STAGE[type];
    return MS.loadOr('sessions/' + sid + '/artifacts.json', []).then(function (list) {
      var version = list
        .filter(function (a) {
          return a.type === type;
        })
        .reduce(function (m, a) {
          return Math.max(m, a.version);
        }, 0);
      list.push({
        artifactId: uuid(),
        type: type,
        version: version + 1,
        checksum: MOCK_PDF[type].checksum,
        confirmed: false,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: nowIso(),
        mockPdf: MOCK_PDF[type].file
      });
      var traceKey = 'sessions/' + sid + '/traceability-' + type.toLowerCase() + '.json';
      return MS.readOr(traceKey, null)
        .then(function (tr) {
          if (tr && tr.length) return null;
          return MS.read('sessions/1001/traceability-' + type.toLowerCase() + '.json').then(function (seed) {
            MS.put(traceKey, seed); // 새 세션: 1001 의 SDS §9 매트릭스를 그대로 씀(같은 35건)
          });
        })
        .then(function () {
          var changes = {};
          if (type === 'SRS') {
            changes[st.gen] = 'COMPLETED';
            changes[st.confirm] = 'RUNNING';
          } else {
            changes[st.gen] = 'RUNNING'; // SDS: 생성 완료 = 확정 대기(설계서 §2.6)
          }
          return setStages(sid, changes);
        });
    });
  }

  function finishReview(sid, round, scope, targets, startedAt) {
    var logical = findingsKey(sid, round);
    // store 를 거치지 않고 파일을 직접 본다(조회 중 올라간 빈 목록 무시). 없으면 1002 1회차를 원본으로 재사용.
    return (noFile(logical) ? Promise.reject(fail(404, 'NOT_FOUND', [logical])) : fetchFile(A.mockRoutes.resolve(logical)))
      .catch(function () {
        return MS.read(findingsKey(1002, 1));
      })
      .then(function (src) {
        if (scope !== 'CATEGORY') return { src: src, l2: null };
        return latestRows(sid).then(function (rows) {
          var l2 = {};
          rows.forEach(function (r) {
            l2[r.reqId] = r.l2;
          });
          return { src: src, l2: l2 };
        });
      })
      .then(function (r) {
        var list = r.src
          .filter(function (f) {
            if (scope === 'SELECTED') return targets.indexOf(f.reqId) >= 0;
            if (scope === 'CATEGORY') return targets.indexOf(r.l2[f.reqId]) >= 0;
            return true;
          })
          .map(function (f, i) {
            return Object.assign({}, f, {
              findingId: 'FND-' + sid + '-' + round + '-' + (i < 9 ? '0' : '') + (i + 1),
              state: 'OPEN',
              reason: null
            });
          });
        MS.put(logical, list);
        return MS.loadOr('sessions/' + sid + '/reviews.json', []).then(function (reviews) {
          reviews.push({ round: round, startedAt: startedAt, finishedAt: nowIso(), findingCount: severityCount(list) });
        });
      });
  }

  function allFindings(sid) {
    return MS.loadOr('sessions/' + sid + '/reviews.json', []).then(function (reviews) {
      return Promise.all(
        reviews.map(function (rv) {
          return MS.readOr(findingsKey(sid, rv.round), []);
        })
      ).then(function (lists) {
        return { reviews: reviews, findings: [].concat.apply([], lists) };
      });
    });
  }

  var reqVersions = {}; // sid|reqId → version(등록 시 1)

  // ── 핸들러 ──
  MS.handlers = {
    i18nMessages: function (params, query) {
      var lang = A.i18n.normalize(query.lang) || A.config.defaultLang;
      return MS.read('i18n/messages.' + lang + '.json');
    },

    codes: function (params, query) {
      return MS.read('codes.json').then(function (list) {
        return query.group
          ? list.filter(function (c) {
              return c.group === query.group;
            })
          : list;
      });
    },

    menu: function () {
      return MS.read('menu.json').then(function (data) {
        (data.items || []).forEach(function (it) {
          if (it.integration && MS.flags.unset.indexOf(String(it.integration).toLowerCase()) >= 0) it.available = false;
        });
        return data;
      });
    },

    /** API-101 */
    createSession: function (params, query, body) {
      body = body || {};
      if (!body.pdServiceId || !body.targetVersion) throw fail(400, 'AGT-VAL-002', ['pdServiceId', 'targetVersion']);
      return MS.read('products.json').then(function (products) {
        var product = products.filter(function (p) {
          return String(p.pdServiceId) === String(body.pdServiceId);
        })[0];
        if (!product || product.versions.indexOf(body.targetVersion) < 0) throw fail(400, 'AGT-VAL-002', ['pdServiceId', 'targetVersion']);
        var sid = ++seq.session;
        var stages = A.config.stages.map(function (s) {
          return { stage: s.code, status: s.no === 1 ? 'WAITING' : 'LOCKED', confirmedBy: null, confirmedAt: null };
        });
        MS.put(stagesKey(sid), stages);
        MS.put(sessionKey(sid), {
          sessionId: sid,
          pdServiceId: product.pdServiceId,
          pdServiceName: product.name,
          targetVersion: body.targetVersion,
          currentStage: 'UPLOAD',
          overallState: 'RUNNING',
          latestRevision: 0,
          revisions: [],
          createdBy: ACTOR,
          createdAt: nowIso()
        });
        return { sessionId: sid, stages: clone(stages) };
      });
    },

    /** API-103: 파일명에 'error' 가 들어가면 rev 98(오류 샘플), 아니면 rev 99(정상) */
    upload: function (params, query, body) {
      var sid = params.sid;
      var file = body && typeof body.get === 'function' ? body.get('file') : null;
      if (!file || !file.name) throw fail(400, 'AGT-VAL-001', ['file']);
      if (!/\.xlsx$/i.test(file.name)) throw fail(400, 'AGT-VAL-001', [file.name]);
      if (file.size > A.config.upload.maxBytes) throw fail(400, 'AGT-VAL-001', [String(file.size)]);
      return MS.gate.assertEnterable(sid, 1).then(function (stages) {
        var rev = /error/i.test(file.name) ? 98 : 99;
        return Promise.all([MS.read(uploadKey(sid, rev, 'validation.json')), MS.read(uploadKey(sid, rev, 'preview.json'))]).then(function (r) {
          var validation = r[0];
          var preview = r[1];
          if (preview.total > A.config.upload.maxRows) throw fail(400, 'AGT-VAL-001', ['rows=' + preview.total]);
          var after = stages[0].status === 'WAITING' ? setStages(sid, { 1: 'RUNNING' }) : Promise.resolve();
          return after.then(function () {
            MS.audit('UPLOAD', 'UPLOAD', 'rev ' + rev, null, null);
            return { revision: rev, rowCount: preview.total, validation: { errors: validation.errors, warnings: validation.warnings } };
          });
        });
      });
    },

    /** API-104: 파일을 page(1부터)·size 로 자른다. */
    preview: function (params, query) {
      return MS.read(uploadKey(params.sid, params.rev, 'preview.json')).then(function (data) {
        var size = Math.max(1, Math.min(Number(query.size) || A.config.previewPageSize, A.config.upload.maxRows));
        var page = Math.max(1, Number(query.page) || 1);
        return { rows: data.rows.slice((page - 1) * size, page * size), total: data.total };
      });
    },

    /** API-108: 오류 0건일 때만 전건 등록(AGT-GATE-002). */
    register: function (params, query, body) {
      var sid = params.sid;
      var rev = Number(params.rev);
      if (!body || body.confirm !== true) throw fail(400, 'AGT-VAL-002', ['confirm']);
      return MS.gate.assertEnterable(sid, 1).then(function (stages) {
        return Promise.all([MS.read(uploadKey(sid, rev, 'validation.json')), MS.read(uploadKey(sid, rev, 'preview.json')), loadSession(sid)]).then(function (r) {
          var validation = r[0];
          var rows = r[1].rows.filter(function (row) {
            return row.reqId;
          });
          var session = r[2];
          if (validation.errorCount > 0) {
            var first = validation.errors[0] || {};
            throw fail(409, 'AGT-GATE-002', ['errorCount=' + validation.errorCount, 'rowNo=' + first.rowNo + ', column=' + first.column]);
          }
          var categories = {};
          rows.forEach(function (row) {
            categories[row.l1 + '/' + row.l2] = true;
          });
          var result = { registered: rows.length, treeNodesCreated: Object.keys(categories).length, warnings: clone(validation.warnings) };
          MS.put(uploadKey(sid, rev, 'register.json'), result);
          session.revisions = session.revisions || [];
          if (session.revisions.indexOf(rev) < 0) session.revisions.push(rev);
          session.latestRevision = rev;
          var changes = { 1: 'COMPLETED', 2: 'COMPLETED' };
          if (stages[2].status === 'LOCKED') changes[3] = 'WAITING';
          return setStages(sid, changes).then(function () {
            MS.audit('REGISTER', 'UPLOAD', 'rev ' + rev, null, null);
            return clone(result);
          });
        });
      });
    },

    // ── 3단계 검토(SCR-05) ──

    /** API-201: 검토 실행 job. 완료 시 회차 추가(지적 OPEN) */
    startReview: function (params, query, body) {
      var sid = params.sid;
      body = body || {};
      var scope = body.scope;
      var targets = Array.isArray(body.targets) ? body.targets : [];
      if (['ALL', 'SELECTED', 'CATEGORY'].indexOf(scope) < 0) throw fail(400, 'AGT-VAL-002', ['scope']);
      if (scope !== 'ALL' && !targets.length) throw fail(400, 'AGT-VAL-002', ['targets']);
      return MS.gate
        .assertEnterable(sid, 3)
        .then(function () {
          return MS.gate.assertMutable(sid, 3);
        })
        .then(function (stages) {
          MS.gate.assertNoActiveJob(sid + '|REVIEW');
          return MS.loadOr('sessions/' + sid + '/reviews.json', []).then(function (reviews) {
            var round =
              reviews.reduce(function (m, r) {
                return Math.max(m, r.round);
              }, 0) + 1;
            var startedAt = nowIso();
            var job = startJob('REVIEW', sid + '|REVIEW', function () {
              return finishReview(sid, round, scope, targets, startedAt);
            });
            var after = stages[2].status === 'WAITING' ? setStages(sid, { 3: 'RUNNING' }) : Promise.resolve();
            return after.then(function () {
              MS.audit('REVIEW_RUN', 'REVIEW', 'round ' + round, null, null, aiMeta('scope=' + scope + (targets.length ? ' · ' + targets.join(', ') : '')));
              return { jobId: job.jobId, round: round };
            });
          });
        });
    },

    /** API-202 (파일 없는 세션은 빈 목록) */
    reviews: function (params) {
      return MS.readOr('sessions/' + params.sid + '/reviews.json', []);
    },

    /** API-203 */
    findings: function (params, query) {
      return MS.readOr(findingsKey(params.sid, params.round), []).then(function (list) {
        return list.filter(function (f) {
          return (!query.reqId || f.reqId === query.reqId) && (!query.severity || f.severity === query.severity) && (!query.state || f.state === query.state);
        });
      });
    },

    /** API-204 */
    disposeFinding: function (params, query, body) {
      var ref = parseFindingId(params.findingId);
      body = body || {};
      if (['ACCEPTED', 'REJECTED', 'HELD'].indexOf(body.state) < 0) throw fail(400, 'AGT-VAL-002', ['state']);
      var reason = blank(body.reason) ? null : String(body.reason).trim();
      if (body.state === 'REJECTED') reason = MS.gate.requireReason(body.reason);
      return MS.gate
        .assertEnterable(ref.sid, 3)
        .then(function () {
          return MS.gate.assertMutable(ref.sid, 3);
        })
        .then(function () {
          return MS.load(findingsKey(ref.sid, ref.round));
        })
        .then(function (list) {
          var f = list.filter(function (x) {
            return x.findingId === params.findingId;
          })[0];
          if (!f) throw fail(404, 'NOT_FOUND', ['findingId=' + params.findingId]);
          f.state = body.state;
          f.reason = reason;
          f.decidedBy = ACTOR;
          f.decidedAt = nowIso();
          MS.audit('FINDING_DISPOSE', 'FINDING', f.findingId, f.reqId, reason);
          return { findingId: f.findingId, state: f.state };
        });
    },

    /** API-205: 수용한 지적의 인라인 편집. 최신 리비전 미리보기 오버레이에 반영하고 이력을 쌓는다. */
    editRequirement: function (params, query, body) {
      body = body || {};
      if (['name', 'detail'].indexOf(body.field) < 0) throw fail(400, 'AGT-VAL-002', ['field']);
      if (blank(body.value)) throw fail(400, 'AGT-VAL-002', ['value']);
      if (body.field === 'name' && String(body.value).trim().length > 40) throw fail(400, 'AGT-VAL-002', ['name > 40']);
      if (!body.findingId) throw fail(400, 'AGT-VAL-002', ['findingId']);
      var ref = parseFindingId(body.findingId);
      var sid = ref.sid;
      var value = body.field === 'name' ? String(body.value).trim() : String(body.value);
      return MS.gate
        .assertEnterable(sid, 3)
        .then(function () {
          return MS.gate.assertMutable(sid, 3);
        })
        .then(function () {
          return MS.load(findingsKey(sid, ref.round));
        })
        .then(function (list) {
          var f = list.filter(function (x) {
            return x.findingId === body.findingId;
          })[0];
          if (!f || f.reqId !== params.reqId) throw fail(404, 'NOT_FOUND', ['findingId=' + body.findingId]);
          if (f.state !== 'ACCEPTED') throw fail(409, 'AGT-STATE-001', [f.findingId + '=' + f.state]);
          return loadSession(sid);
        })
        .then(function (session) {
          var rev = session.latestRevision;
          return Promise.all([MS.load(uploadKey(sid, rev, 'preview.json')), MS.loadOr('requirements/history/' + params.reqId + '.json', [])]).then(function (r) {
            var row = r[0].rows.filter(function (x) {
              return x.reqId === params.reqId;
            })[0];
            if (!row) throw fail(404, 'NOT_FOUND', ['reqId=' + params.reqId]);
            var before = row[body.field];
            row[body.field] = value;
            r[1].push({ revision: rev, changedAt: nowIso(), column: body.field, before: before, after: value, findingId: body.findingId });
            var vk = sid + '|' + params.reqId;
            reqVersions[vk] = (reqVersions[vk] || 1) + 1;
            MS.audit('REQ_EDIT', 'REQUIREMENT', params.reqId, params.reqId, null);
            return { reqId: params.reqId, version: reqVersions[vk] };
          });
        });
    },

    /** API-206 */
    confirmReview: function (params) {
      var sid = params.sid;
      return MS.gate
        .assertEnterable(sid, 3)
        .then(function () {
          return MS.gate.assertMutable(sid, 3);
        })
        .then(function (stages) {
          MS.gate.assertNoActiveJob(sid + '|REVIEW');
          return allFindings(sid).then(function (r) {
            if (!r.reviews.length) throw fail(409, 'AGT-STATE-001', ['reviews=0']);
            MS.gate.assertNoOpenHigh(r.findings);
            var changes = { 3: 'COMPLETED' };
            if (stages[3].status === 'LOCKED') changes[4] = 'WAITING';
            return setStages(sid, changes);
          });
        })
        .then(function (stages) {
          var s = stages[2];
          MS.audit('STAGE_CONFIRM', 'STAGE', s.stage, null, null);
          return { stage: s.stage, status: s.status, confirmedBy: s.confirmedBy, confirmedAt: s.confirmedAt };
        });
    },

    /** API-207: 하위 단계 연쇄 해제. 산출물은 삭제하지 않고 재확정 대상으로 표시만 한다. */
    releaseStage: function (params, query, body) {
      var sid = params.sid;
      var no = stageNoOf(params.stage);
      if (['REVIEW', 'SRS_CONFIRM', 'SDS_CONFIRM'].indexOf(params.stage) < 0) throw fail(400, 'AGT-VAL-002', ['stage=' + params.stage]);
      var reason = MS.gate.requireReason(body && body.reason);
      return MS.gate
        .assertCompleted(sid, no)
        .then(function (stages) {
          var changes = {};
          var released = [];
          stages.forEach(function (s, i) {
            if (i + 1 < no || s.status === 'LOCKED') return;
            released.push(s.stage);
            changes[i + 1] = i + 1 === no ? 'WAITING' : 'LOCKED';
          });
          return MS.loadOr('sessions/' + sid + '/artifacts.json', []).then(function (artifacts) {
            var marked = [];
            artifacts.forEach(function (a) {
              var st = DOC_STAGE[a.type];
              if (st && a.confirmed && st.confirm >= no) {
                a.markedForReconfirm = true;
                marked.push(a.artifactId);
              }
            });
            return setStages(sid, changes).then(function () {
              MS.audit('STAGE_RELEASE', 'STAGE', params.stage, null, reason);
              return { released: released, markedForReconfirm: marked };
            });
          });
        });
    },

    // ── 4~6단계 문서(SCR-06) ──

    generateSrs: function (params) {
      return MS.handlers._generateDoc(params.sid, 'SRS');
    },

    generateSds: function (params) {
      return MS.handlers._generateDoc(params.sid, 'SDS');
    },

    /** API-301 · 302 공통: 선행 확정(AGT-GATE-001), 확정 후 재생성 불가(AGT-IMM-001) */
    _generateDoc: function (sid, type) {
      var st = DOC_STAGE[type];
      return MS.gate
        .assertEnterable(sid, st.gen)
        .then(function () {
          return MS.gate.assertMutable(sid, st.confirm);
        })
        .then(function () {
          MS.gate.assertNoActiveJob(sid + '|GEN_' + type);
          var job = startJob('GEN_' + type, sid + '|GEN_' + type, function () {
            return finishDocJob(sid, type);
          });
          var changes = {};
          changes[st.gen] = 'RUNNING';
          return setStages(sid, changes).then(function () {
            MS.audit('ARTIFACT_GENERATE', 'ARTIFACT', type, null, null, aiMeta(type === 'SRS' ? 'REQ → SRS' : 'SRS → SDS'));
            return { jobId: job.jobId };
          });
        });
    },

    /** API-303 */
    artifacts: function (params, query) {
      return MS.loadOr('sessions/' + params.sid + '/artifacts.json', []).then(function (list) {
        return clone(
          list
            .filter(function (a) {
              return !query.type || a.type === query.type;
            })
            .sort(function (a, b) {
              return b.version - a.version;
            })
        );
      });
    },

    /** API-305 */
    confirmArtifact: function (params) {
      return findInSessions('artifacts.json', 'artifactId', params.artifactId).then(function (hit) {
        var a = hit.item;
        var sid = hit.sid;
        var st = DOC_STAGE[a.type];
        if (!st) throw fail(400, 'AGT-VAL-002', ['type=' + a.type]);
        MS.gate.assertNotConfirmed(a);
        return MS.gate.assertEnterable(sid, st.confirm).then(function (stages) {
          MS.gate.assertNoActiveJob(sid + '|GEN_' + a.type);
          a.confirmed = true;
          a.confirmedBy = ACTOR;
          a.confirmedAt = nowIso();
          a.markedForReconfirm = false;
          var changes = {};
          changes[st.confirm] = 'COMPLETED';
          var next = a.type === 'SRS' ? Promise.resolve() : ensureBacklog(sid);
          if (a.type === 'SRS') {
            if (stages[5].status === 'LOCKED') changes[6] = 'WAITING';
          } else {
            changes[7] = 'COMPLETED'; // 구현 목록 자동 생성
            if (stages[7].status === 'LOCKED') changes[8] = 'WAITING';
          }
          return next
            .then(function () {
              return setStages(sid, changes);
            })
            .then(function () {
              MS.audit('ARTIFACT_CONFIRM', 'ARTIFACT', a.artifactId, null, null);
              return { artifactId: a.artifactId, confirmedBy: a.confirmedBy, confirmedAt: a.confirmedAt, checksum: a.checksum };
            });
        });
      });
    },

    /** API-306: 사유 필수. 재생성 단계로 복귀 */
    rejectArtifact: function (params, query, body) {
      var reason = MS.gate.requireReason(body && body.reason);
      return findInSessions('artifacts.json', 'artifactId', params.artifactId).then(function (hit) {
        var a = hit.item;
        var sid = hit.sid;
        var st = DOC_STAGE[a.type];
        if (!st) throw fail(400, 'AGT-VAL-002', ['type=' + a.type]);
        MS.gate.assertNotConfirmed(a);
        return MS.gate.assertEnterable(sid, st.confirm).then(function () {
          a.rejected = true;
          a.rejectReason = reason;
          a.rejectedAt = nowIso();
          var changes = {};
          changes[st.gen] = 'WAITING';
          if (a.type === 'SRS') changes[st.confirm] = 'LOCKED';
          return setStages(sid, changes).then(function () {
            MS.audit('ARTIFACT_REJECT', 'ARTIFACT', a.artifactId, null, reason);
            return { artifactId: a.artifactId, state: 'REJECTED' };
          });
        });
      });
    },

    /** API-307 */
    traceability: function (params, query) {
      var to = String(query.to || '').toUpperCase();
      if (to !== 'SRS' && to !== 'SDS') throw fail(400, 'AGT-VAL-002', ['to']);
      return MS.readOr('sessions/' + params.sid + '/traceability-' + to.toLowerCase() + '.json', []);
    },

    // ── 7~9단계 구현 목록 · 배정 · 실행(SCR-07 · SCR-08) ──

    /** API-401: SDS 확정(AGT-GATE-001) */
    backlog: function (params) {
      return MS.gate.assertEnterable(params.sid, 7).then(function () {
        return MS.loadOr('sessions/' + params.sid + '/backlog.json', []).then(clone);
      });
    },

    /** API-402: 삭제가 아닌 제외 상태 변경(되돌리기는 excluded:false, 설계서 I-11) */
    excludeItem: function (params, query, body) {
      body = body || {};
      if (typeof body.excluded !== 'boolean') throw fail(400, 'AGT-VAL-002', ['excluded']);
      var reason = body.excluded ? MS.gate.requireReason(body.reason) : null;
      return findInSessions('backlog.json', 'itemId', params.itemId).then(function (hit) {
        return MS.gate.assertEnterable(hit.sid, 7).then(function () {
          hit.item.excluded = body.excluded;
          hit.item.excludeReason = reason;
          if (body.excluded) MS.audit('BACKLOG_EXCLUDE', 'BACKLOG_ITEM', hit.item.itemId, hit.item.reqId, reason);
          return { itemId: hit.item.itemId, excluded: hit.item.excluded };
        });
      });
    },

    /** API-404: 실행은 개시하지 않는다 */
    assign: function (params, query, body) {
      body = body || {};
      var a = { mainWorker: body.mainWorker || null, subWorker: body.subWorker || null, subAgent: body.subAgent || null };
      return findInSessions('backlog.json', 'itemId', params.itemId).then(function (hit) {
        return MS.gate.assertEnterable(hit.sid, 8).then(function (stages) {
          return MS.read('workers.json').then(function (workersDoc) {
            MS.gate.assertAssignment(a, workersDoc);
            var prev = hit.item.assignment || {};
            a.recommendApplied = !!prev.recommendApplied && prev.mainWorker === a.mainWorker && prev.subWorker === a.subWorker && prev.subAgent === a.subAgent;
            hit.item.assignment = a;
            var changes = {};
            if (a.mainWorker && stages[7].status !== 'COMPLETED') {
              changes[8] = 'COMPLETED';
              if (stages[8].status === 'LOCKED') changes[9] = 'WAITING';
            }
            return setStages(hit.sid, changes).then(function () {
              MS.audit('ASSIGN', 'BACKLOG_ITEM', hit.item.itemId, hit.item.reqId, null);
              return { itemId: hit.item.itemId, assignment: clone(a) };
            });
          });
        });
      });
    },

    /** API-405: 7필드 실행 요청 미리보기 */
    previewExecution: function (params, query, body) {
      return findItems(body && body.itemIds).then(function (r) {
        return MS.gate.assertEnterable(r.sid, 9).then(function () {
          return MS.loadOr('sessions/' + r.sid + '/executions.json', []).then(function (execs) {
            MS.gate.assertExecutable(r.items, execs);
            return buildPreviews(r.sid, r.items);
          });
        });
      });
    },

    /** API-406: 사용자 확인 + 워커 승인 + Idempotency-Key. 동시 상한 초과분은 대기열 */
    createExecutions: function (params, query, body, headers) {
      var key = headers && headers['Idempotency-Key'];
      if (key && idem[key]) return clone(idem[key]);
      body = body || {};
      if (body.confirmed !== true) throw fail(400, 'AGT-VAL-002', ['confirmed']);
      return findItems(body.itemIds).then(function (r) {
        var sid = r.sid;
        return MS.gate
          .assertEnterable(sid, 9)
          .then(function () {
            return Promise.all([MS.loadOr('sessions/' + sid + '/executions.json', []), MS.read('workers.json'), buildPreviews(sid, r.items), latestRows(sid)]);
          })
          .then(function (x) {
            var execs = x[0];
            var previews = x[2];
            MS.gate.assertExecutable(r.items, execs);
            MS.gate.assertApprovedWorkers(r.items, x[1]);
            var overrides = body.payloads || {}; // mock 전용(설계서 I-02 보강): 빈 target_repo · write_scope 입력값
            previews.forEach(function (p) {
              var o = overrides[p.itemId] || {};
              ['target_repo', 'write_scope'].forEach(function (k) {
                if (blank(p.payload[k]) && !blank(o[k])) p.payload[k] = String(o[k]).trim();
              });
            });
            MS.gate.assertPayloadComplete(previews);
            var labels = {};
            x[3].forEach(function (row) {
              labels[row.reqId] = block(row.detail, '검증 기준')
                .split('\n')
                .map(function (l) {
                  return l.replace(/^-\s*/, '').trim();
                })
                .filter(Boolean);
            });
            var active = execs.filter(function (e) {
              return e.state === 'RUNNING';
            }).length;
            var created = r.items.map(function (it, i) {
              var running = active + i < MAX_CONCURRENT;
              var e = {
                execId: uuid(),
                itemId: it.itemId,
                reqId: it.reqId,
                state: running ? 'RUNNING' : 'QUEUED',
                startedAt: running ? nowIso() : null,
                finishedAt: null,
                failureReason: null,
                artifacts: [],
                verification: null,
                scm: null,
                assignSnapshot: clone(it.assignment), // EXEC.c_assign_snapshot
                payload: previews[i].payload
              };
              execs.push(e);
              execSim[e.execId] = { polls: 0, labels: labels[it.reqId] || [] };
              MS.audit('EXEC_REQUEST', 'EXECUTION', e.execId, e.reqId, null);
              return e;
            });
            return MS.load(stagesKey(sid)).then(function (stages) {
              var changes = {};
              if (stages[8].status !== 'RUNNING') changes[9] = 'RUNNING';
              if (stages[9].status === 'LOCKED') changes[10] = 'WAITING';
              return setStages(sid, changes).then(function () {
                var res = {
                  executions: created.map(function (e) {
                    return { execId: e.execId, itemId: e.itemId, state: e.state };
                  }),
                  queued: created.filter(function (e) {
                    return e.state === 'QUEUED';
                  }).length
                };
                if (key) idem[key] = clone(res);
                return res;
              });
            });
          });
      });
    },

    /** G5: 세션 실행 목록(mock 전용 gap, 설계서 I-01) */
    executions: function (params) {
      return MS.readOr('sessions/' + params.sid + '/executions.json', []);
    },

    /** API-407: 새 실행은 조회 1회 QUEUED · 2회 RUNNING · 4회 SUCCEEDED */
    execution: function (params) {
      return findInSessions('executions.json', 'execId', params.execId).then(function (hit) {
        advanceExec(hit.item);
        return clone(hit.item);
      });
    },

    /** API-408: 생성된 산출물은 폐기 표시만 */
    cancelExecution: function (params, query, body) {
      var reason = MS.gate.requireReason(body && body.reason);
      return findInSessions('executions.json', 'execId', params.execId).then(function (hit) {
        var e = hit.item;
        MS.gate.assertCancelable(e);
        e.state = 'CANCELLED';
        e.finishedAt = nowIso();
        e.cancelReason = reason;
        (e.artifacts || []).forEach(function (art) {
          art.discarded = true;
        });
        delete execSim[e.execId];
        MS.audit('EXEC_CANCEL', 'EXECUTION', e.execId, e.reqId, reason);
        return { execId: e.execId, state: e.state };
      });
    },

    /** API-410: 별도 승인 후 브랜치 반영 job. write_scope 위반이면 전건 차단(부분 반영 · 자동 되돌리기 없음) */
    scm: function (params, query, body, headers) {
      var key = headers && headers['Idempotency-Key'];
      if (key && idem[key]) return clone(idem[key]);
      return findInSessions('executions.json', 'execId', params.execId).then(function (hit) {
        var e = hit.item;
        var branch = MS.gate.assertScm(e, body);
        MS.gate.assertNoActiveJob(e.execId + '|SCM');
        var prUrl = '/scm/pulls/' + ++prSeq; // mock: 상대 경로(외부 호스트 없음)
        var job = startJob('SCM', e.execId + '|SCM', function () {
          e.scm = { branch: branch, prUrl: prUrl, commitMessage: String(body.commitMessage || ''), pushedAt: nowIso() };
          MS.audit('SCM_PUSH', 'EXECUTION', e.execId, e.reqId, null);
        });
        var res = { jobId: job.jobId, branch: branch, prUrl: prUrl };
        if (key) idem[key] = clone(res);
        return res;
      });
    },

    // ── 공통 ──

    /** API-601 */
    job: function (params) {
      var j = jobs[params.jobId];
      if (!j) throw fail(404, 'NOT_FOUND', ['jobId=' + params.jobId]);
      if (j.state !== 'QUEUED' && j.state !== 'RUNNING') return publicJob(j);
      j.progress = Math.min(100, j.progress + 25);
      j.state = 'RUNNING';
      if (j.progress < 100) return publicJob(j);
      var hook = jobHooks[j.jobId];
      delete jobHooks[j.jobId];
      return Promise.resolve()
        .then(hook)
        .then(
          function () {
            j.state = 'SUCCEEDED';
            return publicJob(j);
          },
          function (err) {
            j.state = 'FAILED';
            j.error = (err && err.code) || 'AGT-JOB-001';
            return publicJob(j);
          }
        );
    },

    // ── 운영 기능(SCR-09 · 10 · 11) · 감사(SCR-12) ──

    /** API-501 (조회 전용) */
    monitorTasks: function () {
      assertIntegration('mat');
      return MS.read('monitor/tasks.json');
    },

    /** API-502: 최근 tail 줄(기본 200) */
    monitorLog: function (params, query) {
      assertIntegration('mat');
      var name = params.taskName;
      if (!/^[\w.-]+$/.test(name) || name.indexOf('..') >= 0) throw fail(403, 'AGT-PATH-001', [name]);
      return MS.read('monitor/tasks.json').then(function (tasks) {
        if (!tasks.some(function (x) {
          return x.taskName === name;
        }))
          throw fail(404, 'NOT_FOUND', ['taskName=' + name]);
        return MS.read('monitor/logs/' + name + '.json').then(function (log) {
          var tail = Math.max(1, Math.min(Number(query.tail) || 200, 1000));
          var lines = log.lines || [];
          return { lines: lines.slice(-tail), truncated: lines.length > tail };
        });
      });
    },

    /** API-503 */
    knowledgeTree: function () {
      assertIntegration('knot');
      return MS.read('knowledge/tree.json');
    },

    /** API-504: vault 루트 밖 · 상대 이동 경로는 403 AGT-PATH-001 */
    knowledgeDoc: function (params, query) {
      assertIntegration('knot');
      var p = String(query.path || '');
      if (!p.trim()) throw fail(400, 'AGT-VAL-002', ['path']);
      if (/(^|[\\/])\.\.([\\/]|$)/.test(p) || /^[\\/]/.test(p) || /^[A-Za-z]:/.test(p) || p.indexOf('\\') >= 0) throw fail(403, 'AGT-PATH-001', [p]);
      return MS.read('knowledge/tree.json').then(function (tree) {
        if (!tree.some(function (x) {
          return x.path === p;
        }))
          throw fail(404, 'NOT_FOUND', ['path=' + p]);
        return MS.read('knowledge/docs/' + p.replace(/\//g, '__') + '.json');
      });
    },

    /** API-505 */
    agents: function () {
      return MS.load('agents.json').then(clone);
    },

    /** G3 */
    agentDetail: function (params) {
      return assetDetail('agents', params.name);
    },

    /** API-506 */
    saveAgent: function (params, query, body) {
      return saveAsset('agents', params.name, body);
    },

    /** API-507: 삭제 대신 비활성(enabled:false) · 재활성(enabled:true) */
    setAgentEnabled: function (params, query, body) {
      return setAssetEnabled('agents', params.name, body);
    },

    /** API-508: ?agent= 필터. referencedByRunning 은 참조 실행의 현재 상태로 판정 */
    skills: function (params, query) {
      return MS.load('skills.json').then(function (list) {
        var rows = list.filter(function (s) {
          return !query.agent || s.agent === query.agent;
        });
        return Promise.all(rows.map(runningRefs)).then(function (refs) {
          return rows.map(function (s, i) {
            return Object.assign(clone(s), { referencedByRunning: refs[i].length > 0, runningExecIds: refs[i] });
          });
        });
      });
    },

    /** G3 */
    skillDetail: function (params) {
      return assetDetail('skills', params.name);
    },

    /** API-509 */
    saveSkill: function (params, query, body) {
      return saveAsset('skills', params.name, body);
    },

    /** API-510: 실행 중 작업이 참조하면 409 AGT-STATE-002 */
    setSkillEnabled: function (params, query, body) {
      return setAssetEnabled('skills', params.name, body);
    },

    /** API-602: 시드(audit.json) + 이번 세션 상태 변경 기록. 최신순, 페이지 20건(total 없음, 설계서 I-02) */
    audit: function (params, query) {
      var from = query.from || '';
      var to = query.to || '';
      if (from && to && from > to) throw fail(400, 'AGT-VAL-002', ['from > to']);
      var page = Math.max(1, Number(query.page) || 1);
      var size = AUDIT_PAGE;
      var reqId = String(query.reqId || '').trim().toUpperCase();
      var actor = String(query.actor || '').trim();
      return MS.read('audit.json').then(function (seed) {
        var rows = seed
          .concat(clone(auditLog))
          .filter(function (a) {
            var day = localDay(a.actedAt);
            return (!reqId || String(a.reqId || '').toUpperCase() === reqId) && (!actor || String(a.actor).indexOf(actor) >= 0) && (!from || day >= from) && (!to || day <= to);
          })
          .sort(function (a, b) {
            return new Date(b.actedAt) - new Date(a.actedAt) || b.auditId - a.auditId;
          });
        return rows.slice((page - 1) * size, page * size);
      });
    },

    /** API-603: 요구사항 전 경로(업로드 → 등록 → 검토 → SRS → SDS → 실행 → 커밋) */
    trace: function (params) {
      var id = String(params.reqId);
      if (!/^REQ-[A-Z]+-\d{3}$/.test(id)) throw fail(400, 'AGT-VAL-002', ['reqId=' + id]);
      return MS.read('sessions/1001/uploads/2/preview.json').then(function (p) {
        if (!p.rows.some(function (r) {
          return r.reqId === id;
        }))
          throw fail(404, 'NOT_FOUND', ['reqId=' + id]);
        return MS.read('requirements/trace/' + id + '.json');
      });
    }
  };

  // ── 운영 기능 · 감사 도우미 ──
  var AUDIT_PAGE = 20;
  var NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var KIND = {
    agents: { list: 'agents.json', targetType: 'AGENT' },
    skills: { list: 'skills.json', targetType: 'SKILL' }
  };

  /** mockFail=mat|knot: 해당 연동만 실패(AGT-EXT-001). 플로우 · 메뉴 · 다른 화면에는 영향 없음 */
  function assertIntegration(name) {
    if (MS.flags.fail.indexOf(name) >= 0) throw fail(name === 'mat' ? 503 : 502, 'AGT-EXT-001', [name.toUpperCase()]);
  }

  function localDay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function firstSentence(s) {
    var text = String(s || '').replace(/\s+/g, ' ').trim();
    var m = /^(.*?[.。])(\s|$)/.exec(text);
    return (m ? m[1] : text).replace(/\s+Examples\s*—.*$/, '');
  }

  function assertAssetName(name) {
    if (!NAME_RE.test(String(name))) throw fail(403, 'AGT-PATH-001', [String(name)]);
  }

  function findAsset(kind, name) {
    return MS.load(KIND[kind].list).then(function (list) {
      return {
        list: list,
        item: list.filter(function (x) {
          return x.name === name;
        })[0]
      };
    });
  }

  function assetDetail(kind, name) {
    assertAssetName(name);
    return findAsset(kind, name).then(function (r) {
      if (!r.item) throw fail(404, 'NOT_FOUND', ['name=' + name]);
      return MS.read(kind + '/' + name + '.json');
    });
  }

  /** 참조 실행 중 QUEUED · RUNNING 인 execId */
  function runningRefs(skill) {
    return Promise.all(
      (skill.referencedBy || []).map(function (execId) {
        return findInSessions('executions.json', 'execId', execId).then(
          function (hit) {
            return hit.item.state === 'QUEUED' || hit.item.state === 'RUNNING' ? execId : null;
          },
          function () {
            return null;
          }
        );
      })
    ).then(function (ids) {
      return ids.filter(Boolean);
    });
  }

  /** 정의 파일 검사(서버 흉내): 대화형 지시 · 공통 규약 중복 · frontmatter 필수 항목 */
  function violationsOf(name, content) {
    var out = [];
    var fm = A.markdown.frontmatter(content);
    if (/사용자에게\s*질문|ask the user/i.test(content)) out.push({ code: 'INTERACTIVE_INSTRUCTION', detail: '사용자에게 질문 / ask the user' });
    if (/workers_approved|Verification Checklist/.test(content)) out.push({ code: 'DUPLICATED_RULE', detail: 'workers_approved / Verification Checklist' });
    ['name', 'description'].forEach(function (k) {
      if (blank(fm.data[k])) out.push({ code: 'MISSING_FIELD', detail: k });
    });
    if (!blank(fm.data.name) && fm.data.name !== name) out.push({ code: 'MISSING_FIELD', detail: 'name=' + fm.data.name + ' ≠ ' + name });
    return { violations: out, fm: fm };
  }

  function saveAsset(kind, name, body) {
    assertAssetName(name);
    body = body || {};
    if (blank(body.content)) throw fail(400, 'AGT-VAL-002', ['content']);
    var content = String(body.content);
    return Promise.all([findAsset(kind, name), kind === 'skills' ? MS.load('agents.json') : null]).then(function (r) {
      var found = r[0];
      if (body.create && found.item) throw fail(409, 'AGT-STATE-001', ['name=' + name]);
      if (!body.create && !found.item) throw fail(404, 'NOT_FOUND', ['name=' + name]);
      var agent = null;
      if (kind === 'skills') {
        agent = body.agent || null;
        if (agent && !r[1].some(function (a) {
          return a.name === agent;
        }))
          throw fail(400, 'AGT-VAL-002', ['agent=' + agent]);
      }
      var check = violationsOf(name, content);
      if (check.violations.length) return { name: name, valid: false, violations: check.violations };
      var now = nowIso();
      var item = found.item;
      if (!item) {
        item = { name: name, enabled: true };
        if (kind === 'skills') item.referencedBy = [];
        found.list.push(item);
      }
      item.description = firstSentence(check.fm.data.description);
      item.updatedAt = now;
      if (kind === 'skills') item.agent = agent;
      MS.put(kind + '/' + name + '.json', { name: name, content: content });
      var sync = kind === 'agents' ? syncSubAgent(item) : Promise.resolve();
      return sync.then(function () {
        MS.audit('ASSET_SAVE', KIND[kind].targetType, name, null, null);
        return { name: name, valid: true, violations: [], updatedAt: now };
      });
    });
  }

  function setAssetEnabled(kind, name, body) {
    assertAssetName(name);
    if (!body || typeof body.enabled !== 'boolean') throw fail(400, 'AGT-VAL-002', ['enabled']);
    return findAsset(kind, name).then(function (found) {
      var item = found.item;
      if (!item) throw fail(404, 'NOT_FOUND', ['name=' + name]);
      var guard = kind === 'skills' && !body.enabled ? runningRefs(item) : Promise.resolve([]);
      return guard.then(function (running) {
        if (running.length) throw fail(409, 'AGT-STATE-002', running);
        item.enabled = body.enabled;
        item.updatedAt = nowIso();
        return (kind === 'agents' ? syncSubAgent(item) : Promise.resolve()).then(function () {
          MS.audit(body.enabled ? 'ASSET_ENABLE' : 'ASSET_DISABLE', KIND[kind].targetType, name, null, null);
          return { name: name, enabled: item.enabled };
        });
      });
    });
  }

  /** 에이전트 저장 · 비활성은 배정 후보(API-403 subAgents)에 바로 반영한다(REQ-F-018.7) */
  function syncSubAgent(agent) {
    return MS.load('workers.json').then(function (doc) {
      doc.subAgents = doc.subAgents || [];
      var sa = doc.subAgents.filter(function (x) {
        return x.name === agent.name;
      })[0];
      if (!sa) doc.subAgents.push((sa = { name: agent.name }));
      sa.description = agent.description;
      sa.enabled = agent.enabled;
    });
  }


  A.mockServer = MS;
})(window);
