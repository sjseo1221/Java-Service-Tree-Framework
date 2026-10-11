/*
 * 부트스트랩: 설정 → 언어팩 → 코드·세션 → 프레임(SCR-01 · SCR-02) → 라우터.
 * appState = { sid, session, lang, route } — 세션 선택은 ?sid=, 언어는 ?lang= (설계서 §2.2).
 * A-RMS 이식 시 boot() 를 execDocReady() 진입점으로 옮긴다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var state = { sid: null, session: null, lang: null, route: null };

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function setQuery(changes, push) {
    var q = new URLSearchParams(w.location.search);
    Object.keys(changes).forEach(function (k) {
      if (changes[k] == null) q.delete(k);
      else q.set(k, changes[k]);
    });
    var url = w.location.pathname + '?' + q.toString() + w.location.hash;
    if (push) w.history.pushState(null, '', url);
    else w.history.replaceState(null, '', url);
  }

  function renderHeader() {
    var ui = A.ui;
    var s = state.session;
    document.getElementById('aiagent_hdr_session').textContent = t('aiagent.app.session', { sid: state.sid });
    var meta = ui.clear(document.getElementById('aiagent_hdr_meta'));
    if (!s) return;
    meta.appendChild(ui.h('span', { class: 'ag-hdr-meta-item' }, [ui.h('span', { class: 'ag-hdr-meta-label' }, t('aiagent.app.product')), s.pdServiceName]));
    meta.appendChild(ui.h('span', { class: 'ag-hdr-meta-item' }, [ui.h('span', { class: 'ag-hdr-meta-label' }, t('aiagent.app.version')), s.targetVersion]));
  }

  function loadSession() {
    return A.api.request('GET', '/sessions/' + state.sid).then(
      function (s) {
        state.session = s;
        renderHeader();
        return s;
      },
      function (err) {
        state.session = null;
        renderHeader();
        A.ui.toast('error', A.api.errorMessage(err));
        return null;
      }
    );
  }

  function loadCodes() {
    return A.api.request('GET', '/codes').then(A.i18n.setCodes, function () {
      /* 코드 라벨은 언어팩이 우선이므로 실패해도 진행 */
    });
  }

  function bindLang() {
    var sel = document.getElementById('aiagent_lang');
    sel.value = state.lang;
    sel.addEventListener('change', function () {
      A.i18n.setLang(sel.value).then(function (lang) {
        state.lang = lang;
        setQuery({ lang: lang }, false);
        renderHeader();
      });
    });
  }

  function boot() {
    var q = new URLSearchParams(w.location.search);
    state.sid = q.get('sid') || String(A.config.defaultSid);
    var lang = A.i18n.initialLang(q.get('lang'));

    A.i18n
      .load(lang)
      .then(function (applied) {
        state.lang = applied;
        A.i18n.apply(document);
        bindLang();
        return Promise.all([loadCodes(), loadSession()]);
      })
      .then(function () {
        A.sidemenu.init(); // 메뉴 실패는 메뉴 영역에 갇힌다
        return A.flow.init();
      })
      .then(function () {
        A.router.start(document.getElementById('aiagent_body'));
      })
      .catch(function (err) {
        console.error('[aiagent :: main] boot', err);
        A.ui.errorCard(document.getElementById('aiagent_body'), err);
      });
  }

  A.app = {
    state: state,

    /** 세션 전환(SCR-03 새 세션 시작). ?sid= 갱신 후 세션·단계 재조회. */
    setSid: function (sid) {
      state.sid = String(sid);
      setQuery({ sid: state.sid }, true);
      return loadSession().then(function (s) {
        return A.flow.reload().then(function () {
          A.bus.emit('session:changed', s);
          return s;
        });
      });
    },

    reloadSession: loadSession
  };

  w.addEventListener('popstate', function () {
    var sid = new URLSearchParams(w.location.search).get('sid') || String(A.config.defaultSid);
    if (sid !== state.sid) {
      state.sid = sid;
      loadSession()
        .then(A.flow.reload)
        .then(function () {
          A.bus.emit('session:changed', state.session);
          A.router.reload();
        });
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
