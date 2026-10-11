/*
 * SCR-09 MAT 실행 모니터링 (10단계 · 좌측 메뉴 1) — REQ-F-016 · REQ-IF-002
 * API-501(작업 목록 폴링) · 502(작업 로그 tail). 조회 전용: 상태를 바꾸는 UI 없음(CON-01).
 * 이상 경고는 클라이언트 판정(실패 · 상태-로그 불일치 · 상태 불일치).
 * 부분 장애(AGT-EXT-001)는 표 · 로그 영역에만 오류 카드를 띄우고 폴링은 계속한다(복구 시 정상 표시).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var TAIL = 200;
  var TASK_TONE = { done: 'done', in_progress: 'normal', pending: 'muted' };
  var WORKER_TONE = { ERROR: 'crit', RETRY: 'warn', DONE: 'done', RUNNING: 'normal', WAITING: 'muted' };
  var WORKER_ICON = { ERROR: 'alert', RETRY: 'progress', DONE: 'check', RUNNING: 'progress', WAITING: 'circle' };

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  /** 이상 경고(설계서 SCR-09): [{kind:'failed'|'mismatch'|'inconsistent', tone, hint}] */
  function anomaliesOf(task) {
    var out = [];
    var ws = task.workers || [];
    ws.forEach(function (wk) {
      if (wk.state === 'ERROR') out.push({ kind: 'failed', tone: 'crit', hint: t('aiagent.monitor.anomaly.failedHint', { role: wk.role }) });
    });
    if (task.status === 'done') {
      ws.forEach(function (wk) {
        if (wk.state === 'RUNNING' || wk.state === 'WAITING') {
          out.push({ kind: 'mismatch', tone: 'warn', hint: t('aiagent.monitor.anomaly.mismatchHint', { role: wk.role, state: A.i18n.label('WORKER_STATE', wk.state) }) });
        }
      });
    }
    if (task.status === 'in_progress' && ws.length && ws.every(function (wk) {
      return wk.state === 'DONE';
    })) {
      out.push({ kind: 'inconsistent', tone: 'warn', hint: t('aiagent.monitor.anomaly.inconsistentHint') });
    }
    return out;
  }

  function create() {
    var ui = A.ui;
    var alive = false;
    var parts = {};
    var v = { tasks: [], selected: null, table: null };
    var lastUpdated = null;

    function renderUpdated() {
      lastUpdated.textContent = t('aiagent.common.lastUpdated', { time: ui.fmt.dt(new Date().toISOString()) });
    }

    // ── 작업 표 ──
    function columns() {
      return [
        {
          key: 'taskName',
          labelKey: 'aiagent.monitor.col.taskName',
          sortable: true,
          className: 'ag-nowrap',
          render: function (task) {
            return ui.h('button', { type: 'button', class: 'ag-link-btn ag-mono', 'aria-pressed': v.selected === task.taskName ? 'true' : 'false', onclick: function () {
              select(task.taskName, true);
            } }, task.taskName);
          }
        },
        {
          key: 'status',
          labelKey: 'aiagent.monitor.col.status',
          sortable: true,
          render: function (task) {
            return ui.badge('TASK_STATUS', task.status, { tone: TASK_TONE[task.status] || 'muted' });
          }
        },
        {
          key: 'goal',
          labelKey: 'aiagent.monitor.col.goal',
          sortable: true,
          render: function (task) {
            return ui.h('span', { class: 'ag-clamp2', title: task.goal || '' }, task.goal || '');
          }
        },
        {
          key: 'workers',
          labelKey: 'aiagent.monitor.col.workers',
          render: function (task) {
            return ui.h(
              'span',
              { class: 'ag-chips' },
              (task.workers || []).map(function (wk) {
                var label = A.i18n.label('WORKER_STATE', wk.state);
                return ui.h('span', { class: 'ag-badge ag-tone--' + (WORKER_TONE[wk.state] || 'muted'), title: wk.role + ' · ' + label }, [ui.icon(WORKER_ICON[wk.state] || 'circle'), wk.role + ' · ' + label]);
              })
            );
          }
        },
        {
          key: 'files',
          labelKey: 'aiagent.monitor.col.files',
          render: function (task) {
            return ui.h(
              'ul',
              { class: 'ag-plain-list ag-file-list' },
              (task.workers || []).map(function (wk) {
                return ui.h('li', { title: [wk.briefPath, wk.resultPath].filter(Boolean).join('\n') }, [
                  ui.h('span', { class: 'ag-mono ag-muted' }, wk.role),
                  ui.h('span', { class: wk.briefPath ? 'ag-chip' : 'ag-chip ag-chip--muted' }, [ui.icon('file'), t('aiagent.monitor.file.brief')]),
                  wk.resultPath
                    ? ui.h('span', { class: 'ag-chip ag-chip--done' }, [ui.icon('file'), t('aiagent.monitor.file.result') + ' ' + ui.fmt.bytes(wk.resultSize)])
                    : ui.h('span', { class: 'ag-chip ag-chip--muted' }, t('aiagent.monitor.file.none'))
                ]);
              })
            );
          }
        },
        {
          key: 'anomaly',
          labelKey: 'aiagent.monitor.anomaly.title',
          sortValue: function (task) {
            return anomaliesOf(task).length;
          },
          sortable: true,
          render: function (task) {
            var list = anomaliesOf(task);
            if (!list.length) return ui.h('span', { class: 'ag-muted' }, '—');
            return ui.h(
              'span',
              { class: 'ag-chips' },
              list.map(function (a) {
                return ui.h('span', { class: 'ag-badge ag-tone--' + a.tone, title: a.hint }, [ui.icon('alert'), t('aiagent.monitor.anomaly.' + a.kind)]);
              })
            );
          }
        }
      ];
    }

    function rowClass(task) {
      var list = anomaliesOf(task);
      var cls = [];
      if (list.some(function (a) {
        return a.tone === 'crit';
      }))
        cls.push('ag-row--crit');
      else if (list.length) cls.push('ag-row--warn');
      if (v.selected === task.taskName) cls.push('is-selected');
      return cls.join(' ') || null;
    }

    function renderTasks() {
      if (!v.table || !parts.tasks.body.contains(v.table.el)) {
        v.table = ui.table({
          className: 'ag-table--compact ag-table--monitor',
          columns: columns(),
          rows: v.tasks,
          rowClass: rowClass,
          onRowClick: function (task) {
            select(task.taskName, true);
          }
        });
        ui.clear(parts.tasks.body).appendChild(v.table.el);
      } else {
        v.table.setRows(v.tasks);
      }
    }

    function loadTasks() {
      return A.api.request('GET', '/monitor/tasks').then(
        function (tasks) {
          if (!alive) return;
          v.tasks = tasks || [];
          renderTasks();
          renderUpdated();
        },
        function (err) {
          if (!alive) return;
          v.table = null;
          ui.errorCard(parts.tasks.body, err, refresh);
        }
      );
    }

    // ── 로그 ──
    function lineEl(line) {
      var m = /^(\[[^\]]+\])\s*(\[([A-Z_]+)\])?(.*)$/.exec(line);
      if (!m) return ui.h('span', { class: 'ag-log-line' }, line + '\n');
      var tag = m[3] || '';
      var tone = tag === 'ERROR' ? 'crit' : tag === 'VERIFICATION' ? 'done' : tag === 'WORKER_CALL' || tag === 'WORKER_RESULT' ? 'normal' : '';
      return ui.h('span', { class: 'ag-log-line' + (tone ? ' ag-log-line--' + tone : '') }, [
        ui.h('span', { class: 'ag-log-time' }, m[1]),
        ' ',
        m[2] ? ui.h('span', { class: 'ag-log-tag' }, m[2]) : null,
        m[4] + '\n'
      ]);
    }

    function loadLog() {
      var name = v.selected;
      if (!name) return Promise.resolve();
      return A.api.request('GET', '/monitor/tasks/' + encodeURIComponent(name) + '/log', null, { query: { tail: TAIL } }).then(
        function (log) {
          if (!alive || v.selected !== name) return;
          var body = parts.log.body;
          var prev = body.querySelector('.ag-log');
          var atBottom = !prev || prev.scrollTop + prev.clientHeight >= prev.scrollHeight - 4;
          var keep = prev ? prev.scrollTop : 0;
          ui.clear(body);
          body.appendChild(ui.h('h5', { class: 'ag-subtitle ag-mono' }, name));
          if (log.truncated) body.appendChild(ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.monitor.truncated', { n: TAIL })]));
          if (!log.lines || !log.lines.length) {
            body.appendChild(ui.empty(t('aiagent.monitor.logEmpty')));
            return;
          }
          var pre = ui.h('pre', { class: 'ag-log', tabindex: '0', 'aria-label': t('aiagent.monitor.log') }, log.lines.map(lineEl));
          body.appendChild(pre);
          pre.scrollTop = atBottom ? pre.scrollHeight : keep;
        },
        function (err) {
          if (alive && v.selected === name) ui.errorCard(parts.log.body, err, loadLog);
        }
      );
    }

    function select(name, scroll) {
      v.selected = name;
      if (v.table) v.table.setRows(v.tasks); // 선택 표시 갱신
      ui.loading(parts.log.body);
      if (scroll) parts.log.el.scrollIntoView({ block: 'nearest' });
      loadLog();
    }

    function refresh() {
      return Promise.all([loadTasks(), loadLog()]);
    }

    return {
      mount: function (el, ctx) {
        alive = true;
        v.selected = (ctx.params && ctx.params.task) || null;
        lastUpdated = ui.h('span', { class: 'ag-muted' });
        parts.tasks = ui.widget('aiagent.monitor.tasks');
        parts.tasks.controls.appendChild(ui.h('span', { class: 'ag-muted' }, t('aiagent.common.refreshEvery', { sec: Math.max(A.config.pollSec.monitor, A.config.minPollSec) })));
        parts.tasks.controls.appendChild(lastUpdated);
        parts.log = ui.widget('aiagent.monitor.log');
        el.appendChild(
          ui.h('div', { class: 'ag-view ag-view--monitor' }, [
            ui.h('div', { class: 'ag-banner', role: 'note' }, [ui.icon('info'), ui.h('div', null, [ui.h('strong', null, t('aiagent.monitor.title')), ' — ', t('aiagent.monitor.subtitle')])]),
            parts.tasks.el,
            parts.log.el,
            ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.monitor.statsUnavailable')])
          ])
        );
        ui.loading(parts.tasks.body);
        if (v.selected) ui.loading(parts.log.body);
        else parts.log.body.appendChild(ui.empty(t('aiagent.monitor.logSelect')));
        refresh().then(function () {
          if (alive) A.poller.start(refresh, A.config.pollSec.monitor);
        });
      },
      unmount: function () {
        alive = false; // 폴러는 router 가 stopAll 로 정지
      }
    };
  }

  A.views.monitor = {
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
