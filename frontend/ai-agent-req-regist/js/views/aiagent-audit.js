/*
 * SCR-12 감사 추적 조회 (헤더 버튼) — REQ-NF-004 · REQ-SE-001
 * API-602(감사 기록 · 페이지 20, total 없음 — 설계서 I-02) · 603(요구사항 전 경로)
 * 조회 전용: 수정 · 삭제 UI 없음(CON-01). #/audit?reqId= 로 들어오면 값을 채우고 자동 검색한다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var PAGE = 20;
  var SECTIONS = ['upload', 'registration', 'review', 'srs', 'sds', 'executions', 'commits'];

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var alive = false;
    var parts = {};
    var f = {}; // 폼 요소
    var v = { page: 1, query: {}, table: null, traceReq: null };

    // ── 검색 폼 ──
    function field(id, labelKey, input) {
      input.id = id;
      return ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: id, class: 'ag-label' }, t(labelKey)), input]);
    }

    function buildForm(init) {
      f.reqId = ui.h('input', { type: 'text', class: 'ag-input ag-mono', autocomplete: 'off', placeholder: 'REQ-F-001', value: init.reqId || '' });
      f.actor = ui.h('input', { type: 'text', class: 'ag-input', autocomplete: 'off', value: init.actor || '' });
      f.from = ui.h('input', { type: 'date', class: 'ag-input', value: init.from || '' });
      f.to = ui.h('input', { type: 'date', class: 'ag-input', value: init.to || '' });
      f.msg = ui.h('p', { class: 'ag-msg ag-text-warn', 'aria-live': 'polite' });
      var form = ui.h('form', { class: 'ag-audit-form', novalidate: true }, [
        ui.h('div', { class: 'ag-form-row' }, [
          field('ag_audit_req', 'aiagent.audit.reqId', f.reqId),
          field('ag_audit_actor', 'aiagent.audit.actor', f.actor),
          field('ag_audit_from', 'aiagent.audit.from', f.from),
          field('ag_audit_to', 'aiagent.audit.to', f.to),
          ui.h('div', { class: 'ag-field ag-field--action' }, ui.h('div', { class: 'ag-btn-group' }, [
            ui.h('button', { type: 'submit', class: 'ag-btn ag-btn--plain' }, [ui.icon('review'), t('aiagent.audit.search')]),
            ui.button({ labelKey: 'aiagent.audit.reset', kind: 'plain', onClick: reset })
          ]))
        ]),
        f.msg
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        search(1);
      });
      return form;
    }

    function reset() {
      ['reqId', 'actor', 'from', 'to'].forEach(function (k) {
        f[k].value = '';
      });
      search(1);
    }

    // ── 결과 표 ──
    function aiMetaCell(row) {
      var m = row.aiMeta;
      if (!m) return ui.h('span', { class: 'ag-muted' }, '—');
      var items = [['aiagent.audit.aiMeta.model', m.model], ['aiagent.audit.aiMeta.input', m.inputSummary], ['aiagent.audit.aiMeta.generatedAt', m.generatedAt ? ui.fmt.dt(m.generatedAt) : null]].filter(function (x) {
        return x[1];
      });
      return ui.h('details', { class: 'ag-details ag-ai-meta' }, [
        ui.h('summary', null, ui.h('span', { class: 'ag-badge ag-tone--normal' }, t('aiagent.audit.ai'))),
        ui.h(
          'dl',
          { class: 'ag-dl' },
          items.map(function (x) {
            return [ui.h('dt', null, t(x[0])), ui.h('dd', null, x[1])];
          })
        )
      ]);
    }

    var COLUMNS = [
      {
        key: 'actedAt',
        labelKey: 'aiagent.audit.col.actedAt',
        className: 'ag-nowrap',
        render: function (r) {
          return ui.fmt.dt(r.actedAt);
        }
      },
      { key: 'actor', labelKey: 'aiagent.audit.col.actor', className: 'ag-nowrap' },
      {
        key: 'action',
        labelKey: 'aiagent.audit.col.action',
        render: function (r) {
          return ui.badge('AUDIT_ACTION', r.action, { tone: 'normal' });
        }
      },
      {
        key: 'targetType',
        labelKey: 'aiagent.audit.col.targetType',
        render: function (r) {
          return A.i18n.label('TARGET_TYPE', r.targetType);
        }
      },
      {
        key: 'targetId',
        labelKey: 'aiagent.audit.col.targetId',
        render: function (r) {
          var id = String(r.targetId || '');
          var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
          var out = [ui.h('span', { class: 'ag-mono', title: id }, isUuid ? ui.fmt.shortId(id) : id)];
          if (r.reqId) {
            out.push(' ');
            out.push(
              ui.h('button', { type: 'button', class: 'ag-link-btn ag-mono', title: t('aiagent.audit.trace'), onclick: function () {
                f.reqId.value = r.reqId;
                loadTrace(r.reqId, true);
              } }, r.reqId)
            );
          }
          return out;
        }
      },
      {
        key: 'reason',
        labelKey: 'aiagent.audit.col.reason',
        render: function (r) {
          return r.reason ? ui.h('span', { class: 'ag-clamp2', title: r.reason }, r.reason) : ui.h('span', { class: 'ag-muted' }, '—');
        }
      },
      { key: 'aiMeta', labelKey: 'aiagent.audit.col.aiMeta', render: aiMetaCell }
    ];

    function renderPager(n) {
      var c = ui.clear(parts.pager);
      c.appendChild(ui.h('span', { class: 'ag-pager-total' }, t('aiagent.audit.page', { page: v.page })));
      c.appendChild(ui.button({ labelKey: 'aiagent.common.prev', kind: 'plain', disabled: v.page <= 1, onClick: function () {
        search(v.page - 1, true);
      } }));
      c.appendChild(ui.button({ labelKey: 'aiagent.common.next', kind: 'plain', disabled: n < PAGE, onClick: function () {
        search(v.page + 1, true);
      } }));
    }

    function search(page, keepQuery) {
      ui.clear(f.msg);
      if (!keepQuery) {
        var q = { reqId: f.reqId.value.trim().toUpperCase(), actor: f.actor.value.trim(), from: f.from.value, to: f.to.value };
        if (q.from && q.to && q.from > q.to) {
          f.msg.textContent = t('aiagent.audit.invalidRange');
          return;
        }
        v.query = q;
        if (q.reqId) loadTrace(q.reqId, false);
        else hideTrace();
      }
      v.page = page;
      ui.loading(parts.tableBox);
      ui.clear(parts.pager);
      A.api.request('GET', '/audit', null, { query: Object.assign({ page: page, size: PAGE }, v.query) }).then(
        function (rows) {
          if (!alive) return;
          v.table = ui.table({ className: 'ag-table--compact ag-table--audit', columns: COLUMNS, rows: rows || [] });
          ui.clear(parts.tableBox).appendChild(v.table.el);
          renderPager((rows || []).length);
        },
        function (err) {
          if (alive)
            ui.errorCard(parts.tableBox, err, function () {
              search(v.page, true);
            });
        }
      );
    }

    // ── 전 경로 타임라인(API-603) ──
    function hideTrace() {
      v.traceReq = null;
      parts.trace.el.hidden = true;
      parts.split.classList.add('is-single');
    }

    function entryEl(e, isExec) {
      return ui.h('div', { class: 'ag-trace-entry' }, [
        ui.h('div', { class: 'ag-timeline-head' }, [
          ui.h('span', { class: 'ag-nowrap' }, ui.fmt.dt(e.at)),
          e.actor ? ui.h('span', { class: 'ag-muted' }, e.actor) : null,
          isExec && e.state ? ui.badge('EXEC_STATE', e.state) : null
        ]),
        e.ref ? ui.h('div', { class: 'ag-mono ag-trace-ref' }, e.ref) : null,
        e.summary ? ui.h('div', { class: 'ag-muted' }, e.summary) : null
      ]);
    }

    function renderTrace(reqId, tr) {
      var body = ui.clear(parts.trace.body);
      parts.trace.el.querySelector('h4').textContent = t('aiagent.audit.traceOf', { reqId: reqId });
      var ol = ui.h('ol', { class: 'ag-trace' });
      SECTIONS.forEach(function (sec) {
        var val = tr[sec];
        var list = Array.isArray(val) ? val : val ? [val] : [];
        var item = ui.h('li', { class: 'ag-timeline-item' + (list.length ? '' : ' is-empty') }, [ui.h('div', { class: 'ag-trace-title' }, t('aiagent.audit.trace.' + sec) + (Array.isArray(val) && val.length ? ' (' + val.length + ')' : ''))]);
        if (!list.length) item.appendChild(ui.h('div', { class: 'ag-muted' }, t('aiagent.audit.noRecord')));
        list.forEach(function (e) {
          item.appendChild(entryEl(e, sec === 'executions'));
        });
        ol.appendChild(item);
      });
      body.appendChild(ol);
    }

    function loadTrace(reqId, scroll) {
      v.traceReq = reqId;
      parts.trace.el.hidden = false;
      parts.split.classList.remove('is-single');
      parts.trace.el.querySelector('h4').textContent = t('aiagent.audit.traceOf', { reqId: reqId });
      ui.loading(parts.trace.body);
      if (scroll) parts.trace.el.scrollIntoView({ block: 'nearest' });
      A.api.request('GET', '/requirements/' + encodeURIComponent(reqId) + '/trace').then(
        function (tr) {
          if (alive && v.traceReq === reqId) renderTrace(reqId, tr);
        },
        function (err) {
          if (alive && v.traceReq === reqId)
            ui.errorCard(parts.trace.body, err, function () {
              loadTrace(reqId, false);
            });
        }
      );
    }

    return {
      mount: function (el, ctx) {
        alive = true;
        var p = ctx.params || {};
        parts.form = ui.widget('aiagent.audit.title');
        parts.results = ui.widget('aiagent.audit.results');
        parts.trace = ui.widget('aiagent.audit.trace');
        parts.tableBox = ui.h('div');
        parts.pager = ui.h('div', { class: 'ag-pager' });
        parts.form.body.appendChild(ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.audit.subtitle')]));
        parts.form.body.appendChild(buildForm(p));
        parts.form.body.appendChild(ui.h('p', { class: 'ag-hint' }, t('aiagent.audit.traceHint')));
        parts.results.body.appendChild(parts.tableBox);
        parts.results.body.appendChild(parts.pager);
        parts.trace.el.hidden = true;
        parts.split = ui.h('div', { class: 'ag-split ag-split--wide is-single' }, [parts.results.el, parts.trace.el]);
        el.appendChild(ui.h('div', { class: 'ag-view ag-view--audit' }, [parts.form.el, parts.split]));
        search(1);
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.audit = {
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
