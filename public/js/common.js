/* HOLIX shared helpers: categories, small DOM builder, header, footer, cards */
/* HOLIX shared helpers: categories, DOM builder, header, footer, cards */
(function () {
  'use strict';

  var CATS = [
    { name: 'Issues', slug: 'issues', tx: 'tx-paint', blurb: 'Full digital magazine editions and structured publications.' },
    { name: 'Feature Fridays', slug: 'feature-fridays', tx: 'tx-grid', blurb: 'Weekly featured editorial spotlights and deep dives.' },
    { name: 'Visual Art', slug: 'visual-art', tx: 'tx-paint', blurb: 'Paintings, sculptures, mixed media, and contemporary works.' },
    { name: 'Installations', slug: 'installations', tx: 'tx-metal', blurb: 'Site-specific works, spatial experiences, and large-scale pieces.' },
    { name: 'Curated Spaces', slug: 'curated-spaces', tx: 'tx-grid', blurb: 'Bespoke interiors, galleries, and architectural environments.' },
    { name: 'Exhibitions', slug: 'exhibitions', tx: 'tx-leather', blurb: 'Features on milestone shows, curators, and cultural institutions.' }
  ];

  // (Keep the rest of your common.js helper methods intact...)

  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      for (var j = 0; j < kids.length; j++) {
        var kid = kids[j];
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(kid));
      }
    }
    return el;
  }

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function catByName(name) {
    return CATS.filter(function (c) { return c.name === name; })[0] || CATS[5];
  }
  function catBySlug(slug) {
    return CATS.filter(function (c) { return c.slug === slug; })[0] || null;
  }

  function photo(article, extra) {
    var c = catByName(article.category);
    var d = h('div', { class: 'photo ' + c.tx + (extra ? ' ' + extra : '') });
    if (article.cover) d.append(h('img', { src: article.cover, alt: '', loading: 'lazy' }));
    return d;
  }

  function meta(a) {
    return a.minutes + ' min read';
  }

  function card(a, lead) {
    return h('a', { class: 'story' + (lead ? ' story--lead' : ''), href: '/read/' + a.slug, 'data-book': '' },
      photo(a),
      h('div', { class: 'story-body' },
        h('span', { class: 'tag', text: a.category }),
        h('h3', { text: a.title }),
        a.dek ? h('p', { text: a.dek }) : null,
        h('span', { class: 'meta', text: meta(a) }),
        h('span', { class: 'link', text: 'Open the story' })
      )
    );
  }

  function row(a) {
    return h('a', { class: 'row', href: '/read/' + a.slug, 'data-book': '' },
      photo(a),
      h('h3', { text: a.title }),
      h('span', { class: 'tag', text: a.category })
    );
  }

  function mountChrome(active) {
    var header = document.getElementById('site-header');
    if (header) {
      var nav = h('nav', { 'aria-label': 'Sections' });
      CATS.forEach(function (c) {
        nav.append(h('a', { href: '/section/' + c.slug, 'aria-current': c.slug === active ? 'page' : null, text: c.name }));
      });
      header.className = 'site';
      header.append(h('div', { class: 'wrap bar' },
        h('a', { class: 'wordmark', href: '/', 'aria-label': 'HOLIX home', text: 'HOLIX' }),
        nav
      ));
    }
    var footer = document.getElementById('site-footer');
    if (footer) {
      var list = h('ul');
      CATS.forEach(function (c) { list.append(h('li', null, h('a', { href: '/section/' + c.slug, text: c.name }))); });
      footer.append(h('div', { class: 'wrap foot' },
        h('div', null,
          h('a', { class: 'wordmark', href: '/', text: 'HOLIX' }),
          h('p', { class: 'tagline', text: 'Beyond the canvas.' })
        ),
        h('div', null, h('span', { class: 'tag', text: 'Sections' }), list),
        h('div', null,
          h('span', { class: 'tag', text: 'Editorial' }),
          h('p', { text: 'Editorial independence comes first. Sponsored content is always labelled. © ' + new Date().getFullYear() + ' HOLIX.' })
        )
      ));
    }
  }

  // Fade the page out before opening a story, so the book appears to open.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-book]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(function () { window.location.href = a.href; }, 320);
  });

  window.AV = { CATS: CATS, h: h, api: api, catByName: catByName, catBySlug: catBySlug, photo: photo, card: card, row: row, meta: meta, mountChrome: mountChrome };
})();