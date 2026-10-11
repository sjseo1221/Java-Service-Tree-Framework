/*
 * 언어팩(API-605). 선택 언어 → 기본 언어(ko) → '' 순으로 찾는다.
 * 키 문자열은 화면에 노출하지 않고, 누락은 console.warn 으로만 남긴다(REQ-NF-003).
 * 마크업: data-locale 속성 = 키(textContent), data-locale-attr 속성 = "placeholder:키;title:키"
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var STORE_KEY = 'aiagent:lang';
  var packs = {}; // lang → {key: text}
  var codes = []; // API-604 응답 캐시(라벨 폴백용)
  var warned = {};

  function cfg() {
    return A.config;
  }

  function normalize(lang) {
    var c = cfg();
    var v = String(lang || '').toLowerCase();
    if (c.langAlias[v]) v = c.langAlias[v];
    return c.langs.indexOf(v) >= 0 ? v : null;
  }

  function stored() {
    try {
      return w.localStorage.getItem(STORE_KEY);
    } catch (e) {
      return null;
    }
  }

  function store(lang) {
    try {
      w.localStorage.setItem(STORE_KEY, lang);
    } catch (e) {
      /* 저장 불가 환경은 무시 */
    }
  }

  function fetchPack(lang) {
    if (packs[lang]) return Promise.resolve(packs[lang]);
    return A.api.request('GET', '/i18n/messages', null, { query: { lang: lang } }).then(function (data) {
      packs[lang] = data || {};
      return packs[lang];
    });
  }

  function has(key) {
    var cur = packs[I.lang] || {};
    var def = packs[cfg().defaultLang] || {};
    return Object.prototype.hasOwnProperty.call(cur, key) || Object.prototype.hasOwnProperty.call(def, key);
  }

  function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) && params[name] != null ? String(params[name]) : m;
    });
  }

  var I = {
    lang: null,

    normalize: normalize,

    /** 시작 언어: ?lang → 저장값 → 기본값 */
    initialLang: function (queryLang) {
      return normalize(queryLang) || normalize(stored()) || cfg().defaultLang;
    },

    /** lang 과 기본 언어를 함께 로드한다. */
    load: function (lang) {
      var target = normalize(lang) || cfg().defaultLang;
      var def = cfg().defaultLang;
      var jobs = [fetchPack(def)];
      if (target !== def) jobs.push(fetchPack(target));
      return Promise.all(jobs).then(function () {
        I.lang = target;
        document.documentElement.setAttribute('lang', target);
        store(target);
        return target;
      });
    },

    has: has,

    t: function (key, params) {
      var cur = packs[I.lang] || {};
      var def = packs[cfg().defaultLang] || {};
      var text = cur[key];
      if (text == null) text = def[key];
      if (text == null) {
        if (!warned[key]) {
          warned[key] = true;
          console.warn('[aiagent :: i18n] missing', key);
        }
        return '';
      }
      return interpolate(text, params);
    },

    /** 코드값 표시: 언어팩 aiagent.code.{group}.{code} → API-604 label → code */
    label: function (group, code) {
      if (code == null || code === '') return '';
      var key = 'aiagent.code.' + group + '.' + code;
      if (has(key)) return I.t(key);
      for (var i = 0; i < codes.length; i++) {
        if (codes[i].group === group && codes[i].code === code) return codes[i].label;
      }
      return String(code);
    },

    setCodes: function (list) {
      codes = Array.isArray(list) ? list : [];
    },

    apply: function (root) {
      var scope = root || document;
      Array.prototype.forEach.call(scope.querySelectorAll('[data-locale]'), function (el) {
        el.textContent = I.t(el.getAttribute('data-locale'));
      });
      Array.prototype.forEach.call(scope.querySelectorAll('[data-locale-attr]'), function (el) {
        el.getAttribute('data-locale-attr')
          .split(';')
          .forEach(function (pair) {
            var p = pair.split(':');
            if (p.length === 2 && p[0].trim()) el.setAttribute(p[0].trim(), I.t(p[1].trim()));
          });
      });
    },

    /** 언어 전환: 로드 → 프레임 재적용 → lang:changed */
    setLang: function (lang) {
      return I.load(lang).then(function (applied) {
        I.apply(document);
        A.bus.emit('lang:changed', applied);
        return applied;
      });
    }
  };

  A.i18n = I;
})(window);
