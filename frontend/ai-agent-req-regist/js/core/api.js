/*
 * 데이터 접근 단일 창구(설계서 P3 · §2.4).
 *   AIAGENT.api.request(method, path, body?, {query?, idempotent?, idempotencyKey?}) → Promise<data>
 *   AIAGENT.api.url(path)  → 다운로드·iframe 용 URL
 * path 는 config.apiBase 를 뺀 실제 API 경로(예: '/sessions/1001/stages').
 * 오류는 항상 {status, code, message, details[], traceId} 로 정규화해 reject 한다(SDS §5.1).
 * 이식 시: live 분기의 fetch 를 $.ajax 로 바꾸면 된다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});

  function normalizeError(err, status) {
    if (err && err.code && err.status) {
      return { status: err.status, code: err.code, message: err.message || err.code, details: err.details || [], traceId: err.traceId || null };
    }
    if (err && err.code) {
      return { status: status || 0, code: err.code, message: err.message || err.code, details: err.details || [], traceId: err.traceId || null };
    }
    return { status: status || 0, code: 'UNKNOWN', message: (err && err.message) || String(err), details: [], traceId: null };
  }

  function qs(query) {
    if (!query) return '';
    var parts = [];
    Object.keys(query).forEach(function (k) {
      var v = query[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function uuid() {
    if (w.crypto && typeof w.crypto.randomUUID === 'function') return w.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function splitPath(path) {
    var base = A.config.apiBase;
    var p = String(path);
    if (p.indexOf(base) === 0) p = p.slice(base.length);
    var q = {};
    var i = p.indexOf('?');
    if (i >= 0) {
      new URLSearchParams(p.slice(i + 1)).forEach(function (v, k) {
        q[k] = v;
      });
      p = p.slice(0, i);
    }
    return { path: p, query: q };
  }

  function mockRequest(method, path, body, opts, headers) {
    var sp = splitPath(path);
    var query = Object.assign({}, sp.query, opts.query || {});
    var hit = A.mockRoutes.match(method, sp.path);
    return delay(A.config.mockLatencyMs).then(function () {
      if (!hit) throw { status: 404, code: 'UNKNOWN', message: method + ' ' + sp.path, details: [] };
      var route = hit.route;
      if (route.handler) {
        var fn = A.mockServer.handlers[route.handler];
        if (typeof fn !== 'function') throw { status: 501, code: 'UNKNOWN', message: 'mock handler ' + route.handler, details: [] };
        return fn(hit.params, query, body, headers);
      }
      if (route.file) {
        return A.mockServer.read(A.mockRoutes.fill(route.file, hit.params)).catch(function (err) {
          if (err && err.status === 404 && Object.prototype.hasOwnProperty.call(route, 'fallback')) {
            return A.mockServer.clone(route.fallback);
          }
          throw err;
        });
      }
      throw { status: 405, code: 'UNKNOWN', message: method + ' ' + sp.path, details: [] };
    });
  }

  function liveRequest(method, path, body, opts, headers) {
    var sp = splitPath(path);
    var url = A.config.apiBase + sp.path + qs(Object.assign({}, sp.query, opts.query || {}));
    var init = { method: method, headers: Object.assign({ Accept: 'application/json' }, headers), credentials: 'same-origin' };
    if (body != null) {
      if (body instanceof FormData) {
        init.body = body;
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }
    return fetch(url, init).then(function (res) {
      var ct = res.headers.get('Content-Type') || '';
      var parse = ct.indexOf('json') >= 0 ? res.json() : res.text();
      return parse.then(function (data) {
        if (!res.ok) throw normalizeError(data && typeof data === 'object' ? data : null, res.status);
        return data;
      });
    });
  }

  A.api = {
    request: function (method, path, body, opts) {
      opts = opts || {};
      var headers = {};
      if (opts.idempotent || opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey || uuid();
      var m = String(method || 'GET').toUpperCase();
      var p = A.config.mode === 'live' ? liveRequest(m, path, body, opts, headers) : mockRequest(m, path, body, opts, headers);
      return Promise.resolve(p).catch(function (err) {
        throw normalizeError(err, err && err.status);
      });
    },

    url: function (path) {
      var sp = splitPath(path);
      if (A.config.mode === 'live') return A.config.apiBase + sp.path + qs(sp.query);
      var hit = A.mockRoutes.match('GET', sp.path);
      if (!hit) return '#';
      var r = hit.route;
      if (r.url) return typeof r.url === 'function' ? r.url(hit.params) : r.url;
      if (r.file) return A.config.mockBase + A.mockRoutes.resolve(A.mockRoutes.fill(r.file, hit.params));
      return '#';
    },

    newIdempotencyKey: uuid,

    /** 화면 표시용 오류 문구: 언어팩 aiagent.error.{code} → 서버 message */
    errorMessage: function (err) {
      var code = err && err.code;
      var key = 'aiagent.error.' + (code || 'UNKNOWN');
      if (A.i18n.has(key)) return A.i18n.t(key);
      if (err && err.message && err.message !== code) return err.message;
      return A.i18n.t('aiagent.error.UNKNOWN');
    }
  };
})(window);
