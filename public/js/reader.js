/*
 * AUTOVANT reader: loads one story and shows it as a book.
 *
 * 1. Fetch the story (and a few related ones for the last page).
 * 2. Measure the text at the real page size and split it into pages (paginate).
 * 3. Build cover, title page, content pages, end page and back cover.
 * 4. Hand the pages to AV.Book, which does the opening and the page turns.
 *
 * All story text goes in with textContent, never innerHTML.
 */
(function () {
  'use strict';
  var h = AV.h;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TURN_MS = reduced ? 0 : 1000;
  var MIN_WORDS = 10; // do not leave fewer words than this at the foot of a page
  var PAGE_RATIO = 0.74; // page width / page height on wide screens

  var stage = document.getElementById('stage');
  var wrap = document.getElementById('book-wrap');
  var note = document.getElementById('r-note');
  var posEl = document.getElementById('r-pos');
  var fillEl = document.getElementById('r-fill');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var titleEl = document.getElementById('r-title');
  var closeEl = document.getElementById('r-close');
  var controls = document.querySelector('.reader-controls');

  var slug = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop());
  var article = null;
  var related = [];
  var book = null;
  var pageCount = 0;
  var sizeKey = '';
  var quietNote = false;

  /* ---------- small helpers ---------- */

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function readMinutes(a) {
    var words = 0;
    a.blocks.forEach(function (b) { if (b.type === 'text') words += b.text.split(/\s+/).filter(Boolean).length; });
    return Math.max(1, Math.round(words / 200));
  }

  var FOCUS = { left: '18% 50%', center: '50% 50%', right: '82% 50%' };
  function focusPos(f) { return FOCUS[f] || FOCUS.center; }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ---------- story blocks -> units ---------- */

  // A "unit" is the smallest thing that can sit on a page: one paragraph, one heading, one picture...
  function makeUnits(blocks) {
    var out = [];
    var leadDone = false;
    blocks.forEach(function (b) {
      if (b.type === 'heading' && b.text) {
        out.push({ kind: 'heading', text: b.text });
      } else if (b.type === 'text') {
        b.text.split(/\n{2,}/).forEach(function (par) {
          par = par.trim();
          if (!par) return;
          out.push({ kind: 'para', text: par, lead: !leadDone });
          leadDone = true;
        });
      } else if (b.type === 'quote' && b.text) {
        out.push({ kind: 'quote', text: b.text, cite: b.cite });
      } else if (b.type === 'image' && b.src) {
        out.push({ kind: b.layout === 'fill' ? 'fill' : (b.layout === 'spread' ? 'spread' : 'fig'), block: b });
      } else if (b.type === 'specs' && b.rows && b.rows.length) {
        out.push({ kind: 'specs', title: b.title, rows: b.rows });
      }
    });
    return out;
  }

  var CHIP = { 'Official': 'chip', 'Verified': 'chip chip--verified', 'Our view': 'chip chip--view' };

  function renderUnit(u) {
    var img;
    switch (u.kind) {
      case 'heading':
        return h('h2', { class: 'b-h', text: u.text });
      case 'para':
        return h('p', { class: 'b-p' + (u.lead ? ' b-p--lead' : '') + (u.cont ? ' b-p--cont' : ''), text: u.text });
      case 'quote':
        return h('blockquote', { class: 'b-quote' }, h('p', { text: u.text }), u.cite ? h('cite', { text: u.cite }) : null);
      case 'fig':
        img = h('img', { src: u.block.src, alt: u.block.alt || '' });
        img.style.objectPosition = focusPos(u.block.focus);
        return h('figure', { class: 'b-fig' },
          h('div', { class: 'b-fig__img' }, img),
          u.block.caption ? h('figcaption', { text: u.block.caption }) : null);
      case 'specs':
        return h('section', { class: 'b-specs' },
          h('div', { class: 'b-specs__head', text: u.title || 'Spec sheet' }),
          h('dl', { class: 'b-specs__list' }, u.rows.map(function (r) {
            return h('div', { class: 'b-spec' },
              h('div', null, h('dt', { text: r.field }), h('dd', { text: r.value })),
              h('span', { class: CHIP[r.source] || 'chip', text: r.source }));
          })));
    }
    return h('div');
  }

  /* ---------- measuring and pagination ---------- */

  function makeMeasurer(spread) {
    var page = h('section', { class: 'page page--measure ' + (spread ? 'page--left' : 'page--right'), 'aria-hidden': 'true' },
      h('div', { class: 'page__body' }));
    wrap.append(page);
    var body = page.firstChild;
    return {
      fits: function (units) {
        body.textContent = '';
        units.forEach(function (u) { body.append(renderUnit(u)); });
        return body.scrollHeight <= body.clientHeight + 1;
      },
      done: function () { page.remove(); }
    };
  }

  function withText(u, text) { return Object.assign({}, u, { text: text }); }

  /*
   * Split units into pages. Returns a list of page descriptions:
   *   { kind: 'text', units: [...] }, { kind: 'fill', block }, { kind: 'spreadL' | 'spreadR', block }
   * Content page n sits at book page n + 2. On wide screens a two-page picture must start on a
   * left (odd-numbered) page, so it is placed where the numbering works out.
   */
  function paginate(units, fits, spreadMode) {
    var out = [];
    var cur = [];
    var pending = [];
    var queue = units.slice();

    function placeSpread(u) {
      out.push({ kind: 'spreadL', block: u.block });
      out.push({ kind: 'spreadR', block: u.block });
    }
    function placePending() {
      while (pending.length && out.length % 2 === 1) placeSpread(pending.shift());
    }
    function pushPage(p) { out.push(p); placePending(); }
    function flush() {
      if (!cur.length) return;
      var carry = [];
      while (cur.length > 1 && cur[cur.length - 1].kind === 'heading') carry.unshift(cur.pop());
      var page = { kind: 'text', units: cur };
      cur = carry;
      pushPage(page);
    }

    function trySplit(u) {
      var lo = 0;
      var hi;
      var mid;
      if (u.kind === 'para') {
        var words = u.text.split(/ +/);
        if (words.length < 2) return null;
        hi = words.length - 1;
        while (lo < hi) {
          mid = Math.ceil((lo + hi) / 2);
          if (fits(cur.concat([withText(u, words.slice(0, mid).join(' '))]))) lo = mid; else hi = mid - 1;
        }
        if (lo < 1 || (cur.length && lo < MIN_WORDS)) return null;
        return {
          head: withText(u, words.slice(0, lo).join(' ')),
          tail: Object.assign({}, u, { text: words.slice(lo).join(' '), lead: false, cont: true })
        };
      }
      if (u.kind === 'specs' && u.rows.length > 1) {
        hi = u.rows.length - 1;
        while (lo < hi) {
          mid = Math.ceil((lo + hi) / 2);
          if (fits(cur.concat([{ kind: 'specs', title: u.title, rows: u.rows.slice(0, mid) }]))) lo = mid; else hi = mid - 1;
        }
        if (lo < 1) return null;
        return {
          head: { kind: 'specs', title: u.title, rows: u.rows.slice(0, lo) },
          tail: { kind: 'specs', title: (u.title || 'Spec sheet') + ' (continued)', rows: u.rows.slice(lo) }
        };
      }
      return null;
    }

    while (queue.length) {
      var u = queue.shift();

      // A two-page picture cannot span two pages on a narrow screen, so it sits inline across the page.
      if (u.kind === 'spread' && !spreadMode) u = Object.assign({}, u, { kind: 'fig' });

      if (u.kind === 'fill') { flush(); pushPage({ kind: 'fill', block: u.block }); continue; }

      if (u.kind === 'spread') {
        if (pending.length) { pending.push(u); continue; }
        if (!cur.length) {
          if (out.length % 2 === 1) placeSpread(u); else pending.push(u);
        } else if (out.length % 2 === 0) {
          flush();
          placeSpread(u);
        } else {
          placeSpread(u);
        }
        continue;
      }

      if (fits(cur.concat([u]))) { cur.push(u); continue; }

      var sp = trySplit(u);
      if (sp) {
        cur.push(sp.head);
        queue.unshift(sp.tail);
        flush();
        continue;
      }
      if (!cur.length) { cur.push(u); flush(); continue; } // too big even alone: keep it, the page clips it
      flush();
      queue.unshift(u);
    }
    flush();
    // A two-page picture that never found a left page becomes a full-page picture.
    while (pending.length) pushPage({ kind: 'fill', block: pending.shift().block });
    return out;
  }

  /* ---------- page builders ---------- */

  function foot(index) {
    return h('div', { class: 'page__foot' },
      h('span', { text: 'Autovant · ' + article.category }),
      h('span', { class: 'page__num', text: String(index) }));
  }

  function coverPage() {
    var c = AV.catByName(article.category);
    var page = h('section', { class: 'page page--cover ' + c.tx });
    if (article.cover) page.append(h('img', { src: article.cover, alt: '' }));
    page.append(
      h('div', { class: 'cover__shade' }),
      h('div', { class: 'cover__top' },
        h('span', { class: 'cover__mark', text: 'Autovant' }),
        h('span', { class: 'tag', text: fmtDate(article.publishedAt || article.updatedAt) })),
      h('div', { class: 'cover__bottom' },
        h('span', { class: 'tag', text: article.category }),
        h('h1', { class: 'cover__title', text: article.title }),
        h('p', { class: 'cover__line', text: 'Beyond the factory' }))
    );
    return page;
  }

  function titlePage(heads) {
    var items = heads.slice(0, 6);
    var body = h('div', { class: 'page__body page__body--title' },
      h('span', { class: 'tag', text: article.category }),
      h('h2', { class: 'title-h', text: article.title }),
      article.dek ? h('p', { class: 'title-dek', text: article.dek }) : null,
      h('p', { class: 'title-meta', text: fmtDate(article.publishedAt || article.updatedAt) + ' · ' + readMinutes(article) + ' min read' }),
      items.length >= 2 ? h('nav', { class: 'toc', 'aria-label': 'In this feature' },
        h('span', { class: 'tag', text: 'In this feature' }),
        h('ol', null, items.map(function (it) {
          return h('li', null, h('button', { type: 'button', class: 'toc__btn', 'data-page': it.index },
            h('span', { text: it.text }), h('span', { class: 'toc__n', text: String(it.index) })));
        }))) : null
    );
    return h('section', { class: 'page page--title' }, body);
  }

  function fillPage(block) {
    var img = h('img', { src: block.src, alt: block.alt || '' });
    img.style.objectPosition = focusPos(block.focus);
    var page = h('section', { class: 'page page--photo page--fill' }, img);
    if (block.caption) page.append(h('p', { class: 'photo-cap', text: block.caption }));
    return page;
  }

  function halfPage(block, side) {
    var img = h('img', { class: 'half-img', src: block.src, alt: side === 'l' ? (block.alt || '') : '' });
    img.style.objectPosition = focusPos(block.focus);
    var page = h('section', { class: 'page page--photo page--half page--half-' + side }, img);
    if (side === 'l' && block.caption) page.append(h('p', { class: 'photo-cap', text: block.caption }));
    return page;
  }

  function colophonPage(index) {
    return h('section', { class: 'page page--colophon' },
      h('div', { class: 'page__body page__body--col' },
        h('span', { class: 'col-mark', text: 'A' }),
        h('p', { class: 'col-p', text: 'Every spec in AUTOVANT is labelled Official, Verified or Our view, so you always know where a fact came from.' })),
      foot(index));
  }

  function endPage(index) {
    var list = related.slice(0, 3).map(function (r) {
      return h('a', { class: 'next-item', href: '/read/' + r.slug, 'data-book': '' },
        h('span', { class: 'tag', text: r.category }),
        h('span', { class: 'next-item__t', text: r.title }));
    });
    return h('section', { class: 'page page--end' },
      h('div', { class: 'page__body page__body--end' },
        h('span', { class: 'end-mark', text: 'End of feature' }),
        h('h2', { class: 'end-h', text: 'Keep reading' }),
        list.length ? h('div', { class: 'next-list' }, list) : h('p', { class: 'end-p', text: 'More features are on their way.' }),
        h('a', { class: 'link', href: '/', text: 'Back to the magazine' })),
      foot(index));
  }

  function backCover() {
    return h('section', { class: 'page page--back tx-leather' },
      h('div', { class: 'back__shade' }),
      h('div', { class: 'back__inner' },
        h('span', { class: 'cover__mark', text: 'Autovant' }),
        h('p', { class: 'back__line', text: 'Beyond the factory.' })));
  }

  // Cover, title page, content, optional filler, end page, back cover.
  function makePages(m) {
    var measurer = makeMeasurer(m.spread);
    var descs = paginate(makeUnits(article.blocks), measurer.fits, m.spread);
    measurer.done();

    var els = [coverPage(), null];
    var heads = [];
    descs.forEach(function (d) {
      var index = els.length;
      var el;
      if (d.kind === 'text') {
        d.units.forEach(function (u) { if (u.kind === 'heading') heads.push({ text: u.text, index: index }); });
        el = h('section', { class: 'page page--text' },
          h('div', { class: 'page__body' }, d.units.map(renderUnit)),
          foot(index));
      } else if (d.kind === 'fill') {
        el = fillPage(d.block);
      } else {
        el = halfPage(d.block, d.kind === 'spreadL' ? 'l' : 'r');
      }
      els.push(el);
    });
    if (m.spread && (els.length + 2) % 2 === 1) els.push(colophonPage(els.length));
    els.push(endPage(els.length));
    els.push(backCover());
    els[1] = titlePage(heads);
    return els;
  }

  /* ---------- sizing ---------- */

  function metrics() {
    var r = stage.getBoundingClientRect();
    var spread = r.width >= 880;
    var availW = Math.max(240, r.width - 32);
    var availH = Math.max(280, r.height - 44); // leaves room for the hint line under the book
    var pageW;
    var pageH;
    if (spread) {
      pageW = Math.min(availW / 2, availH * PAGE_RATIO, 560);
      pageH = pageW / PAGE_RATIO;
    } else {
      pageW = Math.min(availW, 520);
      pageH = Math.min(availH, pageW * 1.62);
    }
    return {
      spread: spread,
      pageW: Math.floor(pageW),
      pageH: Math.floor(pageH),
      key: spread + ':' + Math.floor(pageW) + ':' + Math.floor(pageH)
    };
  }

  /* ---------- building and updating ---------- */

  function build(state, firstPage) {
    if (book) book.destroy();
    var m = metrics();
    sizeKey = m.key;
    wrap.style.setProperty('--page-w', m.pageW + 'px');
    wrap.style.setProperty('--page-h', m.pageH + 'px');
    wrap.style.width = (m.spread ? m.pageW * 2 : m.pageW) + 'px';
    wrap.style.height = m.pageH + 'px';

    var els = makePages(m);
    pageCount = els.length - 1;
    book = new AV.Book(wrap, els, { spread: m.spread, turnMs: TURN_MS, onChange: updateUI });
    if (firstPage != null) book.goTo(book.stateForPage(firstPage), false);
    else if (state) book.goTo(state, false);
    updateUI();
  }

  function updateUI() {
    if (!book) return;
    var s = book.state;
    var label;
    if (s === 0) label = 'Cover';
    else if (book.spread && s === book.leaves.length) label = 'Back cover';
    else if (book.spread) label = 'Pages ' + (2 * s - 1) + '–' + Math.min(2 * s, pageCount) + ' of ' + pageCount;
    else label = 'Page ' + s + ' of ' + pageCount;
    posEl.textContent = label;
    fillEl.style.width = (book.maxState ? (s / book.maxState) * 100 : 0) + '%';
    btnPrev.disabled = s === 0;
    btnNext.disabled = s >= book.maxState;
  }

  function quiet() {
    if (quietNote) return;
    quietNote = true;
    note.classList.add('is-quiet');
  }

  function turn(dir) {
    if (!book) return;
    if (dir > 0) book.next(); else book.prev();
    quiet();
  }

  function leaveTo(url) {
    document.body.classList.add('leaving');
    setTimeout(function () { window.location.href = url; }, 320);
  }

  function closeBook() {
    var url = closeEl.getAttribute('href') || '/';
    if (book && book.state > 0 && !reduced) {
      book.goTo(0, true);
      setTimeout(function () { leaveTo(url); }, TURN_MS + 250);
    } else {
      leaveTo(url);
    }
  }

  /* ---------- input ---------- */

  function wire() {
    btnPrev.addEventListener('click', function () { turn(-1); });
    btnNext.addEventListener('click', function () { turn(1); });
    closeEl.addEventListener('click', function (e) { e.preventDefault(); closeBook(); });

    document.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey || !book) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
      else if (e.key === 'Home') { e.preventDefault(); book.goTo(0, true); quiet(); }
      else if (e.key === 'End') { e.preventDefault(); book.goTo(book.maxState, true); quiet(); }
      else if (e.key === 'Escape') { closeBook(); }
    });

    // Click or tap a page to turn it. Links, buttons and selected text are left alone.
    wrap.addEventListener('click', function (e) {
      if (!book) return;
      var jump = e.target.closest('[data-page]');
      if (jump) { book.goToPage(Number(jump.getAttribute('data-page')), true); quiet(); return; }
      if (e.target.closest('a, button')) return;
      if (window.getSelection && String(window.getSelection())) return;
      var leaf = e.target.closest('.leaf');
      if (!leaf) return;
      if (book.spread) {
        turn(leaf.classList.contains('flipped') ? -1 : 1);
      } else {
        var r = leaf.getBoundingClientRect();
        turn(e.clientX - r.left < r.width * 0.28 ? -1 : 1);
      }
    });

    // Swipe on touch screens.
    var sx = null;
    var sy = 0;
    var st = 0;
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      sx = e.clientX; sy = e.clientY; st = Date.now();
    });
    stage.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse' || sx == null) return;
      var dx = e.clientX - sx;
      var dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 900) turn(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { sx = null; });

    window.addEventListener('resize', debounce(function () {
      if (!book || metrics().key === sizeKey) return;
      build(0, book.visiblePages()[0]);
    }, 250));
  }

  /* ---------- start ---------- */

  function showError(title, text) {
    controls.hidden = true;
    note.hidden = true;
    stage.append(h('div', { class: 'reader-error' },
      h('h1', { text: title }),
      h('p', { text: text }),
      h('a', { class: 'link', href: '/', text: 'Back to AUTOVANT' })));
  }

  function setBackLink() {
    try {
      var ref = new URL(document.referrer);
      if (ref.origin === location.origin && !/^\/(admin|read)(\/|$)/.test(ref.pathname)) {
        closeEl.setAttribute('href', ref.pathname + ref.search + ref.hash);
        closeEl.textContent = 'Close the book';
      }
    } catch (e) { /* no usable referrer: the link stays on the homepage */ }
  }

  function start() {
    var fontsReady = (document.fonts && document.fonts.ready)
      ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1800); })])
      : Promise.resolve();

    Promise.all([
      AVD.getBySlug(slug),
      AVD.listPublished().catch(function () { return []; }),
      fontsReady
    ]).then(function (res) {
      article = res[0];
      related = res[1].filter(function (a) { return a.slug !== article.slug; });
      document.title = article.title + ' | AUTOVANT';
      titleEl.textContent = (article.status !== 'published' ? 'Draft preview · ' : '') + article.title;
      setBackLink();
      wire();
      build(0, null);
      note.textContent = 'Opening the book…';
      setTimeout(function () {
        if (!book || book.state !== 0) return;
        book.goTo(1, true);
        note.textContent = book.spread
          ? 'Click a page, press ← →, or swipe to turn the pages.'
          : 'Tap the page edges or swipe to turn the pages.';
      }, reduced ? 0 : 1100);
    }).catch(function (err) {
      if (err && err.status === 404) showError('Story not found', 'This story is not published, or the link is wrong.');
      else showError('Could not open the story', 'Check your connection and try again.');
    });
  }

  start();
})();
