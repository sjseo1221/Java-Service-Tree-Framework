/*
 * 공통 UI 컴포넌트(설계서 §2.9). 데이터 문자열은 textContent 로만 넣는다(innerHTML 금지 — XSS 방지).
 *   h · svg · icon · button · widget · modal · reasonPrompt · toast · badge · errorCard · loading · table · fmt
 * 이식 시: modal → Bootstrap 3 modal, toast → jNotify, table → dataTable_build 로 대응시킨다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) {
        append(el, c);
      });
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    append(el, children);
    return el;
  }

  function svg(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs);
    append(el, children);
    return el;
  }

  /** index.html 의 <symbol id="ag-ico-{name}"> 참조 */
  function icon(name, cls) {
    return svg('svg', { class: 'ag-ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' }, [svg('use', { href: '#ag-ico-' + name })]);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** kind: blue(추가) · green(갱신·확정) · red(반려·비활성·제외·취소) · orange(선택 구분) · plain */
  function button(o) {
    var b = h('button', {
      type: 'button',
      class: 'ag-btn ag-btn--' + (o.kind || 'plain') + (o.className ? ' ' + o.className : ''),
      disabled: !!o.disabled,
      title: o.title || null,
      'aria-label': o.ariaLabel || null,
      onclick: o.onClick || null
    });
    if (o.icon) b.appendChild(icon(o.icon));
    append(b, o.labelKey ? t(o.labelKey, o.labelParams) : o.label);
    return b;
  }

  /** A-RMS section.widget 구조 대응: section > header > h4 + controls, div.body */
  function widget(titleKey, opts) {
    opts = opts || {};
    var controls = h('div', { class: 'aiagent-widget-controls' });
    var body = h('div', { class: 'body' });
    var el = h('section', { class: 'aiagent-widget' + (opts.className ? ' ' + opts.className : ''), id: opts.id || null }, [
      h('header', null, [h('h4', null, opts.title != null ? opts.title : t(titleKey)), controls]),
      body
    ]);
    return { el: el, body: body, controls: controls };
  }

  // ── 토스트(alert 대체, A-RMS jNotify 대응) ──
  function toast(kind, text) {
    var root = document.getElementById('aiagent_toast_root');
    if (!root || !text) return;
    var el = h('div', { class: 'ag-toast ag-toast--' + (kind || 'info'), role: kind === 'error' ? 'alert' : 'status' }, text);
    root.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, 4000);
  }

  // ── 모달 ──
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function modal(o) {
    var root = document.getElementById('aiagent_modal_root');
    var prevFocus = document.activeElement;
    var titleId = 'ag_modal_title_' + Date.now().toString(36);
    var bodyEl = h('div', { class: 'ag-modal-body' });
    var footer = h('div', { class: 'ag-modal-footer' });
    var closeBtn = h('button', { type: 'button', class: 'ag-modal-x', 'aria-label': t('aiagent.common.close'), title: t('aiagent.common.close') }, [icon('close')]);
    var dialog = h('div', { class: 'ag-modal' + (o.className ? ' ' + o.className : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      h('div', { class: 'ag-modal-header' }, [h('h3', { id: titleId }, o.title != null ? o.title : t(o.titleKey)), closeBtn]),
      bodyEl,
      footer
    ]);
    var backdrop = h('div', { class: 'ag-modal-backdrop' }, [dialog]);
    var closed = false;
    var api = { el: dialog, body: bodyEl, buttons: [] };

    api.close = function (reason) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
      if (o.onClose) o.onClose(reason);
    };

    api.setDisabled = function (index, disabled) {
      if (api.buttons[index]) api.buttons[index].disabled = !!disabled;
    };

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        api.close('esc');
      } else if (e.key === 'Tab') {
        var items = Array.prototype.filter.call(dialog.querySelectorAll(FOCUSABLE), function (x) {
          return x.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    closeBtn.addEventListener('click', function () {
      api.close('x');
    });
    backdrop.addEventListener('mousedown', function (e) {
      if (e.target === backdrop) api.close('backdrop');
    });

    if (typeof o.body === 'function') o.body(bodyEl, api);
    else append(bodyEl, o.body);

    (o.actions || [{ labelKey: 'aiagent.common.close', kind: 'plain', close: true }]).forEach(function (a) {
      var b = button({
        labelKey: a.labelKey,
        kind: a.kind,
        disabled: a.disabled,
        title: a.title,
        onClick: function () {
          if (a.onClick) a.onClick(api);
          if (a.close) api.close('action');
        }
      });
      api.buttons.push(b);
      footer.appendChild(b);
    });

    root.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    var focusTarget = dialog.querySelector('[autofocus]') || dialog.querySelector(FOCUSABLE);
    if (focusTarget) focusTarget.focus();
    return api;
  }

  /** 사유 입력(반려·제외·취소·확정 해제). 공백이면 확인 비활성(AGT-VAL-004 사전 차단). 취소 시 null. */
  function reasonPrompt(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var done = false;
      var area = h('textarea', { class: 'ag-input', rows: '4', id: 'ag_reason_input', autofocus: true });
      var hint = h('p', { class: 'ag-hint' }, t('aiagent.common.reasonRequired'));
      var m = modal({
        titleKey: o.titleKey || 'aiagent.common.reason',
        body: [h('label', { for: 'ag_reason_input', class: 'ag-label' }, t('aiagent.common.reason')), area, o.required !== false ? hint : null],
        actions: [
          { labelKey: 'aiagent.common.cancel', kind: 'plain', close: true },
          {
            labelKey: 'aiagent.common.confirm',
            kind: o.kind || 'red',
            disabled: o.required !== false,
            onClick: function (api) {
              done = true;
              api.close('ok');
              resolve(area.value.trim());
            }
          }
        ],
        onClose: function () {
          if (!done) resolve(null);
        }
      });
      area.addEventListener('input', function () {
        if (o.required !== false) m.setDisabled(1, !area.value.trim());
      });
    });
  }

  /**
   * 확정 해제(API-207, SCR-05 · SCR-06 공용): 사유 입력 → 호출 → 단계 재조회 → 결과 모달(해제 단계 · 재확정 대상).
   * o = {sid, stage: 'REVIEW'|'SRS_CONFIRM'|'SDS_CONFIRM', titleKey} → Promise<응답 | null(취소 · 실패)>
   */
  function releaseStage(o) {
    function stageName(code) {
      var d = A.config.stages.filter(function (s) {
        return s.code === code;
      })[0];
      return d ? t('aiagent.flow.stage.' + d.no + '.short') : code;
    }
    return reasonPrompt({ titleKey: o.titleKey }).then(function (reason) {
      if (reason == null) return null;
      return A.api.request('DELETE', '/sessions/' + o.sid + '/stages/' + o.stage + '/confirm', { reason: reason }).then(
        function (res) {
          return A.flow.reload().then(function () {
            return new Promise(function (resolve) {
              modal({
                titleKey: o.titleKey,
                body: h('p', null, t('aiagent.review.released', {
                  list: (res.released || []).map(stageName).join(', ') || t('aiagent.common.none'),
                  list2: (res.markedForReconfirm || []).map(function (id) {
                    return fmt.shortId(id);
                  }).join(', ') || t('aiagent.common.none')
                })),
                onClose: function () {
                  resolve(res);
                }
              });
            });
          });
        },
        function (err) {
          toast('error', A.api.errorMessage(err));
          return null;
        }
      );
    });
  }

  // ── 상태 배지 ──
  var TONE = {
    COMPLETED: 'done', RUNNING: 'normal', WAITING: 'warn', LOCKED: 'muted',
    HIGH: 'crit', MEDIUM: 'warn', LOW: 'normal',
    OPEN: 'warn', ACCEPTED: 'done', REJECTED: 'muted', HELD: 'normal',
    QUEUED: 'muted', SUCCEEDED: 'done', FAILED: 'crit', CANCELLED: 'muted', NONE: 'muted',
    ERROR: 'crit', WARNING: 'warn', RETRY: 'warn', DONE: 'done'
  };

  function badge(group, code, opts) {
    opts = opts || {};
    var tone = opts.tone || TONE[code] || 'muted';
    return h('span', { class: 'ag-badge ag-tone--' + tone + (opts.outline ? ' ag-badge--outline' : ''), 'data-code': code, title: opts.title || null }, opts.text != null ? opts.text : A.i18n.label(group, code));
  }

  function errorCard(el, err, onRetry) {
    clear(el);
    var details = err && err.details && err.details.length ? h('ul', { class: 'ag-error-details' }, err.details.map(function (d) {
      return h('li', null, String(d));
    })) : null;
    var card = h('div', { class: 'ag-error-card', role: 'alert' }, [
      h('div', { class: 'ag-error-title' }, [icon('alert'), t('aiagent.common.errorArea')]),
      h('p', { class: 'ag-error-msg' }, [A.api.errorMessage(err), err && err.code && err.code !== 'UNKNOWN' ? h('code', { class: 'ag-error-code' }, err.code) : null]),
      details,
      onRetry ? button({ labelKey: 'aiagent.common.retry', kind: 'plain', onClick: onRetry }) : null
    ]);
    el.appendChild(card);
    return card;
  }

  function loading(el) {
    clear(el);
    el.appendChild(h('div', { class: 'ag-loading', role: 'status' }, [h('span', { class: 'ag-spinner', 'aria-hidden': 'true' }), t('aiagent.common.loading')]));
  }

  function empty(text) {
    return h('div', { class: 'ag-empty' }, text != null ? text : t('aiagent.common.empty'));
  }

  // ── 표(정렬, 가로 스크롤 래퍼) ──
  function table(o) {
    var state = { key: o.sortKey || null, dir: 1 };
    var rows = (o.rows || []).slice();
    var tbody = h('tbody');
    var headRow = h('tr');
    var tableEl = h('table', { class: 'ag-table' + (o.className ? ' ' + o.className : '') }, [h('thead', null, headRow), tbody]);
    var wrap = h('div', { class: 'ag-table-wrap' }, tableEl);

    function value(row, col) {
      return col.sortValue ? col.sortValue(row) : row[col.key];
    }

    function renderBody() {
      clear(tbody);
      var list = rows.slice();
      if (state.key) {
        var col = o.columns.filter(function (c) {
          return c.key === state.key;
        })[0];
        list.sort(function (a, b) {
          var x = value(a, col);
          var y = value(b, col);
          if (x == null) x = '';
          if (y == null) y = '';
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.dir;
          return String(x).localeCompare(String(y), undefined, { numeric: true }) * state.dir;
        });
      }
      if (!list.length) {
        tbody.appendChild(h('tr', null, h('td', { colspan: String(o.columns.length), class: 'ag-td-empty' }, o.emptyText || t('aiagent.common.empty'))));
        return;
      }
      list.forEach(function (row) {
        var tr = h('tr', { class: o.rowClass ? o.rowClass(row) : null });
        if (o.onRowClick) {
          tr.classList.add('is-clickable');
          tr.addEventListener('click', function (e) {
            if (e.target.closest('button,a,input,select,textarea,label')) return;
            o.onRowClick(row, tr);
          });
        }
        o.columns.forEach(function (c) {
          var td = h('td', { class: c.className || null });
          var out = c.render ? c.render(row, td) : row[c.key];
          append(td, out);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    o.columns.forEach(function (c) {
      var label = c.label != null ? c.label : t(c.labelKey);
      var th = h('th', { scope: 'col', class: c.className || null });
      if (c.sortable) {
        var btn = h('button', { type: 'button', class: 'ag-sort' }, [label, h('span', { class: 'ag-sort-ind', 'aria-hidden': 'true' })]);
        btn.addEventListener('click', function () {
          state.dir = state.key === c.key ? -state.dir : 1;
          state.key = c.key;
          Array.prototype.forEach.call(headRow.querySelectorAll('th'), function (x) {
            x.removeAttribute('aria-sort');
          });
          th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
          renderBody();
        });
        th.appendChild(btn);
      } else {
        th.textContent = label;
      }
      headRow.appendChild(th);
    });

    renderBody();
    return {
      el: wrap,
      table: tableEl,
      setRows: function (next) {
        rows = (next || []).slice();
        renderBody();
      }
    };
  }

  // ── 포맷 ──
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  var fmt = {
    dt: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },
    duration: function (ms) {
      if (ms == null || isNaN(ms) || ms < 0) return '';
      var s = Math.floor(ms / 1000);
      return Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    },
    shortId: function (id, n) {
      return id == null ? '' : String(id).slice(0, n || 8);
    },
    bytes: function (n) {
      if (n == null) return '';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    }
  };

  /** 클라이언트 파일 저장(Blob) */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, class: 'ag-hidden' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.parentNode.removeChild(a);
    }, 0);
  }

  A.ui = {
    h: h,
    svg: svg,
    icon: icon,
    clear: clear,
    button: button,
    widget: widget,
    toast: toast,
    modal: modal,
    reasonPrompt: reasonPrompt,
    releaseStage: releaseStage,
    badge: badge,
    toneOf: function (code) {
      return TONE[code] || 'muted';
    },
    errorCard: errorCard,
    loading: loading,
    empty: empty,
    table: table,
    fmt: fmt,
    download: download
  };
})(window);
