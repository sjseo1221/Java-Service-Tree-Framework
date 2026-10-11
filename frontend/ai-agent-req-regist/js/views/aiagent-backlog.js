/*
 * SCR-07 구현 목록 · 배정 (7 · 8단계) — REQ-F-011 · F-012
 * API-401 · 402 · 403 · 404 · 104(요구사항 원문) · 307(근거 SRS) · 604(필터 옵션) · G5(실행 상태)
 * 후보 워커 · 서브 에이전트는 API-403 응답에서만 만든다(하드코딩 없음).
 * AIAGENT.backlogData.load(sid) 는 SCR-08 실행 화면도 쓴다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var MAIN_SLOTS = ['strategist', 'engineer'];
  var SUB_SLOTS = ['reviewer', 'multimodal'];

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  /** 작업 유형은 API 필드가 없어 진행 현황에서 유도한다(설계서 I-11). */
  function workTypeOf(status) {
    return status === '개발중' || status === '테스트중' ? 'CODE' : 'ANALYSIS';
  }

  function latestExec(list) {
    // 시작 전(QUEUED, startedAt 없음)을 가장 최근으로 본다
    return list.slice().sort(function (a, b) {
      return String(b.startedAt || '9999').localeCompare(String(a.startedAt || '9999'));
    })[0];
  }

  /** backlog + 요구사항 원문 + 실행 상태 결합(클라이언트) */
  A.backlogData = {
    workTypeOf: workTypeOf,

    load: function (sid, session) {
      var rev = session && session.latestRevision;
      return Promise.all([
        A.api.request('GET', '/sessions/' + sid + '/backlog'),
        rev ? A.api.request('GET', '/sessions/' + sid + '/uploads/' + rev + '/preview', null, { query: { page: 1, size: A.config.upload.maxRows } }) : { rows: [] },
        A.api.request('GET', '/sessions/' + sid + '/executions'),
        A.api.request('GET', '/workers')
      ]).then(function (r) {
        var reqs = {};
        r[1].rows.forEach(function (row) {
          if (row.reqId) reqs[row.reqId] = row;
        });
        var execsByItem = {};
        r[2].forEach(function (e) {
          (execsByItem[e.itemId] = execsByItem[e.itemId] || []).push(e);
        });
        var rows = r[0].map(function (it) {
          var req = reqs[it.reqId] || {};
          var execs = execsByItem[it.itemId] || [];
          var last = latestExec(execs);
          var a = it.assignment || {};
          return {
            itemId: it.itemId,
            reqId: it.reqId,
            name: req.name || '',
            l1: req.l1 || '',
            l2: req.l2 || '',
            l3: req.l3 || '',
            priority: req.priority || '',
            status: req.status || '',
            detail: req.detail || '',
            sdsRefs: it.sdsRefs || [],
            excluded: !!it.excluded,
            excludeReason: it.excludeReason || null,
            assignment: { mainWorker: a.mainWorker || null, subWorker: a.subWorker || null, subAgent: a.subAgent || null, recommendApplied: !!a.recommendApplied },
            workType: workTypeOf(req.status),
            execState: last ? last.state : 'NONE',
            active: execs.some(function (e) {
              return e.state === 'QUEUED' || e.state === 'RUNNING';
            })
          };
        });
        return { rows: rows, executions: r[2], workers: r[3] };
      });
    },

    /** 실행 가능 = 제외 아님 + 메인 워커 배정 */
    executable: function (row) {
      return !row.excluded && !!row.assignment.mainWorker;
    }
  };

  function create() {
    var ui = A.ui;
    var ctx = null;
    var alive = false;
    var parts = {};
    var v = {
      rows: [],
      workers: { workers: [], subAgents: [] },
      codes: [],
      filter: { l2: '', priority: '', workType: '', execState: '', showExcluded: false },
      selected: {}, // 일괄 배정 선택
      drafts: {}, // itemId → {mainWorker, subWorker, subAgent} (저장 전 값)
      errors: {}, // itemId → 오류 문구
      detailId: null,
      traceSrs: null
    };
    var tbl = null;
    var rowRefs = {}; // itemId → {save, err, rec} — 선택 변경 시 표 전체를 다시 그리지 않는다(포커스 유지)

    function assignLocked() {
      var s = ctx.stages && ctx.stages[7];
      return !s || s.status === 'LOCKED';
    }

    function codesOf(group) {
      return v.codes
        .filter(function (c) {
          return c.group === group;
        })
        .sort(function (a, b) {
          return (a.sortOrder || 0) - (b.sortOrder || 0);
        })
        .map(function (c) {
          return c.code;
        });
    }

    function valueOf(row, field) {
      var d = v.drafts[row.itemId];
      return d && Object.prototype.hasOwnProperty.call(d, field) ? d[field] : row.assignment[field];
    }

    function candidates(field) {
      if (field === 'subAgent') {
        return v.workers.subAgents
          .filter(function (s) {
            return s.enabled;
          })
          .map(function (s) {
            return { name: s.name, title: s.description, disabled: false };
          });
      }
      var slots = field === 'mainWorker' ? MAIN_SLOTS : SUB_SLOTS;
      return v.workers.workers
        .filter(function (x) {
          return slots.indexOf(x.slot) >= 0;
        })
        .map(function (x) {
          return { name: x.name, title: x.slot, disabled: !x.approved };
        });
    }

    function workerSelect(field, value, opts) {
      opts = opts || {};
      var s = ui.h('select', { class: 'ag-input ag-input--sm', disabled: !!opts.disabled, title: opts.title || null, 'aria-label': t('aiagent.backlog.col.' + field), id: opts.id || null });
      var noneLabel = field === 'subWorker' ? t('aiagent.backlog.na') : t('aiagent.common.none');
      s.appendChild(ui.h('option', { value: '' }, field === 'mainWorker' ? '—' : noneLabel));
      candidates(field).forEach(function (c) {
        s.appendChild(ui.h('option', { value: c.name, disabled: c.disabled, title: c.title }, c.name + (c.disabled ? ' (' + t('aiagent.backlog.notApproved') + ')' : '')));
      });
      s.value = value || '';
      if (opts.onChange)
        s.addEventListener('change', function () {
          opts.onChange(s.value || null);
        });
      return s;
    }

    // ── 필터 ──
    function visibleRows() {
      var f = v.filter;
      return v.rows.filter(function (r) {
        if (!f.showExcluded && r.excluded) return false;
        if (f.l2 && r.l2 !== f.l2) return false;
        if (f.priority && r.priority !== f.priority) return false;
        if (f.workType && r.workType !== f.workType) return false;
        if (f.execState && r.execState !== f.execState) return false;
        return true;
      });
    }

    function renderFilters() {
      var bar = ui.clear(parts.filters);
      function select(key, labelKey, values, group) {
        var id = 'ag_bl_f_' + key;
        var s = ui.h('select', { class: 'ag-input ag-input--sm', id: id });
        s.appendChild(ui.h('option', { value: '' }, t('aiagent.common.all')));
        values.forEach(function (x) {
          s.appendChild(ui.h('option', { value: x }, group ? A.i18n.label(group, x) : x));
        });
        s.value = v.filter[key];
        s.addEventListener('change', function () {
          v.filter[key] = s.value;
          renderTable();
        });
        bar.appendChild(ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: id, class: 'ag-label' }, t(labelKey)), s]));
      }
      var cats = [];
      v.rows.forEach(function (r) {
        if (r.l2 && cats.indexOf(r.l2) < 0) cats.push(r.l2);
      });
      select('l2', 'aiagent.backlog.filter.category', cats, null);
      select('priority', 'aiagent.backlog.filter.priority', codesOf('PRIORITY'), 'PRIORITY');
      select('workType', 'aiagent.backlog.filter.workType', codesOf('WORK_TYPE'), 'WORK_TYPE');
      select('execState', 'aiagent.backlog.filter.execState', codesOf('EXEC_STATE'), 'EXEC_STATE');
      var toggle = ui.button({
        labelKey: 'aiagent.backlog.filter.showExcluded',
        kind: 'orange',
        onClick: function () {
          v.filter.showExcluded = !v.filter.showExcluded;
          toggle.setAttribute('aria-pressed', v.filter.showExcluded ? 'true' : 'false');
          renderTable();
        }
      });
      toggle.setAttribute('aria-pressed', v.filter.showExcluded ? 'true' : 'false');
      bar.appendChild(ui.h('div', { class: 'ag-field ag-field--action' }, [toggle]));
      parts.total = ui.h('span', { class: 'ag-muted ag-push' });
      bar.appendChild(parts.total);
    }

    // ── 표 ──
    function columns() {
      var lockedAssign = assignLocked();
      var lockTitle = lockedAssign ? t('aiagent.backlog.assignLocked') : null;
      var focus = ctx.params.focus === 'assign' ? ' is-focus' : '';
      function assignCol(field) {
        return {
          key: field,
          labelKey: 'aiagent.backlog.col.' + field,
          className: 'ag-col-assign' + focus,
          sortable: true,
          sortValue: function (r) {
            return valueOf(r, field) || '';
          },
          render: function (r) {
            return workerSelect(field, valueOf(r, field), {
              disabled: lockedAssign,
              title: lockTitle,
              onChange: function (val) {
                var d = (v.drafts[r.itemId] = v.drafts[r.itemId] || {});
                d[field] = val;
                delete v.errors[r.itemId];
                var ref = rowRefs[r.itemId];
                if (ref) {
                  ref.save.disabled = false;
                  ui.clear(ref.err);
                  ui.clear(ref.rec);
                }
              }
            });
          }
        };
      }
      return [
        {
          key: 'select',
          labelKey: 'aiagent.backlog.col.select',
          render: function (r) {
            return ui.h('input', {
              type: 'checkbox',
              checked: !!v.selected[r.itemId],
              disabled: lockedAssign,
              'aria-label': r.reqId,
              onchange: function (e) {
                v.selected[r.itemId] = e.target.checked;
                renderBulk();
              }
            });
          }
        },
        {
          key: 'include',
          labelKey: 'aiagent.backlog.col.include',
          render: function (r) {
            return ui.h('input', {
              type: 'checkbox',
              checked: !r.excluded,
              title: r.excluded && r.excludeReason ? t('aiagent.common.reason') + ': ' + r.excludeReason : null,
              'aria-label': t('aiagent.backlog.include') + ' ' + r.reqId,
              onchange: function (e) {
                toggleInclude(r, e.target);
              }
            });
          }
        },
        { key: 'reqId', labelKey: 'aiagent.backlog.col.reqId', sortable: true, className: 'ag-nowrap' },
        {
          key: 'name',
          labelKey: 'aiagent.backlog.col.name',
          sortable: true,
          className: 'ag-col-name',
          render: function (r) {
            return ui.h('span', { class: 'ag-clamp2' }, r.name);
          }
        },
        {
          key: 'category',
          labelKey: 'aiagent.backlog.col.category',
          sortable: true,
          sortValue: function (r) {
            return r.l1 + '/' + r.l2 + '/' + r.l3;
          },
          render: function (r) {
            return ui.h('span', { class: 'ag-nowrap' }, [r.l1, r.l2, r.l3].filter(Boolean).join(' / '));
          }
        },
        {
          key: 'sdsRefs',
          labelKey: 'aiagent.backlog.col.sdsRefs',
          render: function (r) {
            return ui.h(
              'span',
              { class: 'ag-chips' },
              r.sdsRefs.map(function (id) {
                return ui.h('span', { class: 'ag-chip' }, id);
              })
            );
          }
        },
        {
          key: 'priority',
          labelKey: 'aiagent.backlog.col.priority',
          sortable: true,
          render: function (r) {
            return A.i18n.label('PRIORITY', r.priority);
          }
        },
        {
          key: 'workType',
          labelKey: 'aiagent.backlog.col.workType',
          sortable: true,
          render: function (r) {
            return ui.badge('WORK_TYPE', r.workType, { tone: 'normal' });
          }
        },
        {
          key: 'execState',
          labelKey: 'aiagent.backlog.col.execState',
          sortable: true,
          render: function (r) {
            if (r.excluded) return ui.badge(null, null, { tone: 'muted', text: t('aiagent.exec.ineligible.excluded') });
            if (!valueOf(r, 'mainWorker')) return ui.h('span', { class: 'ag-muted' }, t('aiagent.backlog.noMain'));
            return ui.badge('EXEC_STATE', r.execState);
          }
        },
        assignCol('mainWorker'),
        assignCol('subWorker'),
        assignCol('subAgent'),
        {
          key: 'recommend',
          labelKey: 'aiagent.backlog.col.recommend',
          render: function (r, td) {
            (rowRefs[r.itemId] = rowRefs[r.itemId] || {}).rec = td;
            return r.assignment.recommendApplied && !v.drafts[r.itemId] ? ui.h('span', { class: 'ag-chip ag-chip--done' }, t('aiagent.backlog.recommended')) : '';
          }
        },
        {
          key: 'save',
          labelKey: 'aiagent.backlog.col.save',
          className: 'ag-col-assign' + focus,
          render: function (r) {
            var ref = (rowRefs[r.itemId] = rowRefs[r.itemId] || {});
            ref.err = ui.h('div', { class: 'ag-cell-error', role: 'alert' }, v.errors[r.itemId] || null);
            ref.save = ui.button({
                labelKey: 'aiagent.common.save',
                kind: 'green',
                disabled: lockedAssign || !v.drafts[r.itemId],
                title: lockTitle,
                onClick: function () {
                  saveRow(r);
                }
              });
            return [ref.save, ref.err];
          }
        }
      ];
    }

    function renderTable() {
      var rows = visibleRows();
      var execCount = rows.filter(function (r) {
        return !r.excluded && !!valueOf(r, 'mainWorker');
      }).length;
      if (parts.total) parts.total.textContent = t('aiagent.backlog.total', { n: rows.length, m: execCount });
      if (!tbl) {
        tbl = ui.table({
          className: 'ag-table--backlog',
          columns: columns(),
          rows: rows,
          rowClass: function (r) {
            return (r.excluded ? 'ag-row--muted' : '') + (r.itemId === v.detailId ? ' is-selected' : '') || null;
          },
          onRowClick: function (r) {
            showDetail(r);
          }
        });
        ui.clear(parts.table).appendChild(tbl.el);
        if (ctx.params.focus === 'assign') {
          tbl.el.scrollLeft = tbl.el.scrollWidth; // 배정 컬럼으로 가로 스크롤
        }
      } else {
        tbl.setRows(rows);
      }
    }

    // ── 저장(API-404) ──
    function draftAssignment(r) {
      return { mainWorker: valueOf(r, 'mainWorker'), subWorker: valueOf(r, 'subWorker'), subAgent: valueOf(r, 'subAgent') };
    }

    function sameWorker(a) {
      return !!a.mainWorker && !!a.subWorker && a.mainWorker === a.subWorker;
    }

    function putAssignment(r, a) {
      return A.api.request('PUT', '/backlog/' + r.itemId + '/assignment', a).then(function (res) {
        r.assignment = res.assignment;
        delete v.drafts[r.itemId];
        delete v.errors[r.itemId];
        return res;
      });
    }

    function saveRow(r) {
      var a = draftAssignment(r);
      if (sameWorker(a)) {
        v.errors[r.itemId] = t('aiagent.backlog.sameWorker'); // AGT-VAL-005 사전 차단(호출 안 함)
        renderTable();
        return;
      }
      putAssignment(r, a).then(
        function () {
          ui.toast('success', t('aiagent.backlog.saved', { id: r.reqId }));
          A.flow.reload();
          if (alive) renderTable();
        },
        function (err) {
          v.errors[r.itemId] = A.api.errorMessage(err);
          if (alive) renderTable();
        }
      );
    }

    // ── 포함/제외(API-402) ──
    function toggleInclude(r, cb) {
      if (!cb.checked) {
        ui.reasonPrompt({ titleKey: 'aiagent.backlog.excludeAsk' }).then(function (reason) {
          if (reason == null) {
            cb.checked = true;
            return;
          }
          patchExcluded(r, true, reason, cb);
        });
      } else {
        patchExcluded(r, false, null, cb);
      }
    }

    function patchExcluded(r, excluded, reason, cb) {
      A.api.request('PATCH', '/backlog/' + r.itemId, { excluded: excluded, reason: reason }).then(
        function (res) {
          r.excluded = res.excluded;
          r.excludeReason = reason;
          ui.toast('success', t(excluded ? 'aiagent.backlog.excludedToast' : 'aiagent.backlog.includedToast', { id: r.reqId }));
          if (alive) renderTable();
        },
        function (err) {
          cb.checked = !excluded;
          ui.toast('error', A.api.errorMessage(err));
        }
      );
    }

    // ── 일괄 배정 ──
    function renderBulk() {
      var box = ui.clear(parts.bulk);
      var ids = Object.keys(v.selected).filter(function (k) {
        return v.selected[k];
      });
      box.classList.toggle('ag-hidden-block', !ids.length);
      if (!ids.length) return;
      var bulk = { mainWorker: null, subWorker: null, subAgent: null };
      var err = ui.h('span', { class: 'ag-text-crit', role: 'alert' });
      function sel(field) {
        var id = 'ag_bl_bulk_' + field;
        return ui.h('div', { class: 'ag-field' }, [
          ui.h('label', { for: id, class: 'ag-label' }, t('aiagent.backlog.col.' + field)),
          workerSelect(field, null, {
            id: id,
            onChange: function (val) {
              bulk[field] = val;
              err.textContent = '';
            }
          })
        ]);
      }
      var apply = ui.button({
        labelKey: 'aiagent.backlog.bulkApply',
        kind: 'green',
        onClick: function () {
          if (sameWorker(bulk)) {
            err.textContent = t('aiagent.backlog.sameWorker');
            return;
          }
          apply.disabled = true;
          var targets = v.rows.filter(function (r) {
            return v.selected[r.itemId];
          });
          var ok = 0;
          var failed = 0;
          // 선택 행마다 순차 호출
          targets
            .reduce(function (p, r) {
              return p.then(function () {
                return putAssignment(r, { mainWorker: bulk.mainWorker, subWorker: bulk.subWorker, subAgent: bulk.subAgent }).then(
                  function () {
                    ok++;
                  },
                  function (e) {
                    failed++;
                    v.errors[r.itemId] = A.api.errorMessage(e);
                  }
                );
              });
            }, Promise.resolve())
            .then(function () {
              ui.toast(failed ? 'warn' : 'success', t('aiagent.backlog.bulkResult', { ok: ok, fail: failed }));
              v.selected = {};
              A.flow.reload();
              if (!alive) return;
              renderBulk();
              renderTable();
            });
        }
      });
      box.appendChild(
        ui.h('div', { class: 'ag-form-row' }, [
          ui.h('strong', { class: 'ag-bulk-title' }, t('aiagent.backlog.bulk') + ' · ' + t('aiagent.common.count', { n: ids.length })),
          sel('mainWorker'),
          sel('subWorker'),
          sel('subAgent'),
          ui.h('div', { class: 'ag-field ag-field--action' }, [apply]),
          err
        ])
      );
    }

    // ── 우측 근거 패널 ──
    function showDetail(r) {
      v.detailId = r.itemId;
      renderTable();
      var body = ui.clear(parts.detail.body);
      parts.detailTitle.textContent = r.reqId + ' — ' + r.name;
      body.appendChild(parts.detailTitle);
      var srsBox = ui.h('span', { class: 'ag-chips' }, ui.h('span', { class: 'ag-muted' }, t('aiagent.common.loading')));
      body.appendChild(
        ui.h('dl', { class: 'ag-dl' }, [
          ui.h('dt', null, t('aiagent.backlog.col.sdsRefs')),
          ui.h(
            'dd',
            null,
            ui.h(
              'span',
              { class: 'ag-chips' },
              r.sdsRefs.map(function (id) {
                return ui.h('span', { class: 'ag-chip' }, id);
              })
            )
          ),
          ui.h('dt', null, t('aiagent.backlog.srsRefs')),
          ui.h('dd', null, srsBox)
        ])
      );
      body.appendChild(
        ui.h('div', { class: 'ag-actions' }, [
          ui.h('a', { class: 'ag-btn ag-btn--plain', href: '#/stage/5' }, [ui.icon('doc-check'), t('aiagent.backlog.openSrs')]),
          ui.h('a', { class: 'ag-btn ag-btn--plain', href: '#/stage/6' }, [ui.icon('doc-check'), t('aiagent.backlog.openSds')])
        ])
      );
      body.appendChild(ui.h('h5', { class: 'ag-subtitle' }, t('aiagent.upload.col.detail')));
      body.appendChild(ui.h('pre', { class: 'ag-pre ag-detail-pre' }, r.detail));

      var p = v.traceSrs ? Promise.resolve(v.traceSrs) : A.api.request('GET', '/sessions/' + ctx.sid + '/traceability', null, { query: { from: 'REQ', to: 'SRS' } });
      p.then(
        function (list) {
          v.traceSrs = list;
          var hit = list.filter(function (x) {
            return x.sourceId === r.reqId;
          })[0];
          ui.clear(srsBox);
          (hit ? hit.targetIds : []).forEach(function (id) {
            srsBox.appendChild(ui.h('span', { class: 'ag-chip' }, id));
          });
          if (!hit || !hit.targetIds.length) srsBox.appendChild(ui.h('span', { class: 'ag-muted' }, t('aiagent.doc.traceUnlinked')));
        },
        function (err) {
          ui.clear(srsBox).appendChild(ui.h('span', { class: 'ag-text-crit' }, A.api.errorMessage(err)));
        }
      );
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        parts.list = ui.widget('aiagent.backlog.title', { className: 'ag-widget--wide' });
        parts.detail = ui.widget('aiagent.backlog.detail');
        parts.detailTitle = ui.h('p', { class: 'ag-filter-note' });
        parts.filters = ui.h('div', { class: 'ag-form-row ag-filterbar' });
        parts.bulk = ui.h('div', { class: 'ag-bulk ag-hidden-block' });
        parts.table = ui.h('div');
        parts.list.body.appendChild(parts.filters);
        if (assignLocked()) parts.list.body.appendChild(ui.h('div', { class: 'ag-banner ag-banner--warn', role: 'note' }, [ui.icon('lock'), t('aiagent.backlog.assignLocked')]));
        parts.list.body.appendChild(parts.bulk);
        parts.list.body.appendChild(parts.table);
        parts.detail.body.appendChild(ui.empty(t('aiagent.backlog.selectRow')));

        el.appendChild(ui.h('div', { class: 'ag-view ag-view--backlog' }, [ui.h('div', { class: 'ag-split ag-split--wide' }, [parts.list.el, parts.detail.el])]));
        ui.loading(parts.table);

        Promise.all([A.backlogData.load(ctx.sid, ctx.session), A.api.request('GET', '/codes')]).then(
          function (r) {
            if (!alive) return;
            v.rows = r[0].rows;
            v.workers = r[0].workers;
            v.codes = r[1];
            renderFilters();
            renderTable();
          },
          function (err) {
            if (alive)
              ui.errorCard(parts.table, err, function () {
                A.router.reload();
              });
          }
        );
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.backlog = {
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
