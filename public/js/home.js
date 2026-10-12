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
    var box = document.getElementById('diptych');
    ['Exterior', 'Interior'].forEach(function (name) {
      var c = AV.catByName(name);
      var latest = latestIn(list, name);
      var panel = h('a', { class: 'photo panel ' + c.tx, href: '/section/' + c.slug },
        latest && latest.cover ? h('img', { src: latest.cover, alt: '' }) : null,
        h('div', { class: 'panel-text' },
          h('span', { class: 'tag', text: 'Section' }),
          h('h3', { text: name }),
          h('p', { text: c.blurb }),
          h('span', { class: 'link', text: 'See all ' + name.toLowerCase() + ' stories' })
        )
      );
      box.append(panel);
    });
  }

  function renderIndex(list) {
    var box = document.getElementById('index');
    ['Custom Builds', 'Designers & Brands', 'Concepts', 'Features'].forEach(function (name) {
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
      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.value })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (res.ok) { msg.textContent = 'You are on the list. Thank you.'; form.reset(); }
        else msg.textContent = res.j.error || 'Something went wrong. Try again.';
      }).catch(function () { msg.textContent = 'Could not reach the server. Try again.'; });
    });
  }

  AV.api('/api/articles').catch(function () { return []; }).then(function (list) {
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
// Ensure "Read the latest" and navigation links unhide sections and scroll smoothly
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;

  const targetId = link.getAttribute('href').slice(1);
  const targetSection = document.getElementById(targetId);

  if (targetSection) {
    e.preventDefault();
    // Unhide section if hidden
    targetSection.hidden = false;
    targetSection.scrollIntoView({ behavior: 'smooth' });
    
    // Update hash cleanly without reloading or causing a 404
    history.pushState(null, '', `#${targetId}`);
  }
});
// Example in public/js/home.js:
const heroLink = document.getElementById('hero-link');
if (heroLink) {
  heroLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/read'; // Navigate to reader page
  });
}
// Attach listener to build cards dynamically
const buildsList = document.getElementById('builds-list');
if (buildsList) {
  buildsList.addEventListener('click', (e) => {
    const card = e.target.closest('.build-card, .story-card');
    if (card) {
      e.preventDefault();
      const storyId = card.dataset.storyId;
      
      // Call your 3D book modal function from book.js / common.js
      if (typeof openBookReader === 'function') {
        openBookReader(storyId);
      }
    }
  });
}