/*
 * SCR-02 운영 기능 좌측 메뉴(REQ-F-020). SDS MOD-14 파일명.
 * sideState = { menu[](G6 응답), collapsed(localStorage) } — flowState 를 읽거나 쓰지 않는다.
 * 권한 없는 항목은 서버(G6)가 응답에서 뺀다. 화면 필터 없음(REQ-F-020.6).
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var STORE_KEY = 'aiagent:side-collapsed';
  var state = { menu: null, collapsed: false };
  var els = {};

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function readCollapsed() {
    try {
      var v = w.localStorage.getItem(STORE_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {
      /* 저장소 불가 */
    }
    return w.matchMedia ? w.matchMedia('(max-width: 767px)').matches : false; // 768px 미만 기본 접힘
  }

  function writeCollapsed(v) {
    try {
      w.localStorage.setItem(STORE_KEY, v ? '1' : '0');
    } catch (e) {
      /* 저장소 불가 */
    }
  }

  function applyCollapsed() {
    var key = state.collapsed ? 'aiagent.menu.expand' : 'aiagent.menu.collapse';
    document.getElementById('aiagent_layout').classList.toggle('is-side-collapsed', state.collapsed);
    els.toggle.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
    els.toggle.setAttribute('title', t(key));
    els.toggle.setAttribute('aria-label', t(key));
  }

  function markActive() {
    var hash = (A.app.state.route && A.app.state.route.hash) || w.location.hash;
    Array.prototype.forEach.call(els.list.querySelectorAll('a.ag-side-item'), function (a) {
      var on = a.getAttribute('data-route') === hash;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function render() {
    var ui = A.ui;
    var ul = ui.h('ul', { class: 'ag-side-list' });
    ui.clear(els.list).appendChild(ul);
    (state.menu || []).forEach(function (it) {
      var label = t(it.labelKey);
      var reason = it.available ? '' : t(it.reasonKey);
      var a = ui.h(
        'a',
        {
          class: 'ag-side-item' + (it.available ? '' : ' is-disabled'),
          href: it.route,
          'data-route': it.route,
          'aria-disabled': it.available ? null : 'true',
          title: it.available ? label : label + ' — ' + reason
        },
        [ui.icon(it.icon), ui.h('span', { class: 'ag-side-label' }, label)]
      );
      if (!it.available) {
        a.addEventListener('click', function (e) {
          e.preventDefault(); // 이동 없음, 사유만 안내
          ui.toast('warn', reason);
        });
      }
      ul.appendChild(ui.h('li', null, a));
    });
    markActive();
  }

  function load() {
    return A.api.request('GET', '/menu').then(
      function (data) {
        state.menu = (data && data.items) || [];
        render();
      },
      function (err) {
        state.menu = null;
        A.ui.errorCard(els.list, err, load); // 메뉴 영역만 대체
      }
    );
  }

  A.sidemenu = {
    init: function () {
      els.toggle = document.getElementById('aiagent_side_toggle');
      els.list = document.getElementById('aiagent_side_list');
      state.collapsed = readCollapsed();
      applyCollapsed();
      els.toggle.addEventListener('click', function () {
        state.collapsed = !state.collapsed;
        writeCollapsed(state.collapsed);
        applyCollapsed();
      });
      A.bus.on('route:changed', markActive);
      A.bus.on('lang:changed', function () {
        applyCollapsed();
        if (state.menu) render();
      });
      return load();
    }
  };
})(window);
