/*
 * SCR-03 업로드 · 미리보기 (1단계) — REQ-F-001 · F-002
 * API-101 · 103 · 104 · 105 · 106 · 107(mock: 클라이언트 CSV, 설계서 I-08) · 108 · G4
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var COLUMNS = ['rowNo', 'reqId', 'l1', 'l2', 'l3', 'name', 'detail', 'requester', 'accept', 'priority', 'owner', 'status', 'note'];
  var lastUpload = {}; // sid → 최근 업로드 응답(재마운트 시 유지, 새로고침 시 초기화)

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var ctx = null;
    var v = {}; // view 로컬 상태: rev, page, total, validation
    var parts = {};
    var alive = false;

    function base() {
      return '/sessions/' + ctx.sid + '/uploads/' + v.rev;
    }

    // ── 영역 A: 세션 정보 ──
    function renderSession() {
      var body = ui.clear(parts.session.body);
      var s = ctx.session;
      A.api.request('GET', '/products').then(
        function (products) {
          if (!alive) return;
          var productSel = ui.h('select', { class: 'ag-input', id: 'ag_up_product', disabled: !!s });
          var versionSel = ui.h('select', { class: 'ag-input', id: 'ag_up_version', disabled: !!s });
          function fillVersions() {
            var p = products.filter(function (x) {
              return String(x.pdServiceId) === productSel.value;
            })[0];
            ui.clear(versionSel);
            (p ? p.versions : []).forEach(function (ver) {
              versionSel.appendChild(ui.h('option', { value: ver }, ver));
            });
          }
          products.forEach(function (p) {
            productSel.appendChild(ui.h('option', { value: String(p.pdServiceId) }, p.name));
          });
          if (s) productSel.value = String(s.pdServiceId);
          fillVersions();
          if (s) versionSel.value = s.targetVersion;
          productSel.addEventListener('change', fillVersions);
          body.appendChild(
            ui.h('div', { class: 'ag-form-row' }, [
              ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_up_product', class: 'ag-label' }, t('aiagent.app.product')), productSel]),
              ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_up_version', class: 'ag-label' }, t('aiagent.app.version')), versionSel]),
              ui.h('div', { class: 'ag-field ag-field--action' }, [
                ui.button({
                  labelKey: 'aiagent.upload.newSession',
                  kind: 'blue',
                  icon: 'plus',
                  onClick: function () {
                    openNewSession(products);
                  }
                })
              ])
            ])
          );
        },
        function (err) {
          if (alive) ui.errorCard(body, err, renderSession);
        }
      );
    }

    function openNewSession(products) {
      var productSel = ui.h('select', { class: 'ag-input', id: 'ag_ns_product' });
      var versionSel = ui.h('select', { class: 'ag-input', id: 'ag_ns_version' });
      var errBox = ui.h('div');
      products.forEach(function (p) {
        productSel.appendChild(ui.h('option', { value: String(p.pdServiceId) }, p.name));
      });
      function fillVersions() {
        var p = products.filter(function (x) {
          return String(x.pdServiceId) === productSel.value;
        })[0];
        ui.clear(versionSel);
        (p ? p.versions : []).forEach(function (ver) {
          versionSel.appendChild(ui.h('option', { value: ver }, ver));
        });
      }
      productSel.addEventListener('change', fillVersions);
      fillVersions();
      ui.modal({
        titleKey: 'aiagent.upload.newSession',
        body: [
          ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_ns_product', class: 'ag-label' }, t('aiagent.app.product')), productSel]),
          ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_ns_version', class: 'ag-label' }, t('aiagent.app.version')), versionSel]),
          errBox
        ],
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.upload.newSession',
            kind: 'blue',
            onClick: function (m) {
              m.setDisabled(1, true);
              A.api
                .request('POST', '/sessions', { pdServiceId: Number(productSel.value), targetVersion: versionSel.value })
                .then(function (res) {
                  m.close('ok');
                  return A.app.setSid(res.sessionId).then(function () {
                    ui.toast('success', t('aiagent.upload.sessionCreated', { sid: res.sessionId }));
                    A.router.go('#/stage/1');
                  });
                })
                .catch(function (err) {
                  m.setDisabled(1, false);
                  ui.errorCard(errBox, err);
                });
            }
          }
        ]
      });
    }

    // ── 영역 B: 업로드 ──
    function hasLaterConfirmed() {
      return (ctx.stages || []).some(function (s, i) {
        return i >= 1 && s.status === 'COMPLETED';
      });
    }

    function renderUpload() {
      var body = ui.clear(parts.upload.body);
      var input = ui.h('input', { type: 'file', accept: '.xlsx', class: 'ag-visually-hidden', id: 'ag_up_file', tabindex: '-1' });
      var zone = ui.h('div', { class: 'ag-dropzone', role: 'button', tabindex: '0', 'aria-describedby': 'ag_up_limit' }, [
        ui.icon('upload', 'ag-ico--lg'),
        ui.h('p', { class: 'ag-dropzone-text' }, t('aiagent.upload.drop')),
        ui.h('p', { class: 'ag-hint', id: 'ag_up_limit' }, t('aiagent.upload.limit')),
        ui.button({
          labelKey: 'aiagent.upload.choose',
          kind: 'blue',
          onClick: function (e) {
            e.stopPropagation();
            input.click();
          }
        })
      ]);
      parts.uploadMsg = ui.h('div', { class: 'ag-upload-msg', 'aria-live': 'polite' });
      parts.summary = ui.h('div', { class: 'ag-upload-summary' });

      zone.addEventListener('click', function () {
        input.click();
      });
      zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
      ['dragenter', 'dragover'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) {
          e.preventDefault();
          zone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) {
          e.preventDefault();
          zone.classList.remove('is-dragover');
        });
      });
      zone.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) upload(f);
      });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) upload(input.files[0]);
        input.value = '';
      });

      if (hasLaterConfirmed()) body.appendChild(ui.h('div', { class: 'ag-banner ag-banner--warn', role: 'note' }, [ui.icon('alert'), t('aiagent.upload.reconfirmWarn')]));
      body.appendChild(zone);
      body.appendChild(input);
      body.appendChild(parts.uploadMsg);
      body.appendChild(parts.summary);
    }

    function upload(file) {
      var msg = ui.clear(parts.uploadMsg);
      var cfg = A.config.upload;
      if (file.name.toLowerCase().slice(-cfg.ext.length) !== cfg.ext) {
        msg.appendChild(ui.h('p', { class: 'ag-text-crit' }, t('aiagent.upload.badExt')));
        return;
      }
      if (file.size > cfg.maxBytes) {
        msg.appendChild(ui.h('p', { class: 'ag-text-crit' }, t('aiagent.upload.tooLarge')));
        return;
      }
      var fd = new FormData();
      fd.append('file', file);
      ui.loading(msg);
      A.api.request('POST', '/sessions/' + ctx.sid + '/uploads', fd).then(
        function (res) {
          if (!alive) return;
          ui.clear(msg);
          lastUpload[ctx.sid] = { revision: res.revision, fileName: file.name };
          ui.toast('success', file.name + ' · ' + t('aiagent.upload.revision', { rev: res.revision }));
          A.flow.reload();
          openRev(res.revision);
        },
        function (err) {
          if (alive) ui.errorCard(msg, err);
        }
      );
    }

    function renderSummary() {
      var box = ui.clear(parts.summary);
      if (!v.rev || !v.validation) return;
      var ec = v.validation.errorCount;
      var wc = v.validation.warningCount;
      var file = lastUpload[ctx.sid] && lastUpload[ctx.sid].revision === v.rev ? lastUpload[ctx.sid].fileName : null;
      var registerBtn = ui.button({
        labelKey: 'aiagent.upload.register',
        kind: 'green',
        icon: 'check',
        disabled: ec > 0,
        title: ec > 0 ? t('aiagent.upload.registerBlocked') : null,
        onClick: confirmRegister
      });
      parts.registerErr = ui.h('div', { class: 'ag-register-err' });
      box.appendChild(
        ui.h('div', { class: 'ag-badge-row' }, [
          file ? ui.h('span', { class: 'ag-file-name' }, [ui.icon('file'), file]) : null,
          ui.badge(null, null, { tone: 'normal', text: t('aiagent.upload.revision', { rev: v.rev }) }),
          ui.badge(null, null, { tone: 'muted', text: t('aiagent.upload.rows', { n: v.total }) }),
          ui.badge(null, null, { tone: ec > 0 ? 'crit' : 'done', text: t('aiagent.upload.errors', { n: ec }) }),
          ui.badge(null, null, { tone: wc > 0 ? 'warn' : 'done', text: t('aiagent.upload.warnings', { n: wc }) })
        ])
      );
      box.appendChild(
        ui.h('div', { class: 'ag-actions' }, [
          ui.h('a', { class: 'ag-btn ag-btn--plain', href: A.api.url(base() + '/file'), download: '' }, [ui.icon('download'), t('aiagent.upload.original')]),
          registerBtn,
          ec > 0 ? ui.h('span', { class: 'ag-hint ag-text-crit' }, t('aiagent.upload.registerBlocked')) : null
        ])
      );
      box.appendChild(parts.registerErr);
    }

    function confirmRegister() {
      var n = v.registrable;
      ui.modal({
        titleKey: 'aiagent.upload.register',
        body: ui.h('p', null, t('aiagent.upload.registerConfirm', { n: n })),
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.upload.register',
            kind: 'green',
            onClick: function (m) {
              m.setDisabled(1, true);
              ui.clear(parts.registerErr);
              A.api
                .request('POST', base() + '/register', { confirm: true })
                .then(function (res) {
                  m.close('ok');
                  ui.toast('success', t('aiagent.upload.registerDone', { n: res.registered }));
                  return A.app.reloadSession().then(A.flow.reload).then(function () {
                    A.router.go('#/stage/2');
                  });
                })
                .catch(function (err) {
                  m.close('error');
                  if (alive) ui.errorCard(parts.registerErr, err); // AGT-GATE-002: 오류 건수 · 첫 오류 위치(details)
                });
            }
          }
        ]
      });
    }

    // ── 영역 C: 미리보기 ──
    function issueClass(issues) {
      if (!issues.length) return '';
      return issues.some(function (x) {
        return x.severity === 'ERROR';
      })
        ? 'ag-cell--error'
        : 'ag-cell--warn';
    }

    function sevBadge(sev, title) {
      return ui.badge(null, sev, { tone: sev === 'ERROR' ? 'crit' : 'warn', text: t('aiagent.upload.sev.' + sev), title: title });
    }

    function showDetail(row) {
      ui.modal({
        title: row.reqId + ' — ' + row.name,
        className: 'ag-modal--wide',
        body: ui.h('pre', { class: 'ag-pre' }, row.detail)
      });
    }

    function columnDef(key) {
      return {
        key: key,
        labelKey: 'aiagent.upload.col.' + key,
        className: 'ag-col-' + key,
        render: function (row, td) {
          var issues = (row.issues || []).filter(function (x) {
            return x.column === key;
          });
          var cls = issueClass(issues);
          if (cls) td.classList.add(cls);
          var out = [];
          if (key === 'rowNo') {
            out.push(String(row.rowNo));
            if (row.issues && row.issues.length) {
              var rowSev = issueClass(row.issues) === 'ag-cell--error' ? 'ERROR' : 'WARNING';
              out.push(
                sevBadge(
                  rowSev,
                  row.issues
                    .map(function (x) {
                      return x.code + ' ' + x.message;
                    })
                    .join('\n')
                )
              );
            }
          } else if (key === 'detail') {
            out.push(
              row.detail
                ? ui.h(
                    'button',
                    {
                      type: 'button',
                      class: 'ag-clamp-btn',
                      onclick: function () {
                        showDetail(row);
                      }
                    },
                    ui.h('span', { class: 'ag-clamp2' }, row.detail)
                  )
                : ''
            );
          } else {
            out.push(ui.h('span', { class: 'ag-pre-line' }, row[key] == null ? '' : String(row[key])));
          }
          issues.forEach(function (x) {
            out.push(sevBadge(x.severity, x.code + ' ' + x.message));
          });
          return out;
        }
      };
    }

    function renderPreview(rows) {
      var body = ui.clear(parts.preview.body);
      var size = A.config.previewPageSize;
      var pages = Math.max(1, Math.ceil(v.total / size));
      var tbl = ui.table({
        className: 'ag-table--preview',
        columns: COLUMNS.map(columnDef),
        rows: rows,
        rowClass: function (row) {
          return row.reqId ? null : 'ag-row--blank';
        }
      });
      body.appendChild(tbl.el);
      body.appendChild(
        ui.h('div', { class: 'ag-pager' }, [
          ui.h('span', { class: 'ag-pager-total' }, t('aiagent.common.count', { n: v.total })),
          ui.button({
            labelKey: 'aiagent.common.prev',
            kind: 'plain',
            disabled: v.page <= 1,
            onClick: function () {
              loadPage(v.page - 1);
            }
          }),
          ui.h('span', { class: 'ag-pager-pos' }, v.page + ' / ' + pages),
          ui.button({
            labelKey: 'aiagent.common.next',
            kind: 'plain',
            disabled: v.page >= pages,
            onClick: function () {
              loadPage(v.page + 1);
            }
          })
        ])
      );
    }

    function loadPage(page) {
      ui.loading(parts.preview.body);
      return A.api.request('GET', base() + '/preview', null, { query: { page: page, size: A.config.previewPageSize } }).then(
        function (res) {
          if (!alive) return;
          v.page = page;
          v.total = res.total;
          renderPreview(res.rows);
        },
        function (err) {
          if (alive)
            ui.errorCard(parts.preview.body, err, function () {
              loadPage(page);
            });
        }
      );
    }

    // ── 영역 D: 검증 리포트 ──
    function reportRows() {
      var list = [];
      (v.validation.errors || []).forEach(function (e) {
        list.push(Object.assign({ severity: 'ERROR' }, e));
      });
      (v.validation.warnings || []).forEach(function (e) {
        list.push(Object.assign({ severity: 'WARNING' }, e));
      });
      return list;
    }

    function exportCsv() {
      var cols = ['severity', 'row', 'column', 'code', 'message'];
      function cell(x) {
        var s = x == null ? '' : String(x);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      var lines = [
        cols
          .map(function (c) {
            return cell(t('aiagent.upload.report.col.' + c));
          })
          .join(',')
      ];
      reportRows().forEach(function (r) {
        lines.push([t('aiagent.upload.sev.' + r.severity), r.rowNo, r.column, r.code, r.message].map(cell).join(','));
      });
      ui.download('validation_rev' + v.rev + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    }

    function renderReport() {
      var body = ui.clear(parts.report.body);
      ui.clear(parts.report.controls).appendChild(
        ui.button({ labelKey: 'aiagent.upload.reportDownload', kind: 'plain', icon: 'download', onClick: exportCsv })
      );
      body.appendChild(
        ui.h('div', { class: 'ag-badge-row' }, [
          ui.badge(null, null, { tone: v.validation.errorCount > 0 ? 'crit' : 'done', text: t('aiagent.upload.errors', { n: v.validation.errorCount }) }),
          ui.badge(null, null, { tone: v.validation.warningCount > 0 ? 'warn' : 'done', text: t('aiagent.upload.warnings', { n: v.validation.warningCount }) })
        ])
      );
      body.appendChild(
        ui.table({
          columns: [
            {
              key: 'severity',
              labelKey: 'aiagent.upload.report.col.severity',
              sortable: true,
              render: function (r) {
                return sevBadge(r.severity);
              }
            },
            { key: 'rowNo', labelKey: 'aiagent.upload.report.col.row', sortable: true },
            {
              key: 'column',
              labelKey: 'aiagent.upload.report.col.column',
              sortable: true,
              render: function (r) {
                return A.i18n.has('aiagent.upload.col.' + r.column) ? t('aiagent.upload.col.' + r.column) : r.column;
              }
            },
            { key: 'code', labelKey: 'aiagent.upload.report.col.code', sortable: true, className: 'ag-mono' },
            { key: 'message', labelKey: 'aiagent.upload.report.col.message' }
          ],
          rows: reportRows()
        }).el
      );
    }

    // ── 리비전 열기 ──
    function openRev(rev) {
      v.rev = rev;
      v.page = 1;
      ui.loading(parts.preview.body);
      ui.loading(parts.report.body);
      return Promise.all([
        A.api.request('GET', base() + '/validation'),
        A.api.request('GET', base() + '/preview', null, { query: { page: 1, size: A.config.upload.maxRows } })
      ]).then(
        function (r) {
          if (!alive || v.rev !== rev) return;
          v.validation = r[0];
          v.total = r[1].total;
          v.registrable = r[1].rows.filter(function (row) {
            return row.reqId;
          }).length;
          renderSummary();
          renderReport();
          renderPreview(r[1].rows.slice(0, A.config.previewPageSize));
        },
        function (err) {
          if (!alive) return;
          ui.errorCard(parts.report.body, err, function () {
            openRev(rev);
          });
          ui.clear(parts.preview.body);
        }
      );
    }

    return {
      mount: function (el, c) {
        ctx = c;
        alive = true;
        parts.session = ui.widget('aiagent.upload.session');
        parts.upload = ui.widget('aiagent.upload.title');
        parts.preview = ui.widget('aiagent.upload.preview', { className: 'ag-widget--wide' });
        parts.report = ui.widget('aiagent.upload.report');
        el.appendChild(
          ui.h('div', { class: 'ag-view ag-view--upload' }, [
            ui.h('div', { class: 'ag-grid-2' }, [parts.session.el, parts.upload.el]),
            parts.report.el,
            parts.preview.el
          ])
        );
        renderSession();
        renderUpload();

        var recent = lastUpload[ctx.sid];
        var rev = recent ? recent.revision : ctx.session && ctx.session.latestRevision;
        if (rev) {
          openRev(rev);
        } else {
          parts.preview.body.appendChild(ui.empty());
          parts.report.body.appendChild(ui.empty());
        }
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  // 마운트마다 새 인스턴스(상태 누수 방지)
  A.views.upload = {
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
