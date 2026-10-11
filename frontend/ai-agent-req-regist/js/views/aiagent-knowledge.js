/*
 * SCR-10 Knot vault 뷰어 (좌측 메뉴 2) — REQ-F-017 · REQ-IF-003
 * API-503(트리) · 504(문서). 조회 전용: 편집 · 삭제 UI 없음(CON-01).
 * 본문은 core/markdown.js 로 DOM 렌더(HTML 해석 없음). 위키 링크 [[slug]] 는 트리에 같은 파일명이 있으면 내부 링크.
 * 연동 실패(AGT-EXT-001)는 이 view 영역에만 오류 카드로 표시한다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  A.views = A.views || {};

  var TYPE_TONE = { source: 'warn', entity: 'done', concept: 'normal', note: 'muted' };

  function t(key, params) {
    return A.i18n.t(key, params);
  }

  function slugOf(path) {
    return String(path).split('/').pop().replace(/\.md$/i, '');
  }

  function typeBadge(type) {
    var key = 'aiagent.knowledge.type.' + type;
    return A.ui.badge('KNOWLEDGE_TYPE', type, { tone: TYPE_TONE[type] || 'muted', text: A.i18n.has(key) ? t(key) : type });
  }

  function create() {
    var ui = A.ui;
    var alive = false;
    var parts = {};
    var v = { tree: [], bySlug: {}, current: null, query: '' };
    var treeBox = null;
    var searchEl = null;

    // ── 트리 ──
    function buildHierarchy(items) {
      var root = { dirs: {}, files: [] };
      items.forEach(function (it) {
        var segs = it.path.split('/');
        var node = root;
        for (var i = 0; i < segs.length - 1; i++) {
          node = node.dirs[segs[i]] = node.dirs[segs[i]] || { dirs: {}, files: [] };
        }
        node.files.push(it);
      });
      return root;
    }

    function fileButton(it) {
      return ui.h('li', null, ui.h(
        'button',
        {
          type: 'button',
          class: 'ag-tree-file' + (v.current === it.path ? ' is-active' : ''),
          'aria-current': v.current === it.path ? 'true' : null,
          title: it.title + ' — ' + it.path,
          'data-path': it.path,
          onclick: function () {
            open(it.path, true);
          }
        },
        [ui.icon('file'), ui.h('span', { class: 'ag-tree-label' }, it.title), typeBadge(it.type)]
      ));
    }

    function renderNode(node) {
      var ul = ui.h('ul', { class: 'ag-tree-list' });
      Object.keys(node.dirs)
        .sort()
        .forEach(function (name) {
          var d = ui.h('details', { class: 'ag-tree-dir', open: true }, [ui.h('summary', null, [ui.icon('knowledge'), name + '/']), renderNode(node.dirs[name])]);
          ul.appendChild(ui.h('li', null, d));
        });
      node.files
        .slice()
        .sort(function (a, b) {
          return a.path.localeCompare(b.path);
        })
        .forEach(function (it) {
          ul.appendChild(fileButton(it));
        });
      return ul;
    }

    function renderTree() {
      var q = v.query.trim().toLowerCase();
      var items = v.tree.filter(function (it) {
        return !q || it.title.toLowerCase().indexOf(q) >= 0 || it.path.toLowerCase().indexOf(q) >= 0;
      });
      ui.clear(treeBox);
      if (!items.length) {
        treeBox.appendChild(ui.empty(t('aiagent.knowledge.noMatch')));
        return;
      }
      treeBox.appendChild(renderNode(buildHierarchy(items)));
    }

    function markActive() {
      Array.prototype.forEach.call(treeBox.querySelectorAll('.ag-tree-file'), function (b) {
        var on = b.getAttribute('data-path') === v.current;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    }

    function loadTree() {
      ui.loading(parts.tree.body);
      return A.api.request('GET', '/knowledge/tree').then(
        function (tree) {
          if (!alive) return null;
          v.tree = tree || [];
          v.bySlug = {};
          v.tree.forEach(function (it) {
            v.bySlug[slugOf(it.path)] = it.path;
          });
          searchEl = ui.h('input', {
            type: 'search',
            id: 'ag_kn_search',
            class: 'ag-input ag-input--full',
            placeholder: t('aiagent.knowledge.search'),
            'aria-label': t('aiagent.knowledge.search'),
            value: v.query
          });
          searchEl.addEventListener('input', function () {
            v.query = searchEl.value;
            renderTree();
          });
          treeBox = ui.h('nav', { class: 'ag-tree', 'aria-label': t('aiagent.knowledge.tree') });
          ui.clear(parts.tree.body).appendChild(ui.h('div', { class: 'ag-field' }, searchEl));
          parts.tree.body.appendChild(ui.h('p', { class: 'ag-hint' }, t('aiagent.knowledge.fullTextUnavailable')));
          parts.tree.body.appendChild(treeBox);
          renderTree();
          return v.tree;
        },
        function (err) {
          if (!alive) return null;
          ui.errorCard(parts.tree.body, err, reload);
          ui.clear(parts.doc.body).appendChild(ui.empty(t('aiagent.knowledge.select')));
          return null;
        }
      );
    }

    // ── 문서 ──
    function renderDoc(doc, item) {
      var fm = doc.frontmatter || {};
      var body = ui.clear(parts.doc.body);
      var type = fm.type || (item && item.type) || 'note';
      body.appendChild(ui.h('h3', { class: 'ag-doc-title' }, fm.title || (item && item.title) || doc.path));
      body.appendChild(
        ui.h('dl', { class: 'ag-dl' }, [
          ui.h('dt', null, t('aiagent.knowledge.path')),
          ui.h('dd', { class: 'ag-mono' }, 'knot-vault/' + doc.path),
          ui.h('dt', null, t('aiagent.knowledge.updated')),
          ui.h('dd', null, fm.updated || (doc.lastModified ? ui.fmt.dt(doc.lastModified) : '—')),
          ui.h('dt', null, t('aiagent.knowledge.type')),
          ui.h('dd', null, typeBadge(type))
        ])
      );
      var keys = Object.keys(fm);
      if (keys.length) {
        body.appendChild(
          ui.h('details', { class: 'ag-details ag-details--card' }, [
            ui.h('summary', null, t('aiagent.knowledge.frontmatter')),
            ui.h(
              'dl',
              { class: 'ag-dl' },
              keys.map(function (k) {
                var val = fm[k];
                return [ui.h('dt', { class: 'ag-mono' }, k), ui.h('dd', null, Array.isArray(val) ? val.join(', ') : String(val))];
              })
            )
          ])
        );
      }
      var article = ui.h('article', { class: 'ag-md' });
      article.appendChild(
        A.markdown.render(doc.markdown, {
          resolveWiki: function (slug) {
            return Object.prototype.hasOwnProperty.call(v.bySlug, slug);
          },
          onWiki: function (slug) {
            open(v.bySlug[slug], true);
          },
          unresolvedTitle: t('aiagent.knowledge.unresolved')
        })
      );
      body.appendChild(article);
    }

    function open(path, scroll) {
      if (!path) return;
      v.current = path;
      if (treeBox) markActive();
      var item = v.tree.filter(function (it) {
        return it.path === path;
      })[0];
      ui.loading(parts.doc.body);
      A.api.request('GET', '/knowledge/docs', null, { query: { path: path } }).then(
        function (doc) {
          if (!alive || v.current !== path) return;
          renderDoc(doc, item);
          if (scroll) parts.doc.el.scrollIntoView({ block: 'nearest' });
        },
        function (err) {
          if (alive && v.current === path)
            ui.errorCard(parts.doc.body, err, function () {
              open(path);
            });
        }
      );
    }

    function reload() {
      return loadTree().then(function (tree) {
        if (!tree) return;
        var first = v.current || (tree.some(function (it) {
          return it.path === 'index.md';
        }) ? 'index.md' : null);
        if (first) open(first);
        else ui.clear(parts.doc.body).appendChild(ui.empty(t('aiagent.knowledge.select')));
      });
    }

    return {
      mount: function (el, ctx) {
        alive = true;
        v.current = (ctx.params && ctx.params.doc) || null;
        parts.tree = ui.widget('aiagent.knowledge.tree', { className: 'ag-kn-tree' });
        parts.doc = ui.widget('aiagent.knowledge.doc', { className: 'ag-kn-doc' });
        el.appendChild(
          ui.h('div', { class: 'ag-view ag-view--knowledge' }, [
            ui.h('div', { class: 'ag-banner', role: 'note' }, [ui.icon('info'), ui.h('div', null, [ui.h('strong', null, t('aiagent.knowledge.title')), ' — ', t('aiagent.knowledge.subtitle')])]),
            ui.h('div', { class: 'ag-split ag-split--tree' }, [parts.tree.el, parts.doc.el])
          ])
        );
        ui.loading(parts.doc.body);
        reload();
      },
      unmount: function () {
        alive = false;
      }
    };
  }

  A.views.knowledge = {
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
