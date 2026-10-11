/*
 * SCR-04 등록 결과 · 변경분 (2단계) — REQ-F-003 · F-004
 * G2(등록 결과 재조회) · API-109(diff) · API-110(이력) · API-104(요구사항명 조회용)
 * 건별 반영 선택(F-004.2)은 API 가 없어 읽기 전용 안내만 둔다(설계서 I-07).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var ctx = null;
    var alive = false;
    var parts = {};
    var revisions = [];
    var v = { rev: null, tab: 'added' };

    function revisionList(session) {
      if (!session) return [];
      if (Array.isArray(session.revisions)) return session.revisions.slice();
      var list = [];
      for (var i = 1; i <= (session.latestRevision || 0); i++) list.push(i);
      return list;
    }

    function prevRevOf(rev) {
      var i = revisions.indexOf(rev);
      return i > 0 ? revisions[i - 1] : null;
    }

    function colLabel(column) {
      return A.i18n.has('aiagent.upload.col.' + column) ? t('aiagent.upload.col.' + column) : column;
    }

    function stat(labelKey, value, tone) {
      return ui.h('div', { class: 'ag-stat ag-tone--' + (tone || 'normal') }, [ui.h('div', { class: 'ag-stat-value' }, String(value)), ui.h('div', { class: 'ag-stat-label' }, t(labelKey))]);
    }

    function reqLink(reqId) {
      return ui.h(
        'button',
        {
          type: 'button',
          class: 'ag-link-btn',
          title: t('aiagent.register.history'),
          onclick: function () {
            openHistory(reqId);
          }
        },
        reqId
      );
    }

    // ── 이력 드로어(API-110) ──
    function openHistory(reqId) {
      ui.modal({
        title: t('aiagent.register.history') + ' · ' + reqId,
        className: 'ag-modal--drawer',
        body: function (el) {
          ui.loading(el);
          A.api.request('GET', '/requirements/' + encodeURIComponent(reqId) + '/history').then(
            function (list) {
              ui.clear(el);
              if (!list || !list.length) {
                el.appendChild(ui.empty());
                return;
              }
              list
                .slice()
                .sort(function (a, b) {
                  return String(a.changedAt).localeCompare(String(b.changedAt));
                })
                .forEach(function (hItem) {
                  el.appendChild(
                    ui.h('div', { class: 'ag-timeline-item' }, [
                      ui.h('div', { class: 'ag-timeline-head' }, [
                        ui.badge(null, null, { tone: 'normal', text: t('aiagent.upload.revision', { rev: hItem.revision }) }),
                        ui.h('span', { class: 'ag-muted' }, ui.fmt.dt(hItem.changedAt)),
                        ui.h('strong', null, colLabel(hItem.column))
                      ]),
                      ui.h('div', { class: 'ag-diff' }, [ui.h('del', null, hItem.before == null ? '' : String(hItem.before)), ui.h('ins', null, hItem.after == null ? '' : String(hItem.after))])
                    ])
                  );
                });
            },
            function (err) {
              ui.errorCard(el, err);
            }
          );
        }
      });
    }

    // ── 요약 ──
    function renderSummary(res) {
      var body = ui.clear(parts.summary.body);
      body.appendChild(
        ui.h('div', { class: 'ag-stat-row' }, [
          stat('aiagent.register.registered', res.registered, 'done'),
          stat('aiagent.register.treeNodes', res.treeNodesCreated, 'normal'),
          stat('aiagent.register.warnings', (res.warnings || []).length, (res.warnings || []).length ? 'warn' : 'done')
        ])
      );
      if ((res.warnings || []).length) {
        body.appendChild(
          ui.table({
            columns: [
              { key: 'rowNo', labelKey: 'aiagent.upload.report.col.row', sortable: true },
              {
                key: 'column',
                labelKey: 'aiagent.upload.report.col.column',
                render: function (r) {
                  return colLabel(r.column);
                }
              },
              { key: 'code', labelKey: 'aiagent.upload.report.col.code', className: 'ag-mono' },
              { key: 'message', labelKey: 'aiagent.upload.report.col.message' }
            ],
            rows: res.warnings
          }).el
        );
      }
    }

    // ── 변경분 ──
    function renderDiff(diff, names) {
      var body = ui.clear(parts.diff.body);
      var changedIds = {};
      (diff.changed || []).forEach(function (c) {
        changedIds[c.reqId] = true;
      });
      var changedCount = Object.keys(changedIds).length;

      var laterConfirmed = (ctx.stages || []).some(function (s, i) {
        return i >= 4 && s.status === 'COMPLETED';
      });
      if (changedCount > 0 && laterConfirmed) {
        body.appendChild(ui.h('div', { class: 'ag-banner ag-banner--warn', role: 'note' }, [ui.icon('alert'), t('aiagent.register.reconfirmWarn')]));
      }

      body.appendChild(
        ui.h('div', { class: 'ag-stat-row' }, [
          stat('aiagent.register.added', (diff.added || []).length, 'normal'),
          stat('aiagent.register.changed', changedCount, 'warn'),
          stat('aiagent.register.retired', (diff.retired || []).length, 'muted'),
          stat('aiagent.register.unchanged', diff.unchanged || 0, 'done')
        ])
      );

      var tabs = [
        { id: 'added', labelKey: 'aiagent.register.added', count: (diff.added || []).length },
        { id: 'changed', labelKey: 'aiagent.register.changed', count: (diff.changed || []).length },
        { id: 'retired', labelKey: 'aiagent.register.retired', count: (diff.retired || []).length }
      ];
      var tabList = ui.h('div', { class: 'ag-tabs', role: 'tablist' });
      var panel = ui.h('div', { class: 'ag-tab-panel', role: 'tabpanel', id: 'ag_reg_tabpanel' });

      function nameCell(id) {
        return names[id] || '';
      }

      function showTab(id) {
        v.tab = id;
        Array.prototype.forEach.call(tabList.children, function (b) {
          var on = b.getAttribute('data-tab') === id;
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
        });
        ui.clear(panel);
        var tbl;
        if (id === 'changed') {
          tbl = ui.table({
            columns: [
              {
                key: 'reqId',
                labelKey: 'aiagent.register.col.reqId',
                sortable: true,
                render: function (r) {
                  return reqLink(r.reqId);
                }
              },
              {
                key: 'column',
                labelKey: 'aiagent.register.col.column',
                sortable: true,
                render: function (r) {
                  return colLabel(r.column);
                }
              },
              {
                key: 'before',
                labelKey: 'aiagent.register.col.before',
                render: function (r) {
                  return ui.h('del', { class: 'ag-pre-line' }, r.before == null ? '' : String(r.before));
                }
              },
              {
                key: 'after',
                labelKey: 'aiagent.register.col.after',
                render: function (r) {
                  return ui.h('ins', { class: 'ag-pre-line' }, r.after == null ? '' : String(r.after));
                }
              }
            ],
            rows: diff.changed || []
          });
        } else {
          var ids = (id === 'added' ? diff.added : diff.retired) || [];
          tbl = ui.table({
            columns: [
              {
                key: 'reqId',
                labelKey: 'aiagent.register.col.reqId',
                sortable: true,
                render: function (r) {
                  return reqLink(r.reqId);
                }
              },
              { key: 'name', labelKey: 'aiagent.upload.col.name' },
              {
                key: 'mark',
                labelKey: 'aiagent.upload.col.status',
                render: function () {
                  return id === 'retired'
                    ? ui.badge(null, null, { tone: 'muted', text: t('aiagent.register.retired') })
                    : ui.badge(null, null, { tone: 'normal', text: t('aiagent.register.added') });
                }
              }
            ],
            rows: ids.map(function (x) {
              return { reqId: x, name: nameCell(x) };
            })
          });
        }
        panel.appendChild(tbl.el);
      }

      tabs.forEach(function (tb) {
        var b = ui.h(
          'button',
          {
            type: 'button',
            class: 'ag-tab',
            role: 'tab',
            'aria-controls': 'ag_reg_tabpanel',
            'data-tab': tb.id,
            onclick: function () {
              showTab(tb.id);
            }
          },
          [t(tb.labelKey), ui.h('span', { class: 'ag-tab-count' }, String(tb.count))]
        );
        tabList.appendChild(b);
      });
      tabList.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = tabs
          .map(function (x) {
            return x.id;
          })
          .indexOf(v.tab);
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
        showTab(next);
        tabList.querySelector('[data-tab="' + next + '"]').focus();
      });

      body.appendChild(tabList);
      body.appendChild(panel);
      showTab(v.tab);
    }

    function namesOf(rev) {
      if (!rev) return Promise.resolve({});
      return A.api
        .request('GET', '/sessions/' + ctx.sid + '/uploads/' + rev + '/preview', null, { query: { page: 1, size: A.config.upload.maxRows } })
        .then(function (res) {
          var map = {};
          res.rows.forEach(function (r) {
            if (r.reqId) map[r.reqId] = r.name;
          });
          return map;
        });
    }

    function load(rev) {
      v.rev = rev;
      var basePath = '/sessions/' + ctx.sid + '/uploads/' + rev;
      var prev = prevRevOf(rev);
      ui.loading(parts.summary.body);
      ui.loading(parts.diff.body);

      A.api.request('GET', basePath + '/register').then(
        function (res) {
          if (alive && v.rev === rev) renderSummary(res);
        },
        function (err) {
          if (alive && v.rev === rev)
            ui.errorCard(parts.summary.body, err, function () {
              load(rev);
            });
        }
      );

      if (!prev) {
        ui.clear(parts.diff.body).appendChild(ui.empty(t('aiagent.register.noDiff')));
        return;
      }
      A.api
        .request('GET', basePath + '/diff')
        .then(function (diff) {
          if (!diff) return null;
          return Promise.all([namesOf(rev), (diff.retired || []).length ? namesOf(prev) : {}]).then(function (r) {
            return { diff: diff, names: Object.assign({}, r[1], r[0]) };
          });
        })
        .then(
          function (res) {
            if (!alive || v.rev !== rev) return;
            if (!res) ui.clear(parts.diff.body).appendChild(ui.empty(t('aiagent.register.noDiff')));
            else renderDiff(res.diff, res.names);
          },
          function (err) {
            if (alive && v.rev === rev)
              ui.errorCard(parts.diff.body, err, function () {
                load(rev);
              });
          }
        );
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        revisions = revisionList(ctx.session);
        var root = ui.h('div', { class: 'ag-view ag-view--register' });
        el.appendChild(root);

        if (!revisions.length) {
          root.appendChild(ui.empty(t('aiagent.register.noRevision')));
          return;
        }

        parts.summary = ui.widget('aiagent.register.title');
        parts.diff = ui.widget('aiagent.register.diff');

        var sel = ui.h('select', { class: 'ag-input ag-input--sm', id: 'ag_reg_rev' });
        revisions.forEach(function (r) {
          sel.appendChild(ui.h('option', { value: String(r) }, t('aiagent.upload.revision', { rev: r })));
        });
        var initial = Number(ctx.params.rev) || revisions[revisions.length - 1];
        if (revisions.indexOf(initial) < 0) initial = revisions[revisions.length - 1];
        sel.value = String(initial);
        sel.addEventListener('change', function () {
          load(Number(sel.value));
        });
        parts.summary.controls.appendChild(ui.h('label', { for: 'ag_reg_rev', class: 'ag-label ag-label--inline' }, t('aiagent.register.revision')));
        parts.summary.controls.appendChild(sel);

        root.appendChild(parts.summary.el);
        root.appendChild(parts.diff.el);
        root.appendChild(ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.register.applyUnsupported')]));
        load(initial);
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.register = {
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
