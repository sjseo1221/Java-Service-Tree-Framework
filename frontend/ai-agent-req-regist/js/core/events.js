/*
 * 경량 pub/sub. 화면 간 결합 없이 상태 변경을 알린다.
 * 주요 이벤트: 'stages:changed' · 'stages:loaded' · 'lang:changed' · 'route:changed' · 'session:changed'
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var handlers = {};

  A.bus = {
    on: function (evt, fn) {
      (handlers[evt] = handlers[evt] || []).push(fn);
      return function off() {
        A.bus.off(evt, fn);
      };
    },
    off: function (evt, fn) {
      var list = handlers[evt];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: function (evt, payload) {
      (handlers[evt] || []).slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          console.error('[aiagent :: bus]', evt, e);
        }
      });
    }
  };
})(window);
