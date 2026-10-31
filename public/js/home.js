/* AUTOVANT homepage: fills the page from the features you publish */
(function () {
  'use strict';
  var h = AV.h;
  AV.mountChrome('');

  function latestIn(list, category) {
    return list.filter(function (a) { return a.category === category; })[0] || null;
  }

  function renderCover(hero) {
    var cover = document.getElementById('cover');
    var link = document.getElementById('hero-link');
    if (!hero) {
      cover.removeAttribute('href');
      link.hidden = true;
      return;
    }
    cover.href = '/read/' + hero.slug;
    cover.setAttribute('data-book', '');
    link.hidden = false;
    link.href = '/read/' + hero.slug;
    link.setAttribute('data-book', '');
    link.textContent = 'Open the cover story';
    document.getElementById('cover-tag').textContent = 'Cover story · ' + hero.category;
    document.getElementById('cover-title').textContent = hero.title;
    if (hero.cover) {
      cover.classList.add('has-img');
      cover.insertBefore(h('img', { src: hero.cover, alt: '' }), cover.firstChild);
    }
  }

  // The two section cards. They start with the built-in art pictures; the editor can replace them.
  var CARD_ART = { 'issues': '/img/art-issues.svg', 'feature-fridays': '/img/art-fridays.svg' };

  function renderDiptych() {
    var box = document.getElementById('diptych');
    if (!box) return;
    box.textContent = '';
    ['Issues', 'Feature Fridays'].forEach(function (catName) {
      var c = AV.catByName(catName);
      var card = h('a', { class: 'dip-card', href: '/section/' + c.slug, 'data-slug': c.slug },
        h('span', { class: 'tag', text: 'Section' }),
        h('h3', { text: c.name }),
        h('p', { text: c.blurb }),
        h('span', { class: 'link', text: 'See all ' + c.name + ' stories' }));
      card.style.setProperty('--art', 'url("' + CARD_ART[c.slug] + '")');
      box.append(card);
    });
  }

  function applyCardPictures(f) {
    var pics = { 'issues': f.sections.issues, 'feature-fridays': f.sections.fridays };
    Object.keys(pics).forEach(function (slug) {
      var card = document.querySelector('.dip-card[data-slug="' + slug + '"]');
      if (card && pics[slug]) card.style.setProperty('--art', 'url("' + pics[slug] + '")');
    });
  }

  // Featured Artist & Artwork: two pictures the editor sets from the Homepage page of the editor.
  function renderSpotlight(f) {
    var items = [
      { img: f.artist.image, title: f.artist.name, text: f.artist.caption, meta: 'Featured artist' },
      { img: f.artwork.image, title: f.artwork.title, text: f.artwork.caption, meta: 'Featured artwork' }
    ].filter(function (it) { return it.img || it.title; });
    if (!items.length) return;
    var box = document.getElementById('spotlight-list');
    items.forEach(function (it) {
      box.append(h('div', { class: 'tile' },
        h('div', { class: 'photo tx-paint' }, it.img ? h('img', { src: it.img, alt: it.title || it.meta, loading: 'lazy' }) : null),
        it.title ? h('h3', { text: it.title }) : null,
        it.text ? h('p', { text: it.text }) : null,
        h('span', { class: 'meta', text: it.meta })));
    });
    document.getElementById('spotlight').hidden = false;
  }

  function wireForm() {
    var form = document.getElementById('launch');
    var input = document.getElementById('email');
    var msg = document.getElementById('msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!input.value || !input.checkValidity()) {
        msg.textContent = 'Enter a valid email address.';
        input.focus();
        return;
      }
      msg.textContent = 'Saving…';
      AVD.subscribe(input.value).then(function () {
        msg.textContent = 'You are on the list. Thank you.';
        form.reset();
      }).catch(function (e) { msg.textContent = e.message || 'Something went wrong. Try again.'; });
    });
  }

  AVD.listPublished().catch(function () { return []; }).then(function (list) {
    // Only the story marked as the cover story shows on the homepage.
    var hero = list.filter(function (a) { return a.featured; })[0] || null;
    renderCover(hero);
  });
  renderDiptych();
  AVD.getFeatured().then(function (f) { applyCardPictures(f); renderSpotlight(f); }).catch(function () {});
  wireForm();
})();
