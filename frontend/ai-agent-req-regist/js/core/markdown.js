/*
 * 최소 마크다운 렌더러(설계서 §3 SCR-10). 외부 라이브러리 없음.
 * 문자열을 HTML 로 해석하지 않고 DOM 노드로만 만든다(textContent — XSS 방지).
 *   AIAGENT.markdown.render(md, {resolveWiki(slug) → bool, onWiki(slug)}) → DocumentFragment
 *   AIAGENT.markdown.frontmatter(text) → {data, body}   (key: value · key: >- 접기 · key: [a, b])
 * 지원: 헤딩 h1~h4(h5·h6 은 h4), 문단, 순서 · 비순서 목록(들여쓰기 중첩), 코드 펜스, 인라인 코드,
 *       굵게 · 기울임, 파이프 표, 인용, 구분선, http(s) 링크(새 창), 위키 링크 [[slug]] · [[slug|별칭]]
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── 인라인 ──
  // 우선순위: 코드 > 위키 링크 > 링크 > 굵게 > 기울임
  var INLINE = /`([^`]+)`|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(^|[^\w])_([^_\s][^_]*)_(?=[^\w]|$)/;

  function inline(text, opts, parent) {
    var rest = String(text);
    while (rest) {
      var m = INLINE.exec(rest);
      if (!m) {
        parent.appendChild(document.createTextNode(rest));
        break;
      }
      var lead = m[9] || '';
      var start = m.index + lead.length;
      if (start > 0) parent.appendChild(document.createTextNode(rest.slice(0, start)));
      if (m[1] != null) {
        parent.appendChild(el('code', null, m[1]));
      } else if (m[2] != null) {
        parent.appendChild(wikiLink(m[2].trim(), (m[3] || m[2]).trim(), opts));
      } else if (m[4] != null) {
        parent.appendChild(link(m[4], m[5], opts));
      } else if (m[6] != null || m[7] != null) {
        inline(m[6] != null ? m[6] : m[7], opts, parent.appendChild(el('strong')));
      } else if (m[8] != null) {
        inline(m[8], opts, parent.appendChild(el('em')));
      } else {
        inline(m[10], opts, parent.appendChild(el('em')));
      }
      rest = rest.slice(m.index + m[0].length);
    }
    return parent;
  }

  function link(label, href, opts) {
    if (/^https?:\/\//i.test(href)) {
      var a = el('a', 'ag-md-link');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return inline(label, opts, a);
    }
    return inline(label, opts, el('span', 'ag-md-link--local')); // 상대 경로 · 기타 스킴은 링크로 만들지 않는다
  }

  function wikiLink(slug, label, opts) {
    var resolved = opts.resolveWiki ? opts.resolveWiki(slug) : false;
    if (!resolved) {
      var s = el('span', 'ag-wikilink ag-wikilink--unresolved', label);
      if (opts.unresolvedTitle) s.title = opts.unresolvedTitle;
      return s;
    }
    var b = el('button', 'ag-wikilink', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (opts.onWiki) opts.onWiki(slug);
    });
    return b;
  }

  // ── 블록 ──
  var RE = {
    fence: /^\s*(```|~~~)\s*([\w+-]*)\s*$/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s*>\s?(.*)$/,
    list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  };

  function cells(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (c) {
      return c.trim();
    });
  }

  function isBlockStart(line, next) {
    return RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.list.test(line) || (/\|/.test(line) && next != null && RE.tableSep.test(next));
  }

  function renderList(lines, i, opts) {
    // 들여쓰기 깊이로 중첩. 항목의 이어지는 줄(들여쓴 일반 텍스트)은 같은 항목에 붙인다.
    var root = null;
    var stack = []; // {indent, el, li}
    while (i < lines.length) {
      var line = lines[i];
      var m = RE.list.exec(line);
      if (!m) {
        if (line.trim() && /^\s+/.test(line) && stack.length) {
          var lastLi = stack[stack.length - 1].li;
          lastLi.appendChild(document.createTextNode(' '));
          inline(line.trim(), opts, lastLi);
          i++;
          continue;
        }
        break;
      }
      var indent = m[1].replace(/\t/g, '    ').length;
      var ordered = /\d/.test(m[2]);
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      var top = stack[stack.length - 1];
      if (!top || indent > top.indent) {
        var listEl = el(ordered ? 'ol' : 'ul', 'ag-md-list');
        if (top && top.li) top.li.appendChild(listEl);
        else if (!root) root = listEl;
        else break;
        stack.push({ indent: indent, el: listEl, li: null });
        top = stack[stack.length - 1];
      }
      var li = el('li');
      var task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      if (task) {
        li.appendChild(document.createTextNode(task[1] === ' ' ? '☐ ' : '☑ '));
        inline(task[2], opts, li);
      } else {
        inline(m[3], opts, li);
      }
      top.el.appendChild(li);
      top.li = li;
      i++;
    }
    return { el: root, next: i };
  }

  function render(md, opts) {
    opts = opts || {};
    var frag = document.createDocumentFragment();
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      var m;
      if ((m = RE.fence.exec(line))) {
        var buf = [];
        i++;
        while (i < lines.length && !(RE.fence.exec(lines[i]) && RE.fence.exec(lines[i])[1] === m[1])) buf.push(lines[i++]);
        i++; // 닫는 펜스
        var pre = el('pre', 'ag-md-pre');
        var code = el('code', null, buf.join('\n'));
        if (m[2]) code.setAttribute('data-lang', m[2]);
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }
      if ((m = RE.heading.exec(line))) {
        var level = Math.min(m[1].length, 4);
        frag.appendChild(inline(m[2], opts, el('h' + level, 'ag-md-h')));
        i++;
        continue;
      }
      if (RE.hr.test(line)) {
        frag.appendChild(el('hr', 'ag-md-hr'));
        i++;
        continue;
      }
      if (RE.quote.test(line)) {
        var q = [];
        while (i < lines.length && RE.quote.test(lines[i])) q.push(RE.quote.exec(lines[i++])[1]);
        var bq = el('blockquote', 'ag-md-quote');
        bq.appendChild(render(q.join('\n'), opts));
        frag.appendChild(bq);
        continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        var head = cells(line);
        i += 2;
        var table = el('table', 'ag-md-table');
        var tr = el('tr');
        head.forEach(function (c) {
          var th = inline(c, opts, el('th'));
          th.scope = 'col';
          tr.appendChild(th);
        });
        table.appendChild(el('thead')).appendChild(tr);
        var tbody = table.appendChild(el('tbody'));
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
          var row = el('tr');
          var cs = cells(lines[i++]);
          for (var c = 0; c < head.length; c++) row.appendChild(inline(cs[c] || '', opts, el('td')));
          tbody.appendChild(row);
        }
        var wrap = el('div', 'ag-table-wrap');
        wrap.appendChild(table);
        frag.appendChild(wrap);
        continue;
      }
      if (RE.list.test(line)) {
        var lst = renderList(lines, i, opts);
        if (lst.el) frag.appendChild(lst.el);
        i = lst.next;
        continue;
      }
      var para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++].trim());
      frag.appendChild(inline(para.join(' '), opts, el('p', 'ag-md-p')));
    }
    return frag;
  }

  function frontmatter(text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    var m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
    if (!m) return { data: {}, body: src };
    var data = {};
    var lines = m[1].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var km = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
      if (!km) continue;
      var v = km[2];
      if (/^[>|]-?$/.test(v)) {
        var buf = [];
        while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
        v = v.charAt(0) === '>' ? buf.join(' ') : buf.join('\n');
      } else if (/^\[.*\]$/.test(v)) {
        v = v
          .slice(1, -1)
          .split(',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
      } else {
        v = v.replace(/^(['"])(.*)\1$/, '$2');
      }
      data[km[1]] = v;
    }
    return { data: data, body: src.slice(m[0].length) };
  }

  A.markdown = { render: render, frontmatter: frontmatter };
})(window);
