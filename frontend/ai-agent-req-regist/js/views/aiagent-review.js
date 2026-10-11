/*
 * SCR-05 검토 지적사항 처리 (3단계) — REQ-F-005 · F-006
 * API-201(검토 실행 job) · 202 · 203 · 204 · 205 · 206 · 207 · 104(요구사항 목록) · 601
 * 화면 비활성화는 보조 수단이다. 같은 판정을 mock-server gate 가 다시 한다(AGT-GATE-003 · VAL-004 · IMM-001).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var SEVS = ['HIGH', 'MEDIUM', 'LOW'];
  var STATES = ['OPEN', 'ACCEPTED', 'REJECTED', 'HELD'];
  var DECISIONS = ['ACCEPTED', 'REJECTED', 'HELD'];
  var runningJob = {}; // sid → {jobId, round} — 화면을 떠났다 돌아와도 이어서 추적

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var ctx = null;
    var alive = false;
    var parts = {};
    var v = {
      rounds: [],
      round: null,
      rows: [],
      all: [], // 전 회차 지적(확정 가능 여부 계산용)
      filter: { reqId: null, severity: '', state: '' },
      checked: {},
      highlight: {},
      job: null
    };

    function base() {
      return '/sessions/' + ctx.sid;
    }

    function locked() {
      var s = ctx.stages && ctx.stages[2];
      return !!s && s.status === 'COMPLETED';
    }

    function roundFindings() {
      return v.all.filter(function (f) {
        return f.round === v.round;
      });
    }

    function rowOf(reqId) {
      return v.rows.filter(function (r) {
        return r.reqId === reqId;
      })[0];
    }

    function openSummary() {
      var open = v.all.filter(function (f) {
        return f.state === 'OPEN';
      });
      return {
        n: open.length,
        h: open.filter(function (f) {
          return f.severity === 'HIGH';
        }).length
      };
    }

    // ── 데이터 ──
    function loadFindings() {
      return Promise.all(
        v.rounds.map(function (rv) {
          return A.api.request('GET', base() + '/reviews/' + rv.round + '/findings').then(function (list) {
            return list.map(function (f) {
              return Object.assign({ round: rv.round }, f);
            });
          });
        })
      ).then(function (lists) {
        v.all = [].concat.apply([], lists);
      });
    }

    function reloadAll() {
      return loadFindings().then(function () {
        if (!alive) return;
        renderTop();
        renderList();
        renderFindings();
      });
    }

    // ── 상단 바 ──
    function renderTop() {
      var c = ui.clear(parts.top.controls);
      var sel = ui.h('select', { class: 'ag-input ag-input--sm', id: 'ag_rv_round', disabled: !v.rounds.length });
      v.rounds.forEach(function (rv) {
        var fc = rv.findingCount || {};
        sel.appendChild(ui.h('option', { value: String(rv.round) }, t('aiagent.review.round', { n: rv.round }) + ' · ' + t('aiagent.review.countHML', { h: fc.high || 0, m: fc.medium || 0, l: fc.low || 0 })));
      });
      if (v.round) sel.value = String(v.round);
      sel.addEventListener('change', function () {
        v.round = Number(sel.value);
        v.highlight = {};
        renderList();
        renderFindings();
      });
      c.appendChild(ui.h('label', { for: 'ag_rv_round', class: 'ag-label ag-label--inline' }, t('aiagent.review.roundLabel')));
      c.appendChild(sel);

      c.appendChild(
        ui.button({
          labelKey: 'aiagent.review.run',
          kind: 'blue',
          icon: 'review',
          disabled: locked() || !!v.job,
          title: locked() ? t('aiagent.review.locked') : null,
          onClick: openRun
        })
      );

      if (locked()) {
        c.appendChild(ui.button({ labelKey: 'aiagent.review.release', kind: 'red', onClick: release }));
      } else {
        var os = openSummary();
        var blocked = os.n > 0;
        var why = !v.rounds.length ? t('aiagent.review.noRound') : blocked ? t('aiagent.review.confirmBlocked', { n: os.n, h: os.h }) : v.job ? t('aiagent.review.running', { p: v.job.progress }) : null;
        c.appendChild(
          ui.button({
            labelKey: 'aiagent.review.confirm',
            kind: 'green',
            icon: 'check',
            disabled: blocked || !!v.job || !v.rounds.length,
            title: why,
            onClick: confirmReview
          })
        );
        if (blocked) c.appendChild(ui.h('span', { class: 'ag-hint ag-text-warn' }, why));
      }
      renderProgress();
    }

    function renderProgress() {
      var box = ui.clear(parts.progress);
      if (!v.job) return;
      var p = v.job.progress || 0;
      box.appendChild(
        ui.h('div', { class: 'ag-progress-row' }, [
          ui.h('div', { class: 'ag-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p), 'aria-label': t('aiagent.review.running', { p: p }) }, [
            ui.h('div', { class: 'ag-progress-bar', style: 'width:' + p + '%' })
          ]),
          ui.h('span', { class: 'ag-muted' }, t('aiagent.review.running', { p: p }))
        ])
      );
    }

    // ── 검토 실행(API-201 → API-601 폴링) ──
    function openRun() {
      var checked = Object.keys(v.checked).filter(function (k) {
        return v.checked[k];
      });
      var cats = [];
      v.rows.forEach(function (r) {
        if (r.l2 && cats.indexOf(r.l2) < 0) cats.push(r.l2);
      });
      var scope = 'ALL';
      var catSel = ui.h('select', { class: 'ag-input', id: 'ag_rv_cat', multiple: true, size: String(Math.min(cats.length, 6)) });
      cats.forEach(function (c) {
        catSel.appendChild(ui.h('option', { value: c }, c));
      });
      var catField = ui.h('div', { class: 'ag-field ag-hidden-block' }, [ui.h('label', { for: 'ag_rv_cat', class: 'ag-label' }, t('aiagent.review.category')), catSel]);
      var errBox = ui.h('div');
      var radios = ['ALL', 'SELECTED', 'CATEGORY'].map(function (s) {
        var input = ui.h('input', { type: 'radio', name: 'ag_rv_scope', value: s, id: 'ag_rv_scope_' + s, checked: s === 'ALL' });
        input.addEventListener('change', function () {
          scope = s;
          catField.classList.toggle('ag-hidden-block', s !== 'CATEGORY');
          update();
        });
        var label = t('aiagent.review.scope.' + s) + (s === 'SELECTED' ? ' (' + t('aiagent.review.selectedCount', { n: checked.length }) + ')' : '');
        return ui.h('label', { class: 'ag-radio', for: 'ag_rv_scope_' + s }, [input, label]);
      });
      catSel.addEventListener('change', update);
      var m = ui.modal({
        titleKey: 'aiagent.review.run',
        body: [ui.h('fieldset', { class: 'ag-fieldset' }, [ui.h('legend', { class: 'ag-label' }, t('aiagent.review.scopeLabel'))].concat(radios)), catField, errBox],
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.review.run',
            kind: 'blue',
            onClick: function (api) {
              var targets = scope === 'SELECTED' ? checked : scope === 'CATEGORY' ? selectedValues(catSel) : [];
              api.setDisabled(1, true);
              A.api
                .request('POST', base() + '/reviews', { scope: scope, targets: targets })
                .then(function (res) {
                  api.close('ok');
                  watch({ jobId: res.jobId, round: res.round });
                  A.flow.reload();
                })
                .catch(function (err) {
                  api.setDisabled(1, false);
                  ui.errorCard(errBox, err);
                });
            }
          }
        ]
      });
      function update() {
        var empty = (scope === 'SELECTED' && !checked.length) || (scope === 'CATEGORY' && !selectedValues(catSel).length);
        m.setDisabled(1, empty);
      }
    }

    function selectedValues(sel) {
      return Array.prototype.filter
        .call(sel.options, function (o) {
          return o.selected;
        })
        .map(function (o) {
          return o.value;
        });
    }

    function watch(job) {
      runningJob[ctx.sid] = job;
      v.job = { progress: 0 };
      renderTop();
      var sid = ctx.sid;
      A.poller
        .watchJob(job.jobId, function (j) {
          if (!alive || !v.job) return;
          v.job.progress = j.progress;
          renderProgress();
        })
        .promise.then(
          function () {
            delete runningJob[sid];
            if (!alive) return;
            ui.toast('success', t('aiagent.review.jobDone', { n: job.round }));
            A.flow.reload().then(function () {
              A.router.go('#/stage/3?round=' + job.round);
            });
          },
          function (err) {
            delete runningJob[sid];
            if (!alive) return;
            v.job = null;
            renderTop();
            ui.errorCard(parts.msg, err);
          }
        );
    }

    // ── 검토 확정(API-206) · 확정 해제(API-207) ──
    function confirmReview() {
      ui.clear(parts.msg);
      ui.modal({
        titleKey: 'aiagent.review.confirm',
        body: ui.h('p', null, t('aiagent.review.confirmAsk')),
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.review.confirm',
            kind: 'green',
            onClick: function (m) {
              m.setDisabled(1, true);
              A.api
                .request('POST', base() + '/stages/REVIEW/confirm')
                .then(function () {
                  m.close('ok');
                  ui.toast('success', t('aiagent.review.confirmed'));
                  return A.flow.reload().then(function () {
                    A.router.go('#/stage/4');
                  });
                })
                .catch(function (err) {
                  m.close('error');
                  if (!alive) return;
                  if (err.code === 'AGT-GATE-003') {
                    // details = 확정을 막은 findingId 목록 → 강조
                    v.highlight = {};
                    (err.details || []).forEach(function (id) {
                      v.highlight[id] = true;
                    });
                    var first = v.all.filter(function (f) {
                      return v.highlight[f.findingId];
                    })[0];
                    if (first) v.round = first.round;
                    v.filter = { reqId: null, severity: '', state: '' };
                    renderTop();
                    renderList();
                    renderFindings();
                  }
                  ui.errorCard(parts.msg, err);
                });
            }
          }
        ]
      });
    }

    function release() {
      ui.releaseStage({ sid: ctx.sid, stage: 'REVIEW', titleKey: 'aiagent.review.release' }).then(function (res) {
        if (res) A.router.go('#/stage/3');
      });
    }

    // ── 좌측 요구사항 목록 ──
    function counts() {
      var map = {};
      roundFindings().forEach(function (f) {
        if (v.filter.severity && f.severity !== v.filter.severity) return;
        if (v.filter.state && f.state !== v.filter.state) return;
        var c = (map[f.reqId] = map[f.reqId] || { HIGH: 0, MEDIUM: 0, LOW: 0 });
        c[f.severity]++;
      });
      return map;
    }

    function renderList() {
      var body = ui.clear(parts.list.body);
      var map = counts();
      var filtering = !!(v.filter.severity || v.filter.state);
      var rows = v.rows.filter(function (r) {
        return !filtering || map[r.reqId];
      });
      body.appendChild(
        ui.table({
          className: 'ag-table--compact',
          columns: [
            {
              key: 'sel',
              label: '',
              render: function (r) {
                var cb = ui.h('input', {
                  type: 'checkbox',
                  checked: !!v.checked[r.reqId],
                  disabled: locked(),
                  'aria-label': r.reqId,
                  onchange: function (e) {
                    v.checked[r.reqId] = e.target.checked;
                  }
                });
                return cb;
              }
            },
            { key: 'reqId', labelKey: 'aiagent.upload.col.reqId', sortable: true, className: 'ag-nowrap' },
            {
              key: 'name',
              labelKey: 'aiagent.upload.col.name',
              sortable: true,
              render: function (r) {
                return ui.h('span', { class: 'ag-clamp2' }, r.name);
              }
            },
            {
              key: 'cnt',
              label: t('aiagent.review.findings'),
              sortValue: function (r) {
                var c = map[r.reqId];
                return c ? c.HIGH * 100 + c.MEDIUM * 10 + c.LOW : 0;
              },
              sortable: true,
              render: function (r) {
                var c = map[r.reqId];
                if (!c) return '';
                return SEVS.filter(function (s) {
                  return c[s] > 0;
                }).map(function (s) {
                  return ui.badge('FINDING_SEVERITY', s, { text: t('aiagent.review.sevShort.' + s, { n: c[s] }), title: A.i18n.label('FINDING_SEVERITY', s) });
                });
              }
            }
          ],
          rows: rows,
          rowClass: function (r) {
            return r.reqId === v.filter.reqId ? 'is-selected' : null;
          },
          onRowClick: function (r) {
            setReq(r.reqId);
          }
        }).el
      );
    }

    function setReq(reqId, highlight) {
      v.filter.reqId = reqId;
      v.highlight = highlight || {};
      renderList();
      renderFindings();
    }

    // ── 우측 지적사항 패널(API-203) ──
    function renderFilterControls() {
      var c = ui.clear(parts.findings.controls);
      function select(id, labelKey, group, values, key) {
        var s = ui.h('select', { class: 'ag-input ag-input--sm', id: id });
        s.appendChild(ui.h('option', { value: '' }, t('aiagent.common.all')));
        values.forEach(function (x) {
          s.appendChild(ui.h('option', { value: x }, A.i18n.label(group, x)));
        });
        s.value = v.filter[key];
        s.addEventListener('change', function () {
          v.filter[key] = s.value;
          renderList();
          renderFindings();
        });
        c.appendChild(ui.h('label', { for: id, class: 'ag-label ag-label--inline' }, t(labelKey)));
        c.appendChild(s);
      }
      select('ag_rv_sev', 'aiagent.review.filter.severity', 'FINDING_SEVERITY', SEVS, 'severity');
      select('ag_rv_state', 'aiagent.review.filter.state', 'FINDING_STATE', STATES, 'state');
      c.appendChild(
        ui.button({
          labelKey: 'aiagent.common.all',
          kind: 'orange',
          disabled: !v.filter.reqId,
          onClick: function () {
            setReq(null);
          }
        })
      );
    }

    function renderFindings() {
      renderFilterControls();
      var body = parts.findings.body;
      if (!v.round) {
        ui.clear(body).appendChild(ui.empty(t('aiagent.review.noRound')));
        return;
      }
      var round = v.round;
      ui.loading(body);
      A.api
        .request('GET', base() + '/reviews/' + round + '/findings', null, { query: { reqId: v.filter.reqId, severity: v.filter.severity, state: v.filter.state } })
        .then(
          function (list) {
            if (!alive || v.round !== round) return;
            ui.clear(body);
            if (v.filter.reqId) {
              var row = rowOf(v.filter.reqId);
              body.appendChild(ui.h('p', { class: 'ag-filter-note' }, [ui.h('strong', null, v.filter.reqId), row ? ' ' + row.name : '']));
            }
            if (!list.length) {
              body.appendChild(ui.empty());
              return;
            }
            list.forEach(function (f) {
              body.appendChild(card(f));
            });
            var hi = body.querySelector('.ag-finding.is-highlight');
            if (hi && typeof hi.scrollIntoView === 'function') hi.scrollIntoView({ block: 'nearest' });
          },
          function (err) {
            if (alive) ui.errorCard(body, err, renderFindings);
          }
        );
    }

    function card(f) {
      var linked = (f.linkedReqIds || []).map(function (id) {
        return ui.h(
          'button',
          {
            type: 'button',
            class: 'ag-chip ag-chip--link',
            onclick: function () {
              // 상호 링크된 카드(상충 · 중복 쌍)를 강조
              var hl = {};
              roundFindings().forEach(function (x) {
                if (x.reqId === id && (x.linkedReqIds || []).indexOf(f.reqId) >= 0) hl[x.findingId] = true;
              });
              setReq(id, hl);
            }
          },
          id
        );
      });
      return ui.h('article', { class: 'ag-finding' + (v.highlight[f.findingId] ? ' is-highlight' : ''), 'data-finding': f.findingId }, [
        ui.h('div', { class: 'ag-finding-head' }, [
          ui.badge('FINDING_SEVERITY', f.severity),
          ui.badge('FINDING_ASPECT', f.aspect, { tone: 'normal' }),
          ui.badge('FINDING_STATE', f.state, { outline: f.state === 'OPEN' }),
          ui.h(
            'button',
            {
              type: 'button',
              class: 'ag-link-btn',
              onclick: function () {
                setReq(f.reqId);
              }
            },
            f.reqId
          ),
          ui.h('span', { class: 'ag-mono ag-muted ag-push' }, f.findingId)
        ]),
        ui.h('p', { class: 'ag-finding-content' }, f.content),
        ui.h('div', { class: 'ag-suggest' }, [ui.h('div', { class: 'ag-label' }, t('aiagent.review.suggestion')), ui.h('p', null, f.suggestion)]),
        linked.length ? ui.h('div', { class: 'ag-finding-linked' }, [ui.h('span', { class: 'ag-label' }, t('aiagent.review.linked'))].concat(linked)) : null,
        decisionForm(f),
        f.state === 'ACCEPTED' && !locked() ? applyArea(f) : null
      ]);
    }

    function decisionForm(f) {
      var ro = locked();
      var id = 'ag_dec_' + f.findingId;
      var reason = ui.h('textarea', { class: 'ag-input', rows: '2', id: id + '_reason', disabled: ro });
      reason.value = f.reason || '';
      var hint = ui.h('p', { class: 'ag-hint ag-text-crit ag-hidden-block' }, t('aiagent.review.rejectReasonRequired'));
      var errBox = ui.h('div');
      var save = ui.button({ labelKey: 'aiagent.review.saveDecision', kind: 'green', disabled: true, onClick: submit });
      var radios = DECISIONS.map(function (s) {
        var input = ui.h('input', { type: 'radio', name: id, value: s, id: id + '_' + s, checked: f.state === s, disabled: ro, onchange: update });
        return ui.h('label', { class: 'ag-radio', for: id + '_' + s }, [input, A.i18n.label('FINDING_STATE', s)]);
      });
      reason.addEventListener('input', update);

      function choice() {
        var c = radios
          .map(function (l) {
            return l.querySelector('input');
          })
          .filter(function (i) {
            return i.checked;
          })[0];
        return c ? c.value : null;
      }

      function update() {
        var s = choice();
        var needReason = s === 'REJECTED' && !reason.value.trim(); // AGT-VAL-004 사전 차단
        hint.classList.toggle('ag-hidden-block', !needReason);
        save.disabled = ro || !s || needReason;
      }

      function submit() {
        var s = choice();
        save.disabled = true;
        ui.clear(errBox);
        A.api
          .request('PATCH', '/findings/' + encodeURIComponent(f.findingId), { state: s, reason: reason.value.trim() || null })
          .then(function () {
            ui.toast('success', t('aiagent.review.saved', { id: f.findingId }));
            if (alive) reloadAll();
          })
          .catch(function (err) {
            ui.errorCard(errBox, err);
            update();
          });
      }

      update();
      return ui.h('fieldset', { class: 'ag-fieldset ag-decision', disabled: ro }, [
        ui.h('legend', { class: 'ag-label' }, t('aiagent.review.decision')),
        ui.h('div', { class: 'ag-radio-row' }, radios),
        ui.h('label', { for: id + '_reason', class: 'ag-label' }, t('aiagent.common.reason')),
        reason,
        hint,
        ui.h('div', { class: 'ag-actions' }, [save]),
        errBox
      ]);
    }

    // 수용 후 인라인 편집(API-205)
    function applyArea(f) {
      var box = ui.h('div', { class: 'ag-apply' });
      var open = ui.button({
        labelKey: 'aiagent.review.applyToBody',
        kind: 'plain',
        icon: 'register',
        onClick: function () {
          open.disabled = true;
          box.appendChild(editor(f, function () {
            open.disabled = false;
          }));
        }
      });
      box.appendChild(open);
      return box;
    }

    function editor(f, onClose) {
      var id = 'ag_edit_' + f.findingId;
      var row = rowOf(f.reqId) || {};
      var field = ui.h('select', { class: 'ag-input ag-input--sm', id: id + '_field' });
      ['name', 'detail'].forEach(function (k) {
        field.appendChild(ui.h('option', { value: k }, t('aiagent.review.field.' + k)));
      });
      var area = ui.h('textarea', { class: 'ag-input ag-mono', rows: '8', id: id + '_value' });
      var hint = ui.h('p', { class: 'ag-hint ag-text-crit ag-hidden-block' }, t('aiagent.review.nameTooLong'));
      var errBox = ui.h('div');
      var el;
      var save = ui.button({
        labelKey: 'aiagent.review.applySave',
        kind: 'green',
        onClick: function () {
          save.disabled = true;
          ui.clear(errBox);
          A.api
            .request('PATCH', '/requirements/' + encodeURIComponent(f.reqId), { field: field.value, value: area.value, findingId: f.findingId })
            .then(function (res) {
              ui.toast('success', t('aiagent.review.applySaved', { v: res.version }));
              row[field.value] = field.value === 'name' ? area.value.trim() : area.value;
              if (!alive) return;
              renderList();
              close();
            })
            .catch(function (err) {
              ui.errorCard(errBox, err);
              update();
            });
        }
      });
      function fill() {
        area.value = row[field.value] || '';
        area.rows = field.value === 'name' ? 2 : 10;
        update();
      }
      function update() {
        var tooLong = field.value === 'name' && area.value.trim().length > 40;
        hint.classList.toggle('ag-hidden-block', !tooLong);
        save.disabled = !area.value.trim() || tooLong;
      }
      function close() {
        if (el.parentNode) el.parentNode.removeChild(el);
        onClose();
      }
      field.addEventListener('change', fill);
      area.addEventListener('input', update);
      el = ui.h('div', { class: 'ag-editor' }, [
        ui.h('div', { class: 'ag-suggest' }, [ui.h('div', { class: 'ag-label' }, t('aiagent.review.suggestion')), ui.h('p', null, f.suggestion)]),
        ui.h('div', { class: 'ag-form-row' }, [ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: id + '_field', class: 'ag-label' }, t('aiagent.review.applyField')), field])]),
        ui.h('label', { for: id + '_value', class: 'ag-label' }, t('aiagent.review.applyValue')),
        area,
        hint,
        ui.h('div', { class: 'ag-actions' }, [ui.button({ labelKey: 'aiagent.common.cancel', kind: 'plain', onClick: close }), save]),
        errBox
      ]);
      fill();
      return el;
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        parts.top = ui.widget('aiagent.review.title');
        parts.list = ui.widget('aiagent.review.reqList');
        parts.findings = ui.widget('aiagent.review.findings');
        parts.msg = ui.h('div', { class: 'ag-msg', 'aria-live': 'polite' });
        parts.progress = ui.h('div');
        parts.top.body.appendChild(parts.progress);
        parts.top.body.appendChild(parts.msg);
        if (locked()) parts.top.body.insertBefore(ui.h('div', { class: 'ag-banner ag-banner--warn', role: 'note' }, [ui.icon('lock'), t('aiagent.review.locked')]), parts.progress);

        el.appendChild(
          ui.h('div', { class: 'ag-view ag-view--review' }, [parts.top.el, ui.h('div', { class: 'ag-split' }, [parts.list.el, parts.findings.el])])
        );
        ui.loading(parts.list.body);
        ui.loading(parts.findings.body);

        var rev = ctx.session && ctx.session.latestRevision;
        Promise.all([
          A.api.request('GET', base() + '/reviews'),
          rev ? A.api.request('GET', base() + '/uploads/' + rev + '/preview', null, { query: { page: 1, size: A.config.upload.maxRows } }) : { rows: [] }
        ])
          .then(function (r) {
            if (!alive) return null;
            v.rounds = r[0] || [];
            v.rows = r[1].rows.filter(function (x) {
              return x.reqId;
            });
            var want = Number(ctx.params.round);
            var last = v.rounds.length ? v.rounds[v.rounds.length - 1].round : null;
            v.round = v.rounds.some(function (x) {
              return x.round === want;
            })
              ? want
              : last;
            if (ctx.params.reqId) v.filter.reqId = ctx.params.reqId;
            return reloadAll();
          })
          .then(function () {
            if (alive && runningJob[ctx.sid]) watch(runningJob[ctx.sid]);
          })
          .catch(function (err) {
            if (!alive) return;
            ui.errorCard(parts.list.body, err, function () {
              A.router.reload();
            });
            ui.clear(parts.findings.body);
          });
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.review = {
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
