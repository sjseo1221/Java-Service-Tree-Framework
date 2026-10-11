/*
 * SCR-01 프로세스 플로우 헤더(REQ-F-021 · F-022). SDS MOD-14 파일명.
 * flowState = { stages[](API-102 그대로), selectedStageNo } — 좌측 메뉴(sidemenu)와 공유하지 않는다.
 * 단계 상태를 클라이언트가 직접 바꾸지 않는다. 'stages:changed' 를 받으면 API-102 를 다시 조회한다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var STATUS_ICON = { COMPLETED: 'check', RUNNING: 'progress', WAITING: 'circle', LOCKED: 'lock' };
  var VIEW_W = 1200;
  var NODE_W = 100;
  var NODE_H = 84;
  var NODE_Y = 18;

  var state = { stages: null, selectedStageNo: null };
  var els = {};
  var noticeTimer = null;

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function currentStageNo(stages) {
    if (!stages || !stages.length) return null;
    var i;
    for (i = 0; i < stages.length; i++) if (stages[i].status === 'RUNNING') return i + 1;
    for (i = 0; i < stages.length; i++) if (stages[i].status === 'WAITING') return i + 1;
    return null;
  }

  function nodeX(i) {
    var gap = (VIEW_W - 20 - NODE_W * 10) / 9;
    return 10 + i * (NODE_W + gap);
  }

  function renderSvg() {
    var ui = A.ui;
    var stages = state.stages || [];
    var svg = ui.svg('svg', { class: 'ag-flow-svg', viewBox: '0 0 ' + VIEW_W + ' 120', role: 'group', 'aria-label': t('aiagent.app.title') });
    svg.appendChild(
      ui.svg('defs', null, [
        ui.svg('marker', { id: 'ag_arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, [
          ui.svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ag-flow-arrowhead' })
        ]),
        ui.svg('marker', { id: 'ag_arrow_done', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, [
          ui.svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ag-flow-arrowhead is-done' })
        ])
      ])
    );

    A.config.stages.forEach(function (def, i) {
      var s = stages[i] || { status: 'LOCKED' };
      var x = nodeX(i);
      var status = s.status;
      var statusLabel = A.i18n.label('STAGE_STATUS', status);
      var shortName = t('aiagent.flow.stage.' + def.no + '.short');
      var fullName = t('aiagent.flow.stage.' + def.no + '.name');

      if (i < 9) {
        var done = status === 'COMPLETED' && stages[i + 1] && stages[i + 1].status !== 'LOCKED';
        var x1 = x + NODE_W + 2;
        var x2 = nodeX(i + 1) - 3;
        svg.appendChild(
          ui.svg('path', {
            d: 'M' + x1 + ',' + (NODE_Y + NODE_H / 2) + ' L' + x2 + ',' + (NODE_Y + NODE_H / 2),
            class: 'ag-flow-arrow' + (done ? ' is-done' : ''),
            'marker-end': done ? 'url(#ag_arrow_done)' : 'url(#ag_arrow)'
          })
        );
      }

      var tip = fullName + ' — ' + statusLabel;
      if (s.confirmedBy) tip += ' · ' + t('aiagent.doc.confirmedBy', { who: s.confirmedBy, at: A.ui.fmt.dt(s.confirmedAt) });

      var g = ui.svg(
        'g',
        {
          class: 'ag-node ag-node--' + status.toLowerCase() + (state.selectedStageNo === def.no ? ' is-selected' : ''),
          role: 'button',
          tabindex: '0',
          'aria-label': def.no + '. ' + shortName + ' — ' + statusLabel,
          'aria-disabled': status === 'LOCKED' ? 'true' : null,
          'aria-current': state.selectedStageNo === def.no ? 'step' : null,
          'data-stage': String(def.no)
        },
        [
          ui.svg('title', null, tip),
          ui.svg('rect', { class: 'ag-node-box', x: String(x), y: String(NODE_Y), width: String(NODE_W), height: String(NODE_H), rx: '8', ry: '8' }),
          ui.svg('circle', { class: 'ag-node-no-bg', cx: String(x + 14), cy: String(NODE_Y + 14), r: '10' }),
          ui.svg('text', { class: 'ag-node-no', x: String(x + 14), y: String(NODE_Y + 18), 'text-anchor': 'middle' }, String(def.no)),
          ui.svg('use', { href: '#ag-ico-' + def.icon, class: 'ag-node-ico', x: String(x + NODE_W / 2 - 13), y: String(NODE_Y + 12), width: '26', height: '26' }),
          ui.svg('use', { href: '#ag-ico-' + STATUS_ICON[status], class: 'ag-node-status ag-node-status--' + status.toLowerCase(), x: String(x + NODE_W - 22), y: String(NODE_Y + 4), width: '18', height: '18' }),
          ui.svg('text', { class: 'ag-node-label', x: String(x + NODE_W / 2), y: String(NODE_Y + 58), 'text-anchor': 'middle' }, shortName),
          ui.svg('text', { class: 'ag-node-state', x: String(x + NODE_W / 2), y: String(NODE_Y + 74), 'text-anchor': 'middle' }, statusLabel)
        ]
      );
      svg.appendChild(g);
    });

    A.ui.clear(els.scroll).appendChild(svg);
  }

  function renderGuide() {
    var ui = A.ui;
    var stages = state.stages;
    var text = ui.clear(els.guideText);
    if (!stages) return;
    var cur = currentStageNo(stages);
    if (!cur) {
      text.appendChild(ui.h('strong', null, t('aiagent.flow.allDone')));
      return;
    }
    text.appendChild(ui.h('strong', null, t('aiagent.flow.current', { n: cur, name: t('aiagent.flow.stage.' + cur + '.name') })));
    text.appendChild(ui.h('span', { class: 'ag-flow-next' }, [ui.h('span', { class: 'ag-flow-next-label' }, t('aiagent.flow.nextLabel')), t('aiagent.flow.next.' + cur)]));
  }

  function showLockedNotice(no) {
    var n = els.notice;
    n.textContent = t('aiagent.flow.lockedNotice', { reason: t('aiagent.flow.prereq.' + no) });
    n.classList.add('is-visible');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      n.classList.remove('is-visible');
      n.textContent = '';
    }, 3000);
  }

  function activate(no) {
    var s = state.stages && state.stages[no - 1];
    if (!s) return;
    if (s.status === 'LOCKED') {
      showLockedNotice(no); // hash 불변, 상태 변경 없음
      return;
    }
    A.router.go('#/stage/' + no);
  }

  function onNodeEvent(e) {
    var g = e.target.closest && e.target.closest('.ag-node');
    if (!g) return;
    if (e.type === 'keydown') {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
    }
    activate(Number(g.getAttribute('data-stage')));
  }

  function load() {
    var sid = A.app.state.sid;
    return A.api.request('GET', '/sessions/' + sid + '/stages').then(
      function (stages) {
        state.stages = stages;
        els.scroll.classList.remove('is-error');
        renderSvg();
        renderGuide();
        A.bus.emit('stages:loaded', stages);
        return stages;
      },
      function (err) {
        state.stages = null;
        A.ui.clear(els.guideText);
        A.ui.errorCard(els.scroll, err, load); // 플로우 영역만 대체
        els.scroll.classList.add('is-error');
        return null;
      }
    );
  }

  A.flow = {
    currentStageNo: currentStageNo,

    getStages: function () {
      return state.stages ? state.stages.slice() : null;
    },

    init: function () {
      els.scroll = document.getElementById('aiagent_flow_scroll');
      els.guideText = document.getElementById('aiagent_flow_guide_text');
      els.notice = document.getElementById('aiagent_flow_notice');
      els.scroll.addEventListener('click', onNodeEvent);
      els.scroll.addEventListener('keydown', onNodeEvent);

      A.bus.on('stages:changed', load);
      A.bus.on('lang:changed', function () {
        if (state.stages) {
          renderSvg();
          renderGuide();
        }
      });
      A.bus.on('route:changed', function (route) {
        // 좌측 메뉴 전환(ops/*)은 선택 단계를 건드리지 않는다(REQ-F-020 C3).
        if (route.stageNo && route.stageNo !== state.selectedStageNo) {
          state.selectedStageNo = route.stageNo;
          if (state.stages) renderSvg();
        }
      });
      return load();
    },

    reload: load
  };
})(window);
