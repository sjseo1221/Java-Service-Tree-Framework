/*
 * hash 라우팅(설계서 §2.2). 본문(main#aiagent_body)만 교체한다.
 * view 계약: AIAGENT.views[name] = { mount(el, ctx), unmount() }
 *   ctx = { sid, stageNo, params, stages, session }
 * ── 확장 지점 ──
 * 새 화면은 js/views/aiagent-*.js 에서 AIAGENT.views.{name} 을 등록하고 index.html 에 script 를 추가하면 된다.
 * 아래 TABLE 은 SCR-01~12 전체 라우트를 이미 담고 있다. 등록되지 않은 view 는 "준비 중" 카드로 표시된다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var TABLE = {
    'stage/1': { view: 'upload', stageNo: 1 },
    'stage/2': { view: 'register', stageNo: 2 },
    'stage/3': { view: 'review', stageNo: 3 },
    'stage/4': { view: 'docviewer', stageNo: 4, params: { type: 'SRS', focus: 'generate' } },
    'stage/5': { view: 'docviewer', stageNo: 5, params: { type: 'SRS', focus: 'confirm' } },
    'stage/6': { view: 'docviewer', stageNo: 6, params: { type: 'SDS' } },
    'stage/7': { view: 'backlog', stageNo: 7, params: { focus: 'list' } },
    'stage/8': { view: 'backlog', stageNo: 8, params: { focus: 'assign' } },
    'stage/9': { view: 'execution', stageNo: 9 },
    'stage/10': { view: 'monitor', stageNo: 10 },
    'ops/monitor': { view: 'monitor' },
    'ops/knowledge': { view: 'knowledge' },
    'ops/agents': { view: 'assets', params: { mode: 'agents' } },
    'ops/skills': { view: 'assets', params: { mode: 'skills' } },
    audit: { view: 'audit' }
  };

  var current = null; // {key, view}
  var bodyEl = null;
  var started = false;

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function parse(hash) {
    var raw = String(hash || '').replace(/^#\/?/, '');
    var i = raw.indexOf('?');
    var key = i >= 0 ? raw.slice(0, i) : raw;
    var query = {};
    if (i >= 0) {
      new URLSearchParams(raw.slice(i + 1)).forEach(function (v, k) {
        query[k] = v;
      });
    }
    return { key: key.replace(/\/+$/, ''), query: query, hash: '#/' + raw };
  }

  function defaultHash() {
    var no = A.flow.currentStageNo(A.flow.getStages());
    return '#/stage/' + (no || 10);
  }

  function unmountCurrent() {
    A.poller.stopAll();
    if (current && current.view && typeof current.view.unmount === 'function') {
      try {
        current.view.unmount();
      } catch (e) {
        console.error('[aiagent :: router] unmount', e);
      }
    }
    current = null;
  }

  function lockedCard(stageNo) {
    var ui = A.ui;
    var stages = A.flow.getStages();
    var cur = A.flow.currentStageNo(stages);
    return ui.h('div', { class: 'ag-locked-card', role: 'status' }, [
      ui.icon('lock', 'ag-ico--lg'),
      ui.h('p', { class: 'ag-locked-title' }, t('aiagent.flow.lockedNotice', { reason: t('aiagent.flow.prereq.' + stageNo) })),
      cur
        ? ui.h('a', { class: 'ag-link', href: '#/stage/' + cur }, t('aiagent.flow.current', { n: cur, name: t('aiagent.flow.stage.' + cur + '.name') }))
        : null
    ]);
  }

  function render() {
    var r = parse(w.location.hash);
    var def = TABLE[r.key];
    if (!def) {
      w.location.replace(defaultHash());
      return;
    }
    unmountCurrent();
    A.ui.clear(bodyEl);

    var stages = A.flow.getStages();
    var info = { key: r.key, hash: r.hash, stageNo: def.stageNo || null, view: def.view };
    A.app.state.route = info;
    A.bus.emit('route:changed', info);

    if (def.stageNo && stages && stages[def.stageNo - 1] && stages[def.stageNo - 1].status === 'LOCKED') {
      bodyEl.appendChild(lockedCard(def.stageNo)); // 보조 수단. 서버(mock gate)가 다시 판정한다.
      return;
    }

    var view = A.views[def.view];
    if (!view) {
      bodyEl.appendChild(A.ui.h('div', { class: 'ag-empty ag-empty--lg' }, t('aiagent.common.notReady')));
      return;
    }

    var ctx = {
      sid: A.app.state.sid,
      stageNo: def.stageNo || null,
      params: Object.assign({}, def.params || {}, r.query),
      stages: stages,
      session: A.app.state.session
    };
    current = { key: r.key, view: view };
    try {
      view.mount(bodyEl, ctx);
    } catch (e) {
      console.error('[aiagent :: router] mount', def.view, e);
      A.ui.errorCard(bodyEl, { code: 'UNKNOWN', message: String(e && e.message) });
    }
  }

  A.router = {
    table: TABLE,
    parse: parse,

    start: function (el) {
      bodyEl = el;
      if (started) return;
      started = true;
      w.addEventListener('hashchange', render);
      A.bus.on('lang:changed', render); // 현재 view 재마운트(입력값 유실 허용, 설계서 §2.2)
      if (!TABLE[parse(w.location.hash).key]) w.location.replace(defaultHash());
      else render();
    },

    /** 같은 hash 로 다시 그리기(세션 전환 등) */
    reload: render,

    go: function (hash) {
      if (w.location.hash === hash) render();
      else w.location.hash = hash;
    }
  };
})(window);
