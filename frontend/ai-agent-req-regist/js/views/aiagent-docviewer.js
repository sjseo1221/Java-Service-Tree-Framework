/*
 * SCR-06 문서 뷰어 (4 · 5 · 6단계, SRS · SDS 공용) — REQ-F-007 ~ F-010 · NF-001
 * API-301 · 302(생성 job) · 303 · 304(PDF, mock: /__docs/ 원본) · 305 · 306 · 307 · 207 · 601 · 104
 * PDF 는 브라우저 내장 뷰어(iframe)로 연다 — 목차 · 확대/축소 · 검색은 내장 기능(외부 라이브러리 없음, 설계서 I-10).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var STAGE = { SRS: { gen: 4, confirm: 5, code: 'SRS_CONFIRM', path: 'srs' }, SDS: { gen: 6, confirm: 6, code: 'SDS_CONFIRM', path: 'sds' } };
  var runningJob = {}; // sid|type → jobId

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var ctx = null;
    var alive = false;
    var parts = {};
    var type = 'SRS';
    var st = STAGE.SRS;
    var v = { list: [], selected: null, job: null };

    function stageStatus(no) {
      var s = ctx.stages && ctx.stages[no - 1];
      return s ? s.status : 'LOCKED';
    }

    function confirmedStage() {
      return stageStatus(st.confirm) === 'COMPLETED';
    }

    function current() {
      return v.list.filter(function (a) {
        return a.artifactId === v.selected;
      })[0];
    }

    function load(selectId) {
      ui.loading(parts.doc.body);
      return A.api.request('GET', '/sessions/' + ctx.sid + '/artifacts', null, { query: { type: type } }).then(
        function (list) {
          if (!alive) return;
          v.list = list; // version 내림차순
          var keep = selectId || v.selected;
          v.selected = list.some(function (a) {
            return a.artifactId === keep;
          })
            ? keep
            : list[0] && list[0].artifactId;
          render();
        },
        function (err) {
          if (alive) ui.errorCard(parts.doc.body, err, load);
        }
      );
    }

    // ── 툴바 ──
    function render() {
      renderControls();
      var body = ui.clear(parts.doc.body);
      body.appendChild(parts.progress);
      body.appendChild(parts.msg);
      renderProgress();
      var a = current();
      if (!a) {
        body.appendChild(ui.h('div', { class: 'ag-empty ag-empty--lg' }, [ui.h('p', null, t('aiagent.doc.empty')), generateButton()]));
        return;
      }

      var status = a.confirmed ? ['done', 'aiagent.doc.confirmed'] : a.rejected ? ['muted', 'aiagent.doc.rejected'] : ['warn', 'aiagent.doc.unconfirmed'];
      var meta = [ui.badge(null, null, { tone: status[0], text: t(status[1]) })];
      if (a.markedForReconfirm) meta.push(ui.badge(null, null, { tone: 'warn', text: t('aiagent.doc.reconfirm') }));
      if (a.confirmed) meta.push(ui.h('span', { class: 'ag-muted' }, t('aiagent.doc.confirmedBy', { who: a.confirmedBy || '', at: ui.fmt.dt(a.confirmedAt) })));
      if (a.checksum) meta.push(ui.h('span', { class: 'ag-muted', title: a.checksum }, [t('aiagent.doc.checksum') + ' ', ui.h('code', { class: 'ag-mono' }, a.checksum.slice(0, 12))]));
      if (a.rejected && a.rejectReason) meta.push(ui.h('span', { class: 'ag-muted' }, t('aiagent.common.reason') + ': ' + a.rejectReason));
      body.appendChild(ui.h('div', { class: 'ag-badge-row' }, meta));

      var pdf = A.api.url('/artifacts/' + encodeURIComponent(a.artifactId) + '/pdf');
      var busy = !!v.job;
      var actions = [generateButton()];
      if (!a.confirmed && !a.rejected) {
        actions.push(ui.button({ labelKey: 'aiagent.doc.confirm', kind: 'green', icon: 'check', disabled: busy, title: busy ? t('aiagent.doc.generating', { p: v.job.progress }) : null, onClick: confirmDoc }));
        actions.push(ui.button({ labelKey: 'aiagent.doc.reject', kind: 'red', disabled: busy, onClick: rejectDoc }));
      }
      actions.push(ui.h('a', { class: 'ag-btn ag-btn--plain', href: pdf, download: '' }, [ui.icon('download'), t('aiagent.common.download')]));
      if (confirmedStage()) actions.push(ui.button({ labelKey: 'aiagent.doc.release', kind: 'red', onClick: release }));
      body.appendChild(ui.h('div', { class: 'ag-actions' }, actions));

      body.appendChild(
        ui.h('iframe', {
          class: 'ag-pdf',
          src: pdf + '#toolbar=1&navpanes=1',
          title: t('aiagent.doc.title.' + type) + ' · ' + t('aiagent.doc.version', { v: a.version })
        })
      );
      body.appendChild(ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.doc.viewerFallback')]));
    }

    function renderControls() {
      var c = ui.clear(parts.doc.controls);
      if (!v.list.length) return;
      var sel = ui.h('select', { class: 'ag-input ag-input--sm', id: 'ag_doc_ver' });
      v.list.forEach(function (a) {
        var label = t('aiagent.doc.version', { v: a.version }) + (a.confirmed ? ' · ' + t('aiagent.doc.confirmed') : a.rejected ? ' · ' + t('aiagent.doc.rejected') : '');
        sel.appendChild(ui.h('option', { value: a.artifactId }, label));
      });
      sel.value = v.selected;
      sel.addEventListener('change', function () {
        v.selected = sel.value;
        render(); // iframe src 교체
      });
      c.appendChild(ui.h('label', { for: 'ag_doc_ver', class: 'ag-label ag-label--inline' }, t('aiagent.doc.versionLabel')));
      c.appendChild(sel);
    }

    function generateButton() {
      var hasAny = v.list.length > 0;
      var why = confirmedStage() ? t('aiagent.common.readonly') : v.job ? t('aiagent.doc.generating', { p: v.job.progress }) : null;
      return ui.button({
        labelKey: hasAny ? 'aiagent.doc.regenerate' : 'aiagent.doc.generate',
        kind: 'blue',
        icon: 'doc-gen',
        disabled: !!why,
        title: why,
        onClick: generate
      });
    }

    function renderProgress() {
      var box = ui.clear(parts.progress);
      if (!v.job) return;
      var p = v.job.progress || 0;
      box.appendChild(
        ui.h('div', { class: 'ag-progress-row' }, [
          ui.h('div', { class: 'ag-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p), 'aria-label': t('aiagent.doc.generating', { p: p }) }, [
            ui.h('div', { class: 'ag-progress-bar', style: 'width:' + p + '%' })
          ]),
          ui.h('span', { class: 'ag-muted' }, t('aiagent.doc.generating', { p: p }))
        ])
      );
    }

    // ── 생성(API-301/302 → API-601) ──
    function generate() {
      ui.clear(parts.msg);
      A.api.request('POST', '/sessions/' + ctx.sid + '/' + st.path).then(
        function (res) {
          A.flow.reload();
          watch(res.jobId);
        },
        function (err) {
          if (alive) ui.errorCard(parts.msg, err);
        }
      );
    }

    function watch(jobId) {
      var key = ctx.sid + '|' + type;
      runningJob[key] = jobId;
      v.job = { progress: 0 };
      render();
      A.poller
        .watchJob(jobId, function (j) {
          if (!alive || !v.job) return;
          v.job.progress = j.progress;
          renderProgress();
        })
        .promise.then(
          function () {
            delete runningJob[key];
            if (!alive) return;
            ui.toast('success', t('aiagent.doc.generated', { type: t('aiagent.doc.title.' + type) }));
            A.flow.reload().then(function () {
              A.router.go(type === 'SRS' ? '#/stage/5' : '#/stage/6'); // SRS 생성 완료 → 5단계(확정)
            });
          },
          function (err) {
            delete runningJob[key];
            if (!alive) return;
            v.job = null;
            render();
            ui.errorCard(parts.msg, err);
          }
        );
    }

    // ── 확정(API-305) · 반려(API-306) · 확정 해제(API-207) ──
    function confirmDoc() {
      var a = current();
      ui.clear(parts.msg);
      ui.modal({
        titleKey: 'aiagent.doc.confirm',
        body: [ui.h('p', null, t('aiagent.doc.title.' + type) + ' · ' + t('aiagent.doc.version', { v: a.version })), ui.h('p', { class: 'ag-text-warn' }, t('aiagent.doc.confirmAsk'))],
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.doc.confirm',
            kind: 'green',
            onClick: function (m) {
              m.setDisabled(1, true);
              A.api
                .request('POST', '/artifacts/' + encodeURIComponent(a.artifactId) + '/confirm')
                .then(function (res) {
                  m.close('ok');
                  ui.toast('success', t('aiagent.doc.confirmedToast', { checksum: String(res.checksum || '').slice(0, 12) }));
                  return A.flow.reload().then(function () {
                    A.router.go(type === 'SRS' ? '#/stage/6' : '#/stage/7');
                  });
                })
                .catch(function (err) {
                  m.close('error');
                  if (alive) ui.errorCard(parts.msg, err);
                });
            }
          }
        ]
      });
    }

    function rejectDoc() {
      var a = current();
      ui.clear(parts.msg);
      ui.reasonPrompt({ titleKey: 'aiagent.doc.reject' }).then(function (reason) {
        if (reason == null) return;
        A.api.request('POST', '/artifacts/' + encodeURIComponent(a.artifactId) + '/reject', { reason: reason }).then(
          function () {
            ui.toast('success', t('aiagent.doc.rejectedToast'));
            A.flow.reload().then(function () {
              A.router.go('#/stage/' + st.gen); // 재생성 단계로 복귀
            });
          },
          function (err) {
            if (alive) ui.errorCard(parts.msg, err);
          }
        );
      });
    }

    function release() {
      ui.releaseStage({ sid: ctx.sid, stage: st.code, titleKey: 'aiagent.doc.release' }).then(function (res) {
        if (res) A.router.go('#/stage/' + st.confirm);
      });
    }

    // ── 추적 매트릭스(API-307) ──
    function loadTrace() {
      var body = parts.traceBody;
      ui.loading(body);
      var rev = ctx.session && ctx.session.latestRevision;
      Promise.all([
        A.api.request('GET', '/sessions/' + ctx.sid + '/traceability', null, { query: { from: 'REQ', to: type } }),
        rev ? A.api.request('GET', '/sessions/' + ctx.sid + '/uploads/' + rev + '/preview', null, { query: { page: 1, size: A.config.upload.maxRows } }) : { rows: [] }
      ]).then(
        function (r) {
          if (!alive) return;
          var map = {};
          r[0].forEach(function (x) {
            map[x.sourceId] = x.targetIds || [];
          });
          var rows = r[1].rows
            .filter(function (x) {
              return x.reqId;
            })
            .map(function (x) {
              return { sourceId: x.reqId, name: x.name, targetIds: map[x.reqId] || [] };
            });
          var linked = rows.filter(function (x) {
            return x.targetIds.length;
          }).length;
          ui.clear(body);
          parts.traceCount.textContent = t('aiagent.doc.traceLinked', { n: linked, total: rows.length });
          parts.traceCount.className = 'ag-badge ag-tone--' + (linked === rows.length && rows.length ? 'done' : 'crit');
          body.appendChild(
            ui.table({
              className: 'ag-table--compact',
              columns: [
                { key: 'sourceId', labelKey: 'aiagent.upload.col.reqId', sortable: true, className: 'ag-nowrap' },
                { key: 'name', labelKey: 'aiagent.upload.col.name', sortable: true },
                {
                  key: 'targetIds',
                  label: t('aiagent.doc.traceTargets', { type: type }),
                  sortValue: function (x) {
                    return x.targetIds.length;
                  },
                  sortable: true,
                  render: function (x) {
                    if (!x.targetIds.length) return ui.h('span', { class: 'ag-text-crit' }, t('aiagent.doc.traceUnlinked'));
                    return ui.h(
                      'span',
                      { class: 'ag-chips' },
                      x.targetIds.map(function (id) {
                        return ui.h('span', { class: 'ag-chip' }, id);
                      })
                    );
                  }
                }
              ],
              rows: rows,
              rowClass: function (x) {
                return x.targetIds.length ? null : 'ag-row--crit';
              }
            }).el
          );
        },
        function (err) {
          if (alive) ui.errorCard(body, err, loadTrace);
        }
      );
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        type = ctx.params.type === 'SDS' ? 'SDS' : 'SRS';
        st = STAGE[type];
        parts.doc = ui.widget('aiagent.doc.title.' + type, { className: 'ag-widget--doc' });
        parts.traceBody = ui.h('div', { class: 'ag-details-body' });
        parts.progress = ui.h('div');
        parts.msg = ui.h('div', { class: 'ag-msg', 'aria-live': 'polite' });
        parts.traceCount = ui.h('span', { class: 'ag-badge ag-tone--muted' });

        // 추적 매트릭스: 접이식(focus=generate 이면 펼침)
        var details = ui.h('details', { class: 'ag-details', open: ctx.params.focus === 'generate' }, [
          ui.h('summary', null, [ui.h('span', { class: 'ag-details-title' }, t('aiagent.doc.trace') + ' (REQ → ' + type + ')'), parts.traceCount]),
          parts.traceBody
        ]);

        el.appendChild(ui.h('div', { class: 'ag-view ag-view--doc' }, [parts.doc.el, ui.h('section', { class: 'aiagent-widget' }, ui.h('div', { class: 'body' }, details))]));
        loadTrace(); // 접힌 상태에서도 요약(연결 n/total)은 보여 준다
        load().then(function () {
          if (alive && runningJob[ctx.sid + '|' + type]) watch(runningJob[ctx.sid + '|' + type]);
        });
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.docviewer = {
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
