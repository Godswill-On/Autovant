/* AUTOVANT section page: lists the published features in one category */
(function () {
  'use strict';
  var slug = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop());
  var cat = AV.catBySlug(slug);
  AV.mountChrome(cat ? cat.slug : '');

  var title = document.getElementById('sec-title');
  var blurb = document.getElementById('sec-blurb');
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');

  if (!cat) {
    title.textContent = 'Not found';
    empty.hidden = false;
    empty.textContent = 'That section does not exist.';
    return;
  }

  document.title = cat.name + ' | HOLIX';
  title.textContent = cat.name;
  blurb.textContent = cat.blurb;

  AVD.listPublished(cat.name).then(function (list) {
    if (!list.length) {
      empty.hidden = false;
      empty.textContent = 'No ' + cat.name.toLowerCase() + ' stories are published yet.';
      return;
    }
    list.forEach(function (a) { grid.append(AV.card(a, false)); });
  }).catch(function () {
    empty.hidden = false;
    empty.textContent = 'Could not load the stories. Try again in a moment.';
  });
})();
