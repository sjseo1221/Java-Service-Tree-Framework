/*
 * SCR-11 에이전트 · Skill 관리 (좌측 메뉴 3 · 4) — REQ-F-018 · REQ-F-019
 * mode = agents(#/ops/agents) | skills(#/ops/skills). 좌측 목록 + 우측 에디터 2단.
 * API-505 · 508(목록) · G3(본문) · 506 · 509(검사 및 저장) · 507 · 510(비활성 · 재활성 — 삭제 없음)
 * 저장 전 클라이언트 사전 검사(frontmatter name · description, 이름 형식 · 중복) 후 서버 검사 결과(violations[])를 표시한다.
 * 실행 중 작업이 참조하는 Skill 은 비활성 버튼을 막고, 서버도 409 AGT-STATE-002 로 거부한다.
 * 버전 이력 · 복원 · 에이전트-Skill 연결 변경은 API 가 없어 제외(설계서 I-06).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var UNLINKED = '__unlinked';
  var TEMPLATE = { agents: 'assets/templates/agent-template.md', skills: 'assets/templates/skill-template.md' };

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function create() {
    var ui = A.ui;
    var alive = false;
    var mode = 'agents';
    var parts = {};
    var v = { rows: [], agents: [], filter: '', selected: null, isNew: false, table: null };
    var ed = {}; // 에디터 요소

    function base() {
      return mode === 'agents' ? '/agents' : '/skills';
    }

    function enabledBadge(on) {
      return ui.badge('ASSET_STATE', on ? 'ENABLED' : 'DISABLED', { tone: on ? 'done' : 'muted', text: t(on ? 'aiagent.asset.enabled' : 'aiagent.asset.disabled') });
    }

    // ── 목록 ──
    function columns() {
      var cols = [
        {
          key: 'name',
          labelKey: 'aiagent.asset.col.name',
          sortable: true,
          className: 'ag-nowrap',
          render: function (r) {
            return ui.h('button', { type: 'button', class: 'ag-link-btn ag-mono', onclick: function () {
              select(r.name, true);
            } }, r.name);
          }
        }
      ];
      if (mode === 'agents') {
        cols.push({
          key: 'description',
          labelKey: 'aiagent.asset.col.description',
          render: function (r) {
            return ui.h('span', { class: 'ag-clamp2', title: r.description || '' }, r.description || '');
          }
        });
      } else {
        cols.push({
          key: 'agent',
          labelKey: 'aiagent.asset.col.agent',
          sortable: true,
          render: function (r) {
            return r.agent ? ui.h('span', { class: 'ag-mono' }, r.agent) : ui.h('span', { class: 'ag-badge ag-tone--orange' }, t('aiagent.asset.unlinked'));
          }
        });
      }
      cols.push({
        key: 'enabled',
        labelKey: 'aiagent.asset.col.enabled',
        sortable: true,
        sortValue: function (r) {
          return r.enabled ? 0 : 1;
        },
        render: function (r) {
          return enabledBadge(r.enabled);
        }
      });
      if (mode === 'skills') {
        cols.push({
          key: 'referenced',
          labelKey: 'aiagent.asset.col.referenced',
          render: function (r) {
            return r.referencedByRunning ? ui.badge('EXEC_STATE', 'RUNNING', { text: t('aiagent.asset.referenced'), title: t('aiagent.asset.runningExecs', { list: r.runningExecIds.map(function (id) {
              return ui.fmt.shortId(id);
            }).join(', ') }) }) : ui.h('span', { class: 'ag-muted' }, '—');
          }
        });
      }
      cols.push({
        key: 'updatedAt',
        labelKey: 'aiagent.asset.col.updatedAt',
        sortable: true,
        className: 'ag-nowrap',
        render: function (r) {
          return ui.fmt.dt(r.updatedAt);
        }
      });
      return cols;
    }

    function renderList() {
      v.table = ui.table({
        className: 'ag-table--compact',
        columns: columns(),
        rows: v.rows,
        rowClass: function (r) {
          return [r.enabled ? '' : 'ag-row--muted', v.selected === r.name && !v.isNew ? 'is-selected' : ''].join(' ').trim() || null;
        },
        onRowClick: function (r) {
          select(r.name, true);
        }
      });
      ui.clear(parts.list.body).appendChild(v.table.el);
    }

    function renderControls() {
      var c = ui.clear(parts.list.controls);
      if (mode === 'skills') {
        var sel = ui.h('select', { id: 'ag_asset_filter', class: 'ag-input ag-input--sm' }, [ui.h('option', { value: '' }, t('aiagent.common.all'))]);
        v.agents.forEach(function (a) {
          sel.appendChild(ui.h('option', { value: a.name }, a.name));
        });
        sel.appendChild(ui.h('option', { value: UNLINKED }, t('aiagent.asset.unlinked')));
        sel.value = v.filter;
        sel.addEventListener('change', function () {
          v.filter = sel.value;
          loadList();
        });
        c.appendChild(ui.h('label', { for: 'ag_asset_filter', class: 'ag-label ag-label--inline' }, t('aiagent.asset.filterAgent')));
        c.appendChild(sel);
      }
      c.appendChild(
        ui.button({
          labelKey: mode === 'agents' ? 'aiagent.asset.newAgent' : 'aiagent.asset.newSkill',
          kind: 'blue',
          icon: 'plus',
          onClick: startNew
        })
      );
    }

    function loadList() {
      ui.loading(parts.list.body);
      var query = mode === 'skills' && v.filter && v.filter !== UNLINKED ? { agent: v.filter } : null;
      return Promise.all([A.api.request('GET', base(), null, { query: query }), mode === 'skills' ? A.api.request('GET', '/agents') : null]).then(
        function (r) {
          if (!alive) return;
          v.rows = (r[0] || []).filter(function (x) {
            return v.filter !== UNLINKED || !x.agent;
          });
          if (r[1]) v.agents = r[1];
          renderControls();
          renderList();
        },
        function (err) {
          if (!alive) return;
          renderControls();
          ui.errorCard(parts.list.body, err, loadList);
        }
      );
    }

    function rowOf(name) {
      return v.rows.filter(function (r) {
        return r.name === name;
      })[0];
    }

    // ── 에디터 ──
    function renderMeta() {
      var fm = A.markdown.frontmatter(ed.area.value).data;
      var items = [['aiagent.asset.name', fm.name], ['aiagent.asset.col.description', fm.description]];
      if (mode === 'agents') {
        items.push(['aiagent.asset.meta.tools', Array.isArray(fm.tools) ? fm.tools.join(', ') : fm.tools]);
        items.push(['aiagent.asset.meta.model', fm.model]);
      }
      ui.clear(ed.meta).appendChild(
        ui.h(
          'dl',
          { class: 'ag-dl' },
          items.map(function (it) {
            return [ui.h('dt', null, t(it[0])), ui.h('dd', { class: it[1] ? 'ag-clamp2' : 'ag-muted', title: it[1] || null }, it[1] || '—')];
          })
        )
      );
    }

    function showProblems(list) {
      ui.clear(ed.problems);
      if (!list.length) return;
      ed.problems.appendChild(
        ui.h('div', { class: 'ag-banner ag-banner--crit', role: 'alert' }, [
          ui.icon('alert'),
          ui.h('div', null, [
            ui.h('strong', null, t('aiagent.asset.invalid')),
            ui.h(
              'ul',
              { class: 'ag-error-details' },
              list.map(function (p) {
                return ui.h('li', null, [p.text, p.detail ? ui.h('code', { class: 'ag-error-code' }, p.detail) : null]);
              })
            )
          ])
        ])
      );
    }

    function violationText(code) {
      var key = 'aiagent.asset.violation.' + code;
      return A.i18n.has(key) ? t(key) : code;
    }

    /** 클라이언트 사전 검사(서버도 다시 판정) */
    function precheck(name) {
      var out = [];
      if (v.isNew) {
        if (!name) out.push({ text: t('aiagent.asset.nameRequired') });
        else if (!NAME_RE.test(name)) out.push({ text: t('aiagent.asset.namePattern') });
        else if (rowOf(name)) out.push({ text: t('aiagent.asset.duplicate') });
      }
      var fm = A.markdown.frontmatter(ed.area.value).data;
      if (!fm.name) out.push({ text: violationText('MISSING_FIELD'), detail: 'name' });
      else if (name && fm.name !== name) out.push({ text: t('aiagent.asset.nameMismatch'), detail: fm.name });
      if (!fm.description) out.push({ text: t('aiagent.asset.descRequired') });
      return out;
    }

    function save() {
      var name = v.isNew ? ed.name.value.trim() : v.selected;
      var problems = precheck(name);
      showProblems(problems);
      if (problems.length) return;
      ed.saveBtn.disabled = true;
      var body = { content: ed.area.value, create: v.isNew };
      if (mode === 'skills') body.agent = v.isNew ? ed.agent.value || null : (rowOf(name) || {}).agent || null;
      A.api
        .request('PUT', base() + '/' + encodeURIComponent(name), body)
        .then(function (res) {
          if (!alive) return;
          if (!res.valid) {
            showProblems(
              (res.violations || []).map(function (x) {
                return { text: violationText(x.code), detail: x.detail };
              })
            );
            ui.toast('error', t('aiagent.asset.invalid'));
            return;
          }
          ui.toast('success', t('aiagent.asset.saved'));
          if (mode === 'agents') ui.toast('info', t('aiagent.asset.workersSynced'));
          v.isNew = false;
          v.selected = name;
          return loadList().then(function () {
            select(name);
          });
        })
        .catch(function (err) {
          if (!alive) return;
          var text = err.code === 'AGT-STATE-001' && v.isNew ? t('aiagent.asset.duplicate') : A.api.errorMessage(err);
          showProblems([{ text: text, detail: (err.details || []).join(', ') || null }]);
        })
        .then(function () {
          if (ed.saveBtn) ed.saveBtn.disabled = false;
        });
    }

    function setEnabled(row, enabled) {
      ui.modal({
        titleKey: enabled ? 'aiagent.asset.enable' : 'aiagent.asset.disable',
        body: ui.h('p', null, [ui.h('strong', { class: 'ag-mono' }, row.name), ' — ', t(enabled ? 'aiagent.asset.enableAsk' : 'aiagent.asset.disableAsk')]),
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: enabled ? 'aiagent.asset.enable' : 'aiagent.asset.disable',
            kind: enabled ? 'green' : 'red',
            onClick: function (api) {
              api.setDisabled(1, true);
              A.api.request('PATCH', base() + '/' + encodeURIComponent(row.name), { enabled: enabled }).then(
                function () {
                  api.close('ok');
                  ui.toast('success', t(enabled ? 'aiagent.asset.enabledDone' : 'aiagent.asset.disabledDone'));
                  if (alive)
                    loadList().then(function () {
                      select(row.name);
                    });
                },
                function (err) {
                  api.close('error');
                  var extra = err.code === 'AGT-STATE-002' && err.details.length ? ' (' + t('aiagent.asset.runningExecs', { list: err.details.join(', ') }) + ')' : '';
                  ui.toast('error', A.api.errorMessage(err) + extra);
                }
              );
            }
          }
        ]
      });
    }

    function editorFrame(content, header, fields) {
      var body = ui.clear(parts.editor.body);
      ed = {};
      ed.area = ui.h('textarea', { id: 'ag_asset_content', class: 'ag-input ag-input--full ag-code-area', rows: '20', spellcheck: 'false' });
      ed.area.value = content;
      ed.area.addEventListener('input', renderMeta);
      ed.meta = ui.h('div', { class: 'ag-asset-meta' });
      ed.problems = ui.h('div', { 'aria-live': 'polite' });
      body.appendChild(header);
      (fields || []).forEach(function (f) {
        body.appendChild(f);
      });
      body.appendChild(ui.h('details', { class: 'ag-details ag-details--card', open: true }, [ui.h('summary', null, t('aiagent.asset.meta')), ed.meta]));
      body.appendChild(ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_asset_content', class: 'ag-label' }, t('aiagent.asset.content')), ed.area]));
      body.appendChild(ed.problems);
      renderMeta();
      return body;
    }

    function actionsRow(row) {
      ed.saveBtn = ui.button({ labelKey: 'aiagent.asset.validateSave', kind: 'green', icon: 'check', onClick: save });
      var btns = [ed.saveBtn];
      if (row && row.enabled) {
        var blocked = mode === 'skills' && row.referencedByRunning;
        btns.push(
          ui.button({
            labelKey: 'aiagent.asset.disable',
            kind: 'red',
            disabled: blocked,
            title: blocked ? t('aiagent.asset.disableBlocked') : null,
            onClick: function () {
              setEnabled(row, false);
            }
          })
        );
      } else if (row) {
        btns.push(
          ui.button({
            labelKey: 'aiagent.asset.enable',
            kind: 'green',
            onClick: function () {
              setEnabled(row, true);
            }
          })
        );
      }
      var out = [ui.h('div', { class: 'ag-actions' }, btns)];
      if (row && mode === 'skills' && row.referencedByRunning) {
        out.push(ui.h('p', { class: 'ag-hint ag-text-warn' }, [ui.icon('lock'), t('aiagent.asset.disableBlocked') + ' · ' + t('aiagent.asset.runningExecs', { list: row.runningExecIds.join(', ') })]));
      }
      return out;
    }

    function select(name, scroll) {
      v.selected = name;
      v.isNew = false;
      if (v.table) v.table.setRows(v.rows);
      var row = rowOf(name);
      ui.loading(parts.editor.body);
      if (scroll) parts.editor.el.scrollIntoView({ block: 'nearest' });
      A.api.request('GET', base() + '/' + encodeURIComponent(name)).then(
        function (doc) {
          if (!alive || v.selected !== name || v.isNew) return;
          var r = rowOf(name) || row || { name: name, enabled: true };
          var header = ui.h('div', { class: 'ag-asset-head' }, [
            ui.h('h3', { class: 'ag-mono' }, name),
            enabledBadge(r.enabled),
            mode === 'skills' ? (r.agent ? ui.h('span', { class: 'ag-chip' }, r.agent) : ui.h('span', { class: 'ag-badge ag-tone--orange' }, t('aiagent.asset.unlinked'))) : null,
            r.updatedAt ? ui.h('span', { class: 'ag-muted' }, ui.fmt.dt(r.updatedAt)) : null
          ]);
          var body = editorFrame(doc.content, header);
          actionsRow(r).forEach(function (x) {
            body.appendChild(x);
          });
        },
        function (err) {
          if (alive && v.selected === name)
            ui.errorCard(parts.editor.body, err, function () {
              select(name);
            });
        }
      );
    }

    function startNew() {
      v.isNew = true;
      v.selected = null;
      if (v.table) v.table.setRows(v.rows);
      ui.loading(parts.editor.body);
      parts.editor.el.scrollIntoView({ block: 'nearest' });
      fetch(TEMPLATE[mode], { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw { status: res.status, code: 'UNKNOWN', message: TEMPLATE[mode] };
          return res.text();
        })
        .then(function (text) {
          if (!alive || !v.isNew) return;
          ed.name = null;
          var nameInput = ui.h('input', { type: 'text', id: 'ag_asset_name', class: 'ag-input ag-input--full ag-mono', autocomplete: 'off', maxlength: '64', placeholder: mode === 'agents' ? 'new-expert' : 'new-skill' });
          var fields = [ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_asset_name', class: 'ag-label' }, t('aiagent.asset.name')), nameInput, ui.h('span', { class: 'ag-hint' }, t('aiagent.asset.namePattern'))])];
          var agentSel = null;
          if (mode === 'skills') {
            agentSel = ui.h('select', { id: 'ag_asset_agent', class: 'ag-input' }, [ui.h('option', { value: '' }, t('aiagent.asset.noAgent'))]);
            v.agents
              .filter(function (a) {
                return a.enabled;
              })
              .forEach(function (a) {
                agentSel.appendChild(ui.h('option', { value: a.name }, a.name));
              });
            if (v.filter && v.filter !== UNLINKED) agentSel.value = v.filter;
            fields.push(ui.h('div', { class: 'ag-field' }, [ui.h('label', { for: 'ag_asset_agent', class: 'ag-label' }, t('aiagent.asset.filterAgent')), agentSel]));
          }
          var header = ui.h('div', { class: 'ag-asset-head' }, ui.h('h3', null, t(mode === 'agents' ? 'aiagent.asset.newAgent' : 'aiagent.asset.newSkill')));
          var body = editorFrame(text, header, fields);
          ed.name = nameInput;
          ed.agent = agentSel;
          actionsRow(null).forEach(function (x) {
            body.appendChild(x);
          });
          nameInput.focus();
        })
        .catch(function (err) {
          if (alive && v.isNew) ui.errorCard(parts.editor.body, err, startNew);
        });
    }

    return {
      mount: function (el, ctx) {
        alive = true;
        mode = ctx.params && ctx.params.mode === 'skills' ? 'skills' : 'agents';
        var titleKey = mode === 'agents' ? 'aiagent.asset.agents.title' : 'aiagent.asset.skills.title';
        parts.list = ui.widget('aiagent.asset.list');
        parts.editor = ui.widget('aiagent.asset.editor');
        el.appendChild(
          ui.h('div', { class: 'ag-view ag-view--assets' }, [
            ui.h('div', { class: 'ag-banner', role: 'note' }, [ui.icon(mode === 'agents' ? 'agent' : 'skill'), ui.h('div', null, [ui.h('strong', null, t(titleKey)), ' — ', t('aiagent.asset.subtitle.' + mode)])]),
            ui.h('div', { class: 'ag-split ag-split--assets' }, [parts.list.el, parts.editor.el]),
            ui.h('p', { class: 'ag-hint' }, [ui.icon('info'), t('aiagent.asset.notInScope')])
          ])
        );
        parts.editor.body.appendChild(ui.empty(t('aiagent.asset.selectHint')));
        var pre = ctx.params && ctx.params.name;
        loadList().then(function () {
          if (alive && pre && rowOf(pre)) select(pre);
        });
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.assets = {
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
