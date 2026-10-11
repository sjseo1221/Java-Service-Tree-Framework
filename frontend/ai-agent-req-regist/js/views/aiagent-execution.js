/*
 * SCR-08 실행 요청 · 진행 (9단계) — REQ-F-013 · F-014 · F-015 · SE-002 · NF-002
 * API-405(7필드 미리보기) · 406(Idempotency-Key) · G5 · 407(진행 폴링) · 408(취소) · 410(형상 반영, 별도 승인) · 601
 * 대상 데이터는 SCR-07 의 AIAGENT.backlogData 결합 결과를 쓴다.
 * write_scope 위반(AGT-SCOPE-001)은 전건 차단만 표시한다. 자동 되돌리기 UI 는 없다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var FIELDS = ['목표', '성격', 'target_repo', 'write_scope', '워커', '산출물', '제약']; // SDS API-405 payload 키(설계서 I-03)
  var EDITABLE = ['target_repo', 'write_scope'];
  var DEFAULT_BRANCHES = ['main', 'master'];

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function terminal(state) {
    return state === 'SUCCEEDED' || state === 'FAILED' || state === 'CANCELLED';
  }

  function create() {
    var ui = A.ui;
    var ctx = null;
    var alive = false;
    var parts = {};
    var v = { rows: [], execs: [], selected: {}, detailId: null };
    var targetTbl = null;
    var execTbl = null;

    function rowOfItem(itemId) {
      return v.rows.filter(function (r) {
        return r.itemId === itemId;
      })[0];
    }

    // ── 데이터 ──
    function load() {
      return A.backlogData.load(ctx.sid, ctx.session).then(function (d) {
        if (!alive) return;
        v.rows = d.rows;
        v.execs = d.executions.slice().sort(function (a, b) {
          return String(b.startedAt || '9999').localeCompare(String(a.startedAt || '9999'));
        });
        renderTargets();
        renderExecs();
      });
    }

    // ── 영역 A: 실행 대상 ──
    function ineligibleReason(r) {
      if (r.excluded) return 'excluded';
      if (!r.assignment.mainWorker) return 'noMain';
      if (r.active) return 'active';
      return null;
    }

    function selectedIds() {
      return v.rows
        .filter(function (r) {
          return v.selected[r.itemId] && !ineligibleReason(r);
        })
        .map(function (r) {
          return r.itemId;
        });
    }

    function renderTargetControls() {
      var c = ui.clear(parts.targets.controls);
      var n = selectedIds().length;
      c.appendChild(ui.h('span', { class: 'ag-muted' }, t('aiagent.exec.selectedCount', { n: n })));
      c.appendChild(
        ui.button({
          labelKey: 'aiagent.exec.run',
          kind: 'blue',
          icon: 'play',
          disabled: !n,
          onClick: function () {
            openPreview(selectedIds());
          }
        })
      );
    }

    function renderTargets() {
      renderTargetControls();
      var columns = [
        {
          key: 'sel',
          label: '',
          render: function (r) {
            var why = ineligibleReason(r);
            return ui.h('input', {
              type: 'checkbox',
              checked: !why && !!v.selected[r.itemId],
              disabled: !!why,
              'aria-label': r.reqId,
              onchange: function (e) {
                v.selected[r.itemId] = e.target.checked;
                renderTargetControls();
              }
            });
          }
        },
        { key: 'reqId', labelKey: 'aiagent.backlog.col.reqId', sortable: true, className: 'ag-nowrap' },
        {
          key: 'name',
          labelKey: 'aiagent.backlog.col.name',
          sortable: true,
          render: function (r) {
            return ui.h('span', { class: 'ag-clamp2' }, r.name);
          }
        },
        {
          key: 'worker',
          labelKey: 'aiagent.backlog.col.mainWorker',
          render: function (r) {
            var a = r.assignment;
            return ui.h('span', { class: 'ag-mono' }, [a.mainWorker, a.subWorker, a.subAgent].filter(Boolean).join(' / '));
          }
        },
        {
          key: 'execState',
          labelKey: 'aiagent.backlog.col.execState',
          sortable: true,
          render: function (r) {
            var why = ineligibleReason(r);
            var out = [];
            if (r.execState !== 'NONE' || !why) out.push(ui.badge('EXEC_STATE', r.execState));
            if (why) out.push(ui.h('span', { class: 'ag-chip ag-chip--muted' }, t('aiagent.exec.ineligible.' + why)));
            return out;
          }
        }
      ];
      var rows = v.rows.slice();
      if (!targetTbl) {
        targetTbl = ui.table({
          className: 'ag-table--compact',
          columns: columns,
          rows: rows,
          rowClass: function (r) {
            return ineligibleReason(r) ? 'ag-row--muted' : null;
          }
        });
        ui.clear(parts.targets.body).appendChild(targetTbl.el);
      } else {
        targetTbl.setRows(rows);
      }
    }

    // ── 실행 확인 모달(SDS §7.1 ①): API-405 → 사용자 확인 → API-406 ──
    function openPreview(itemIds) {
      var key = A.api.newIdempotencyKey(); // 모달당 1개 — 재시도 시 같은 키
      var inputs = []; // {itemId, field, el}
      var errBox = ui.h('div');
      var hint = ui.h('p', { class: 'ag-hint ag-text-warn ag-hidden-block' }, t('aiagent.exec.fieldRequired'));
      var m = ui.modal({
        titleKey: 'aiagent.exec.previewTitle',
        className: 'ag-modal--wide',
        body: function (el) {
          ui.loading(el);
        },
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.exec.send',
            kind: 'green',
            disabled: true,
            onClick: function (api) {
              send(api);
            }
          }
        ]
      });

      function update() {
        var missing = inputs.some(function (x) {
          return !x.el.value.trim();
        });
        hint.classList.toggle('ag-hidden-block', !missing);
        m.setDisabled(1, missing || !inputs.ready);
      }

      function send(api) {
        api.setDisabled(1, true);
        ui.clear(errBox);
        var payloads = {};
        inputs.forEach(function (x) {
          (payloads[x.itemId] = payloads[x.itemId] || {})[x.field] = x.el.value.trim();
        });
        A.api
          .request('POST', '/executions', { itemIds: itemIds, confirmed: true, payloads: payloads }, { idempotencyKey: key })
          .then(function (res) {
            api.close('ok');
            ui.toast('success', t('aiagent.exec.requested', { n: res.executions.length }));
            if (res.queued > 0) ui.toast('warn', t('aiagent.exec.queued', { n: res.queued }));
            v.selected = {};
            A.flow.reload();
            if (alive) load();
          })
          .catch(function (err) {
            update();
            ui.errorCard(errBox, err);
            if (errBox.scrollIntoView) errBox.scrollIntoView({ block: 'nearest' });
          });
      }

      A.api.request('POST', '/executions/preview', { itemIds: itemIds }).then(
        function (list) {
          var body = ui.clear(m.body);
          list.forEach(function (p, idx) {
            var r = rowOfItem(p.itemId) || { reqId: String(p.itemId), name: '' };
            var dl = ui.h('dl', { class: 'ag-dl' });
            FIELDS.forEach(function (f) {
              var val = p.payload[f];
              var id = 'ag_ex_' + p.itemId + '_' + f;
              var dd;
              if (EDITABLE.indexOf(f) >= 0 && !String(val || '').trim()) {
                var input = ui.h('input', { type: 'text', class: 'ag-input ag-input--full ag-mono', id: id, required: true, 'aria-required': 'true' });
                input.addEventListener('input', update);
                inputs.push({ itemId: p.itemId, field: f, el: input });
                dd = ui.h('dd', null, input);
                dl.appendChild(ui.h('dt', null, ui.h('label', { for: id }, t('aiagent.exec.field.' + f))));
              } else {
                var text = f === '성격' ? A.i18n.label('WORK_TYPE', val) : String(val == null ? '' : val);
                dd = ui.h('dd', null, ui.h('span', { class: 'ag-pre-line' }, text));
                dl.appendChild(ui.h('dt', null, t('aiagent.exec.field.' + f)));
              }
              dl.appendChild(dd);
            });
            body.appendChild(ui.h('details', { class: 'ag-details ag-details--card', open: idx === 0 || list.length <= 3 }, [ui.h('summary', null, [ui.h('strong', null, r.reqId), ' ', r.name]), dl]));
          });
          body.appendChild(hint);
          body.appendChild(errBox);
          inputs.ready = true;
          update();
        },
        function (err) {
          ui.errorCard(ui.clear(m.body), err);
        }
      );
    }

    // ── 영역 B: 진행 목록(G5 + API-407 폴링) ──
    function elapsed(e) {
      if (!e.startedAt) return '';
      var end = e.finishedAt ? new Date(e.finishedAt).getTime() : Date.now();
      return ui.fmt.duration(end - new Date(e.startedAt).getTime());
    }

    function scmAllowed(e) {
      return e.state === 'SUCCEEDED' && e.verification && e.verification.result === 'PASSED';
    }

    function actions(e) {
      var out = [];
      if (e.state === 'QUEUED' || e.state === 'RUNNING') {
        out.push(
          ui.button({
            labelKey: 'aiagent.exec.cancel',
            kind: 'red',
            onClick: function () {
              cancel(e);
            }
          })
        );
      }
      if (e.state === 'FAILED') {
        out.push(
          ui.button({
            labelKey: 'aiagent.exec.rerun',
            kind: 'blue',
            onClick: function () {
              openPreview([e.itemId]);
            }
          })
        );
      }
      if (e.state === 'SUCCEEDED') {
        if (e.scm) {
          out.push(ui.h('span', { class: 'ag-chip ag-chip--done', title: e.scm.branch }, t('aiagent.exec.scmDoneShort')));
        } else {
          out.push(
            ui.button({
              labelKey: 'aiagent.exec.scm',
              kind: 'green',
              disabled: !scmAllowed(e),
              title: scmAllowed(e) ? null : t('aiagent.exec.scmBlocked'),
              onClick: function () {
                openScm(e);
              }
            })
          );
        }
      }
      return ui.h('span', { class: 'ag-btn-group' }, out);
    }

    function renderExecs() {
      var columns = [
        {
          key: 'execId',
          labelKey: 'aiagent.exec.col.execId',
          render: function (e) {
            return ui.h('code', { class: 'ag-mono', title: e.execId }, ui.fmt.shortId(e.execId));
          }
        },
        { key: 'reqId', labelKey: 'aiagent.exec.col.reqId', sortable: true, className: 'ag-nowrap' },
        {
          key: 'state',
          labelKey: 'aiagent.exec.col.state',
          sortable: true,
          render: function (e) {
            return ui.badge('EXEC_STATE', e.state);
          }
        },
        {
          key: 'startedAt',
          labelKey: 'aiagent.exec.col.startedAt',
          sortable: true,
          render: function (e) {
            return ui.fmt.dt(e.startedAt);
          }
        },
        {
          key: 'elapsed',
          labelKey: 'aiagent.exec.col.elapsed',
          render: function (e) {
            return ui.h('span', { class: 'ag-mono' }, elapsed(e));
          }
        },
        { key: 'actions', labelKey: 'aiagent.exec.col.actions', render: actions }
      ];
      if (!execTbl) {
        execTbl = ui.table({
          columns: columns,
          rows: v.execs,
          emptyText: t('aiagent.exec.noExec'),
          rowClass: function (e) {
            return e.execId === v.detailId ? 'is-selected' : null;
          },
          onRowClick: function (e) {
            v.detailId = e.execId;
            renderExecs();
          }
        });
        ui.clear(parts.execs.body).appendChild(execTbl.el);
        parts.execs.body.appendChild(parts.execDetail);
      } else {
        execTbl.setRows(v.execs);
      }
      renderDetail();
    }

    // 행 펼침 대신 표 아래 상세 패널(선택 실행)
    function renderDetail() {
      var box = ui.clear(parts.execDetail);
      var e = v.execs.filter(function (x) {
        return x.execId === v.detailId;
      })[0];
      if (!e) {
        box.appendChild(ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.exec.selectRow')]));
        return;
      }
      var r = rowOfItem(e.itemId);
      box.appendChild(ui.h('h5', { class: 'ag-subtitle' }, [ui.h('code', { class: 'ag-mono' }, e.execId), ' · ', e.reqId, r ? ' ' + r.name : '']));
      var arts = e.artifacts || [];
      box.appendChild(ui.h('div', { class: 'ag-label' }, t('aiagent.exec.artifacts')));
      box.appendChild(
        arts.length
          ? ui.h(
              'ul',
              { class: 'ag-plain-list' },
              arts.map(function (a) {
                return ui.h('li', null, [
                  ui.badge('ARTIFACT_TYPE', a.type, { tone: 'normal' }),
                  ui.h('span', { class: 'ag-mono' + (a.discarded ? ' ag-muted' : '') }, a.name),
                  a.discarded ? ui.badge(null, null, { tone: 'muted', text: t('aiagent.exec.discarded') }) : null
                ]);
              })
            )
          : ui.h('p', { class: 'ag-muted' }, t('aiagent.common.none'))
      );
      box.appendChild(ui.h('div', { class: 'ag-label' }, t('aiagent.exec.verification')));
      if (e.verification) {
        box.appendChild(ui.badge(null, null, { tone: e.verification.result === 'PASSED' ? 'done' : 'crit', text: t('aiagent.exec.verify.' + e.verification.result) }));
        box.appendChild(
          ui.h(
            'ul',
            { class: 'ag-check-list' },
            e.verification.items.map(function (it) {
              return ui.h('li', { class: it.passed ? 'is-pass' : 'is-fail' }, [
                ui.icon(it.passed ? 'check' : 'close'),
                ui.h('span', { class: 'ag-visually-hidden' }, t(it.passed ? 'aiagent.exec.verify.PASSED' : 'aiagent.exec.verify.FAILED')),
                it.label
              ]);
            })
          )
        );
      } else {
        box.appendChild(ui.h('p', { class: 'ag-muted' }, t('aiagent.common.none')));
      }
      if (e.failureReason) box.appendChild(ui.h('p', { class: 'ag-text-crit' }, t('aiagent.exec.failure') + ': ' + e.failureReason));
      if (e.cancelReason) box.appendChild(ui.h('p', { class: 'ag-muted' }, t('aiagent.common.reason') + ': ' + e.cancelReason));
      if (e.scm) box.appendChild(ui.h('p', { class: 'ag-text-done' }, t('aiagent.exec.scmDone', { branch: e.scm.branch, pr: e.scm.prUrl })));
    }

    /** 비종료 실행만 API-407 로 다시 조회 */
    function poll() {
      var pending = v.execs.filter(function (e) {
        return !terminal(e.state);
      });
      if (!pending.length) return null;
      return Promise.all(
        pending.map(function (e) {
          return A.api.request('GET', '/executions/' + encodeURIComponent(e.execId)).then(
            function (fresh) {
              return { old: e, fresh: fresh };
            },
            function () {
              return { old: e, fresh: e };
            }
          );
        })
      ).then(function (list) {
        if (!alive) return;
        var changed = false;
        list.forEach(function (x) {
          if (x.old.state !== x.fresh.state) changed = true;
          var i = v.execs.indexOf(x.old);
          if (i >= 0) v.execs[i] = x.fresh;
        });
        if (changed) {
          A.flow.reload();
          return load(); // 실행 상태 열(대상 표)도 갱신
        }
        renderExecs(); // 소요 시간 갱신
      });
    }

    // ── 취소(API-408) ──
    function cancel(e) {
      ui.reasonPrompt({ titleKey: 'aiagent.exec.cancel' }).then(function (reason) {
        if (reason == null) return;
        A.api.request('POST', '/executions/' + encodeURIComponent(e.execId) + '/cancel', { reason: reason }).then(
          function () {
            ui.toast('success', t('aiagent.exec.cancelled', { id: ui.fmt.shortId(e.execId) }));
            if (alive) load();
          },
          function (err) {
            ui.toast('error', A.api.errorMessage(err));
            if (alive) load();
          }
        );
      });
    }

    // ── 형상 반영(SDS §7.1 ②, 별도 승인 · API-410) ──
    function openScm(e) {
      var key = A.api.newIdempotencyKey();
      var r = rowOfItem(e.itemId) || { name: '' };
      var branch = ui.h('input', { type: 'text', class: 'ag-input ag-input--full ag-mono', id: 'ag_scm_branch', value: 'aiagent/' + e.reqId + '-' + ui.fmt.shortId(e.execId) });
      var msg = ui.h('textarea', { class: 'ag-input', rows: '2', id: 'ag_scm_msg' });
      msg.value = '[' + e.reqId + '] ' + r.name;
      var branchErr = ui.h('p', { class: 'ag-hint ag-text-crit ag-hidden-block' }, t('aiagent.exec.defaultBranchDenied'));
      var agree = ui.h('input', { type: 'checkbox', id: 'ag_scm_agree' });
      var resultBox = ui.h('div', { 'aria-live': 'polite' });
      var arts = (e.artifacts || []).filter(function (a) {
        return !a.discarded;
      });
      var m = ui.modal({
        titleKey: 'aiagent.exec.scmTitle',
        className: 'ag-modal--wide',
        body: [
          ui.h('p', null, [ui.h('code', { class: 'ag-mono' }, ui.fmt.shortId(e.execId)), ' · ', ui.h('strong', null, e.reqId), ' ', r.name]),
          ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_scm_branch', class: 'ag-label' }, t('aiagent.exec.branch')), branch, branchErr]),
          ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_scm_msg', class: 'ag-label' }, t('aiagent.exec.commitMessage')), msg]),
          ui.h('div', { class: 'ag-label' }, t('aiagent.exec.scmTargets')),
          ui.h(
            'ul',
            { class: 'ag-plain-list' },
            arts.map(function (a) {
              return ui.h('li', null, [ui.badge('ARTIFACT_TYPE', a.type, { tone: 'normal' }), ui.h('span', { class: 'ag-mono' }, a.name)]);
            })
          ),
          ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.exec.diffUnavailable')]),
          ui.h('label', { class: 'ag-radio ag-agree', for: 'ag_scm_agree' }, [agree, t('aiagent.exec.scmAgree')]),
          resultBox
        ],
        actions: [
          { labelKey: 'aiagent.common.close', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.exec.scmApply',
            kind: 'green',
            disabled: true,
            onClick: function (api) {
              submit(api);
            }
          }
        ]
      });

      function isDefault() {
        return DEFAULT_BRANCHES.indexOf(branch.value.trim().toLowerCase()) >= 0;
      }

      function update() {
        branchErr.classList.toggle('ag-hidden-block', !isDefault());
        m.setDisabled(1, !agree.checked || !branch.value.trim() || isDefault() || !msg.value.trim());
      }

      function submit(api) {
        api.setDisabled(1, true);
        ui.clear(resultBox);
        A.api
          .request('POST', '/executions/' + encodeURIComponent(e.execId) + '/scm', { branch: branch.value.trim(), commitMessage: msg.value.trim(), approve: true }, { idempotencyKey: key })
          .then(function (res) {
            [branch, msg, agree].forEach(function (x) {
              x.disabled = true;
            });
            var bar = ui.h('div', { class: 'ag-progress-bar', style: 'width:0%' });
            var label = ui.h('span', { class: 'ag-muted' }, t('aiagent.exec.scmRunning', { p: 0 }));
            resultBox.appendChild(ui.h('div', { class: 'ag-progress-row' }, [ui.h('div', { class: 'ag-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), label]));
            return A.poller.watchJob(res.jobId, function (j) {
              bar.style.width = j.progress + '%';
              bar.parentNode.setAttribute('aria-valuenow', String(j.progress));
              label.textContent = t('aiagent.exec.scmRunning', { p: j.progress });
            }).promise.then(function () {
              ui.clear(resultBox).appendChild(ui.h('p', { class: 'ag-text-done' }, t('aiagent.exec.scmDone', { branch: res.branch, pr: res.prUrl })));
              ui.toast('success', t('aiagent.exec.scmDone', { branch: res.branch, pr: res.prUrl }));
              if (alive) load();
            });
          })
          .catch(function (err) {
            ui.clear(resultBox);
            if (err.code === 'AGT-SCOPE-001') {
              // 전건 차단 · 부분 반영 없음. details = 위반 경로(또는 기본 브랜치)
              resultBox.appendChild(ui.h('div', { class: 'ag-banner ag-banner--crit', role: 'alert' }, [ui.icon('alert'), t('aiagent.exec.scopeBlocked')]));
            }
            var holder = ui.h('div');
            resultBox.appendChild(holder);
            ui.errorCard(holder, err);
            update();
          });
      }

      [branch, msg].forEach(function (x) {
        x.addEventListener('input', update);
      });
      agree.addEventListener('change', update);
      update();
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        parts.targets = ui.widget('aiagent.exec.targets');
        parts.execs = ui.widget('aiagent.exec.title');
        parts.execDetail = ui.h('div', { class: 'ag-exec-detail' });
        parts.execs.controls.appendChild(ui.h('span', { class: 'ag-muted' }, t('aiagent.common.refreshEvery', { sec: Math.max(A.config.pollSec.execution, A.config.minPollSec) })));
        el.appendChild(ui.h('div', { class: 'ag-view ag-view--execution' }, [parts.targets.el, parts.execs.el]));
        ui.loading(parts.targets.body);
        ui.loading(parts.execs.body);
        load().then(
          function () {
            if (alive) A.poller.start(poll, A.config.pollSec.execution);
          },
          function (err) {
            if (!alive) return;
            ui.errorCard(parts.targets.body, err, function () {
              A.router.reload();
            });
            ui.clear(parts.execs.body);
          }
        );
      },
      unmount: function () {
        alive = false; // 폴러는 router 가 stopAll 로 정지
      }
    };
  }

  A.views.execution = {
    instance: null,
    mount: function (el, ctx) {
      this.instance = create();
      this.instance.mount(el, ctx);
    },
    unmount: function () {
      if (this.instance) this.instance.unmount();
      this.instance = null;
    }
  };
})(window);
