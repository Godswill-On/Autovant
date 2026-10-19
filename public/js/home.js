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

  function renderBuilds(rest) {
    var picks = rest.slice(0, 3);
    if (!picks.length) return;
    var box = document.getElementById('builds-list');
    picks.forEach(function (a, i) { box.append(AV.card(a, i === 0)); });
    document.getElementById('builds').hidden = false;
  }

  function renderDiptych(list) {
    var DIPTYCH_CATS = ['Issues', 'Feature Fridays'];
    var diptychBox = document.getElementById('diptych');
    if (diptychBox) {
      diptychBox.textContent = '';
      DIPTYCH_CATS.forEach(function (catName) {
        var c = AV.catByName(catName);
        var card = AV.h('a', { class: 'dip-card ' + c.tx, href: '/section/' + c.slug },
          AV.h('span', { class: 'tag', text: 'Section' }),
          AV.h('h3', { text: c.name }),
          AV.h('p', { text: c.blurb }),
          AV.h('span', { class: 'link', text: 'See all ' + c.name + ' stories' })
        );
        diptychBox.append(card);
      });
    }
  }

  function renderIndex(list) {
    var box = document.getElementById('index');
    ['Art Work', 'Artists', 'Features'].forEach(function (name) {
      var c = AV.catByName(name);
      var n = list.filter(function (a) { return a.category === name; }).length;
      var latest = latestIn(list, name);
      box.append(h('a', { class: 'tile', href: '/section/' + c.slug },
        h('div', { class: 'photo ' + c.tx }, latest && latest.cover ? h('img', { src: latest.cover, alt: '', loading: 'lazy' }) : null),
        h('h3', { text: name }),
        h('p', { text: c.blurb }),
        h('span', { class: 'meta', text: n === 1 ? '1 story' : n + ' stories' })
      ));
    });
  }

  function renderLatest(rest) {
    var more = rest.slice(3, 11);
    if (!more.length) return;
    var box = document.getElementById('latest-list');
    more.forEach(function (a) { box.append(AV.row(a)); });
    document.getElementById('latest').hidden = false;
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
    var hero = list.filter(function (a) { return a.featured; })[0] || list[0] || null;
    var rest = list.filter(function (a) { return a !== hero; });
    renderCover(hero);
    renderBuilds(rest);
    renderDiptych(list);
    renderIndex(list);
    renderLatest(rest);
  });
  wireForm();
})();
