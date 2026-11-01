/*
 * HOLIX reader: loads one story and shows it as a book.
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
  var pdfDoc = null;      // set when the story is an uploaded PDF
  var pdfImgs = [];       // rendered image for each PDF page

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
      h('span', { text: 'HOLIX · ' + article.category }),
      h('span', { class: 'page__num', text: String(index) }));
  }

  function coverPage() {
    var c = AV.catByName(article.category);
    var page = h('section', { class: 'page page--cover ' + c.tx });
    if (article.cover) page.append(h('img', { src: article.cover, alt: '' }));
    page.append(
      h('div', { class: 'cover__shade' }),
      h('div', { class: 'cover__top' },
        h('span', { class: 'cover__mark', text: 'HOLIX' }),
        h('span', { class: 'tag', text: fmtDate(article.publishedAt || article.updatedAt) })),
      h('div', { class: 'cover__bottom' },
        h('span', { class: 'tag', text: article.category }),
        h('h1', { class: 'cover__title', text: article.title }),
        h('p', { class: 'cover__line', text: 'Beyond the canvas' }))
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
        h('p', { class: 'col-p', text: 'HOLIX celebrates contemporary art and the people who make it. Every work and fact we publish is labelled Official, Verified or Our view, so you always know where it came from.' })),
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
        h('span', { class: 'cover__mark', text: 'HOLIX' }),
        h('p', { class: 'back__line', text: 'Beyond the canvas.' })));
  }

  // Cover, title page, content, optional filler, end page, back cover.
  function makePages(m) {
    if (pdfDoc) return makePdfPages(m);
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
      if (pdfDoc) {
        // A PDF page keeps its own shape, so there is no empty strip above or below it.
        pageH = pageW / PAGE_RATIO;
        if (pageH > availH) { pageH = availH; pageW = pageH * PAGE_RATIO; }
      } else {
        pageH = Math.min(availH, pageW * 1.62);
      }
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
    if (pdfDoc) pdfSync();
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
      if (pdfDoc) Object.keys(pdfImgs).forEach(function (k) { releasePdfPage(Number(k)); });
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
      h('a', { class: 'link', href: '/', text: 'Back to HOLIX' })));
  }

  /* ---------- PDF issues: each PDF page becomes a book page ---------- */

  var PDFJS_VER = '3.11.174';
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('Could not load the PDF reader.')); };
      document.head.appendChild(el);
    });
  }

  function pdfPage(i) {
    var img = h('img', { alt: 'Page ' + (i + 1), draggable: 'false', decoding: 'async' });
    if (pdfImgs[i]) img.src = pdfImgs[i];
    var page = h('section', { class: 'page page--pdf' }, img);
    page._img = img;
    return page;
  }

  function makePdfPages(m) {
    var els = [];
    for (var i = 0; i < pdfDoc.numPages; i++) els.push(pdfPage(i));
    // On wide screens the book needs an even number of pages; a blank back cover fills the gap.
    if (m.spread && els.length % 2 === 1) els.push(h('section', { class: 'page page--pdf page--pdf-blank' }));
    return els;
  }

  /*
   * Only the pages near the reader are kept as images. Rendering a whole magazine at once
   * runs a phone out of memory and the browser tab crashes, so pages are drawn on demand
   * and released again once they are far away.
   */
  var pdfQueue = [];
  var pdfRunning = false;

  function pdfTargetWidth() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.ceil((book && book.pages.length ? parseInt(wrap.style.getPropertyValue('--page-w'), 10) || 480 : 480) * dpr);
    return Math.max(500, Math.min(w, 1000));
  }

  function setPdfImg(i, url) {
    if (!book || !book.pages[i] || !book.pages[i]._img) return;
    if (url) book.pages[i]._img.src = url; else book.pages[i]._img.removeAttribute('src');
  }

  function releasePdfPage(i) {
    if (pdfImgs[i] && pdfImgs[i].indexOf('blob:') === 0) URL.revokeObjectURL(pdfImgs[i]);
    delete pdfImgs[i];
    setPdfImg(i, null);
  }

  function renderOne(i) {
    if (pdfDoc.images) return Promise.resolve(pdfDoc.images[i]);
    return pdfDoc.getPage(i + 1).then(function (pg) {
      var vp1 = pg.getViewport({ scale: 1 });
      var vp = pg.getViewport({ scale: pdfTargetWidth() / vp1.width });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      return pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            var url = blob ? URL.createObjectURL(blob) : '';
            canvas.width = canvas.height = 0; // hand the canvas memory straight back
            if (pg.cleanup) pg.cleanup();
            resolve(url);
          }, 'image/jpeg', 0.85);
        });
      });
    });
  }

  function pumpPdf() {
    if (pdfRunning || !pdfQueue.length || !pdfDoc) return;
    var i = pdfQueue.shift();
    if (pdfImgs[i]) { pumpPdf(); return; }
    pdfRunning = true;
    renderOne(i).then(function (url) {
      if (url) { pdfImgs[i] = url; setPdfImg(i, url); }
    }).catch(function (e) {
      console.warn('Could not draw PDF page ' + (i + 1), e);
    }).then(function () {
      pdfRunning = false;
      pumpPdf();
    });
  }

  // Work out which pages are needed now, draw those, and let go of far-away ones.
  function pdfSync() {
    if (!pdfDoc || !book) return;
    var n = pdfDoc.numPages;
    var vis = book.visiblePages().filter(function (i) { return i < n; });
    if (!vis.length) vis = [n - 1];
    var span = book.spread ? 3 : 2;
    var lo = Math.max(0, Math.min.apply(null, vis) - span);
    var hi = Math.min(n - 1, Math.max.apply(null, vis) + span);

    Object.keys(pdfImgs).forEach(function (k) {
      var i = Number(k);
      if (i < lo - 1 || i > hi + 1) releasePdfPage(i);
    });

    var order = [];
    vis.forEach(function (i) { order.push(i); });
    for (var d = 1; d <= span; d++) {
      var after = Math.max.apply(null, vis) + d;
      var before = Math.min.apply(null, vis) - d;
      if (after <= hi) order.push(after);
      if (before >= lo) order.push(before);
    }
    pdfQueue = order.filter(function (i) { return !pdfImgs[i]; });
    pumpPdf();
  }

  function startPdfBook() {
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
    pdfSync();
  }

  // Preferred: the page pictures made when the PDF was uploaded. Light on every device.
  function openPageImages(urls) {
    note.textContent = 'Loading the magazine…';
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('First page would not load.')); };
      im.src = urls[0];
    }).then(function (im) {
      PAGE_RATIO = im.naturalWidth / im.naturalHeight;
      pdfDoc = { numPages: urls.length, images: urls };
      startPdfBook();
    });
  }

  // Older issues with no page pictures: read the PDF itself (heavy, may fail on phones).
  function openPdfBook(url) {
    note.textContent = 'Loading the magazine…';
    return loadScript(PDFJS_BASE + 'pdf.min.js').then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
      return window.pdfjsLib.getDocument({ url: url }).promise;
    }).then(function (doc) {
      pdfDoc = doc;
      return doc.getPage(1);
    }).then(function (pg) {
      var vp = pg.getViewport({ scale: 1 });
      PAGE_RATIO = vp.width / vp.height;
      startPdfBook();
    });
  }

  // Fallback if the PDF cannot be turned into a book: show it in the browser's own viewer.
  function showPdf(url) {
    controls.hidden = true;
    note.hidden = true;
    wrap.hidden = true;
    stage.classList.add('stage--pdf');
    setBackLink();
    closeEl.addEventListener('click', function (e) { e.preventDefault(); leaveTo(closeEl.getAttribute('href') || '/'); });
    stage.append(h('div', { class: 'pdf-frame' },
      h('iframe', { src: url + '#view=FitH', title: article.title, class: 'pdf-frame__view' }),
      h('a', { class: 'link pdf-frame__open', href: url, target: '_blank', rel: 'noopener', text: 'Open or download the PDF' })));
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

  /* ---------- who is reading ---------- */

  var READER_KEY = 'holix_reader';

  function savedReader() {
    try {
      var r = JSON.parse(localStorage.getItem(READER_KEY) || 'null');
      return r && r.name && r.email ? r : null;
    } catch (e) { return null; }
  }

  function askReader() {
    controls.hidden = true;
    note.hidden = true;
    return new Promise(function (resolve) {
      var nameIn = h('input', { type: 'text', id: 'g-name', autocomplete: 'name', maxlength: '80', placeholder: 'Your name', required: '' });
      var mailIn = h('input', { type: 'email', id: 'g-email', autocomplete: 'email', maxlength: '200', placeholder: 'you@example.com', required: '' });
      var err = h('p', { class: 'gate__err', role: 'alert' });
      var form = h('form', { class: 'reader-gate', novalidate: '' },
        h('span', { class: 'tag', text: 'Before you read' }),
        h('h1', { text: 'Who is reading?' }),
        h('p', { class: 'gate__p', text: 'Tell us your name and email once. Each reader is counted one time, however often you come back.' }),
        h('label', { for: 'g-name', text: 'Name' }), nameIn,
        h('label', { for: 'g-email', text: 'Email' }), mailIn,
        err,
        h('button', { type: 'submit', class: 'gate__btn', text: 'Start reading' }));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = nameIn.value.trim();
        var email = mailIn.value.trim().toLowerCase();
        if (name.length < 2) { err.textContent = 'Please enter your name.'; nameIn.focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Please enter a valid email address.'; mailIn.focus(); return; }
        var reader = { name: name.slice(0, 80), email: email };
        try { localStorage.setItem(READER_KEY, JSON.stringify(reader)); } catch (x) { /* ignore */ }
        form.remove();
        resolve(reader);
      });
      stage.append(form);
      nameIn.focus();
    });
  }

  // Signed-in editors read freely and are never counted.
  function readerGate() {
    return AVD.getSession().catch(function () { return null; }).then(function (session) {
      if (session) return null;
      return savedReader() || askReader();
    });
  }

  function openStory() {
    controls.hidden = false;
    note.hidden = false;
    if (article.pdfUrl) {
      return (article.pdfPages && article.pdfPages.length ? openPageImages(article.pdfPages)
        : (window.innerWidth < 880 ? Promise.reject(new Error('No page pictures for this issue yet.')) : openPdfBook(article.pdfUrl))).catch(function (err) {
        console.error('PDF book failed:', err);
        if (book) { book.destroy(); book = null; }
        pdfDoc = null;
        showPdf(article.pdfUrl);
      });
    }

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
      
      // Update page title and text references to Holix
      document.title = article.title + ' | HOLIX';
      titleEl.textContent = (article.status !== 'published' ? 'Draft preview · ' : '') + article.title;

      // Readers of a published issue give their name and email once; each reader counts once per issue.
      var published = article.status === 'published';
      return (published ? readerGate() : Promise.resolve(null)).then(function (reader) {
        if (reader && article.id) AVD.recordView(article.id, reader);
        return openStory();
      });
    }).catch(function (err) {
      if (err && err.status === 404) showError('Story not found', 'This story is not published, or the link is wrong.');
      else showError('Could not open the story', 'Check your connection and try again.');
    });
  }

  start();
})();