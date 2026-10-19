/*
- HOLIX editor: write features, upload photos, publish.
- Everything typed here is put on the page with textContent or value, never innerHTML.
- Data and photos go straight to Supabase through AVD (js/data.js); the database rules decide who may write.
 */
(function () {
  'use strict';
  var h = AV.h;

  var CATEGORY_NAMES = AV.CATS.map(function (c) { return c.name; });
  var SOURCES = ['Official', 'Verified', 'Our view'];
  var TYPE_LABEL = { heading: 'Heading', text: 'Text', image: 'Photo', quote: 'Pull quote', specs: 'Work Specs' };
  var LAYOUTS = [
    ['fit', 'Inline, with the text'],
    ['fill', 'Full page'],
    ['spread', 'Across two pages (best for wide art photos)']
  ];
  var FOCUS = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var banner = document.getElementById('banner');

  var current = null;   // the feature being edited
  var dirty = false;
  var dirtyEl = null;
  var blocksBox = null;
  var lastHash = location.hash;
  var skipHash = false;
  var toastTimer = 0;

  /* ---------- requests ---------- */

  function sessionEnded() {
    if (banner) {
      banner.hidden = false;
      banner.textContent = '';
      banner.append('Your session has ended. ',
        h('a', { href: '/admin/login.html', target: '_blank', rel: 'noopener', text: 'Sign in again in a new tab' }),
        ', then come back here and save. Your changes are still on this page.');
    }
  }

  function guard(promise) {
    return promise.then(function (v) { 
      if (banner) banner.hidden = true; 
      return v; 
    }, function (e) {
      if (e && e.status === 401) { sessionEnded(); }
      throw e;
    });
  }

  function uploadFile(file) {
    return guard(AVD.upload(file));
  }

  /* ---------- small UI helpers ---------- */

  function toast(text, kind) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.className = 'toast is-on' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, kind === 'error' ? 6500 : 3000);
  }

  function markDirty() {
    dirty = true;
    if (dirtyEl) dirtyEl.hidden = false;
  }

  function fmt(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fld(label, control, hint) {
    return h('label', { class: 'fld' },
      h('span', { class: 'tag', text: label }),
      control,
      hint ? h('span', { class: 'hint', text: hint }) : null);
  }

  function bindInput(el, obj, key) {
    el.value = obj[key] || '';
    el.addEventListener('input', function () { obj[key] = el.value; markDirty(); });
    return el;
  }

  function autoGrow(el) {
    function fit() { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
    el.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return el;
  }

  function select(options, obj, key) {
    var el = h('select', null, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    el.value = obj[key];
    if (el.value !== obj[key]) { el.selectedIndex = 0; obj[key] = el.value; }
    el.addEventListener('change', function () { obj[key] = el.value; markDirty(); });
    return el;
  }

  /* ---------- photo picker ---------- */

  function uploader(src, onChange, label) {
    var preview = h('div', { class: 'up-preview' });
    var status = h('p', { class: 'hint', 'aria-live': 'polite' });
    var input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'file-input' });
    var pick = h('label', { class: 'btn btn--small' }, label || 'Choose photo', input);
    var clear = h('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Remove photo' });

    function show(url) {
      preview.textContent = '';
      if (url) preview.append(h('img', { src: url, alt: 'Selected artwork or photo' }));
      else preview.append(h('span', { class: 'muted', text: 'No photo yet' }));
      clear.hidden = !url;
    }
    clear.addEventListener('click', function () { show(''); onChange(''); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      status.textContent = 'Uploading…';
      uploadFile(file).then(function (url) {
        show(url);
        onChange(url);
        status.textContent = '';
      }).catch(function (e) {
        status.textContent = e.message;
      }).then(function () { input.value = ''; });
    });
    show(src);
    return h('div', { class: 'uploader' }, preview, h('div', { class: 'up-actions' }, pick, clear), status);
  }

  /* ---------- PDF uploader UI (Auto-creates & Auto-saves) ---------- */

  function pdfUploader(pdfUrl, onChange) {
    var status = h('span', { class: 'hint', style: 'display:block; margin-top:6px; word-break:break-all;', text: pdfUrl ? '✓ PDF attached' : 'No PDF attached' });
    var input = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'file-input' });
    var pick = h('label', { class: 'btn btn--small btn--ghost', style: 'width:100%; text-align:center;' }, pdfUrl ? 'Replace PDF Issue' : 'Upload PDF Issue', input);

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      var sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      status.textContent = 'Uploading PDF (' + sizeMb + ' MB)… Please wait.';

      uploadFile(file)
        .then(function (url) {
          onChange(url);
          status.textContent = '✓ Uploaded (' + sizeMb + ' MB). Creating issue record...';

          // Extract title from filename (e.g. "Holix Issue 03" from "Holix_Issue_03.pdf")
          var rawName = file.name.replace(/\.[^/.]+$/, "");
          var autoTitle = current.title && current.title.trim() ? current.title.trim() : rawName.replace(/[-_]/g, ' ');

          current.title = autoTitle;
          current.pdf_url = url;
          current.category = current.category || 'Issues';
          current.status = 'published';

          // Instantly save to database!
          return save();
        })
        .then(function (saved) {
          toast('PDF Issue uploaded and published!');
          if (saved && saved.slug) {
            window.location.href = '/read/' + saved.slug;
          }
        })
        .catch(function (e) {
          status.textContent = 'Upload failed: ' + (e.message || 'Server error');
          toast('PDF Upload failed: ' + e.message, 'error');
        })
        .then(function () {
          input.value = '';
        });
    });

    return h('div', { class: 'pdf-uploader' }, pick, status);
  }

  /* ---------- story blocks ---------- */

  function newBlock(type) {
    switch (type) {
      case 'heading': return { type: 'heading', text: '' };
      case 'text': return { type: 'text', text: '' };
      case 'quote': return { type: 'quote', text: '', cite: '' };
      case 'image': return { type: 'image', src: '', caption: '', alt: '', layout: 'fit', focus: 'center' };
      default: return { type: 'specs', title: 'Work specifications', rows: [{ field: '', value: '', source: 'Official' }] };
    }
  }

  function specFields(b) {
    var rows = h('div', { class: 'spec-rows' });
    function draw() {
      rows.textContent = '';
      b.rows.forEach(function (r) {
        var name = bindInput(h('input', { type: 'text', maxlength: 80, placeholder: 'Medium & Materials', 'aria-label': 'Spec name' }), r, 'field');
        var value = bindInput(h('input', { type: 'text', maxlength: 200, placeholder: 'As stated by the studio or artist', 'aria-label': 'Spec value' }), r, 'value');
        var source = select(SOURCES.map(function (s) { return [s, s]; }), r, 'source');
        source.setAttribute('aria-label', 'Where this fact comes from');
        var del = h('button', { type: 'button', class: 'icon-btn', title: 'Remove row', 'aria-label': 'Remove row', text: '✕' });
        del.addEventListener('click', function () { b.rows.splice(b.rows.indexOf(r), 1); markDirty(); draw(); });
        rows.append(h('div', { class: 'spec-row' }, name, value, source, del));
      });
    }
    draw();
    var add = h('button', { type: 'button', class: 'btn btn--small', text: 'Add a row' });
    add.addEventListener('click', function () { b.rows.push({ field: '', value: '', source: 'Official' }); markDirty(); draw(); });
    return [
      fld('Sheet title', bindInput(h('input', { type: 'text', maxlength: 80, placeholder: 'Work specifications' }), b, 'title')),
      h('div', { class: 'fld' },
        h('span', { class: 'tag', text: 'Rows' }),
        rows,
        h('span', { class: 'hint', text: 'Label each detail: Official (stated by artist/studio), Verified (confirmed with gallery/curators), or Our view (curatorial reading).' })),
      add
    ];
  }

  function blockFields(b) {
    switch (b.type) {
      case 'heading':
        return [fld('Heading', bindInput(h('input', { type: 'text', maxlength: 200 }), b, 'text'))];
      case 'text':
        return [fld('Text', autoGrow(bindInput(h('textarea', { rows: 6, maxlength: 20000 }), b, 'text')), 'Leave a blank line between paragraphs.')];
      case 'quote':
        return [
          fld('Quote', autoGrow(bindInput(h('textarea', { rows: 3, maxlength: 500 }), b, 'text'))),
          fld('Who said it (optional)', bindInput(h('input', { type: 'text', maxlength: 120 }), b, 'cite'))
        ];
      case 'image':
        return [
          uploader(b.src, function (url) { b.src = url; markDirty(); }, 'Choose photo'),
          fld('Caption (optional)', bindInput(h('input', { type: 'text', maxlength: 300 }), b, 'caption')),
          fld('Description for screen readers', bindInput(h('input', { type: 'text', maxlength: 200 }), b, 'alt'), 'A short sentence about what the artwork shows.'),
          h('div', { class: 'two' },
            fld('Layout', select(LAYOUTS, b, 'layout')),
            fld('Keep this part when cropped', select(FOCUS, b, 'focus')))
        ];
      default:
        return specFields(b);
    }
  }

  function blockCard(b, index, total) {
    var up = h('button', { type: 'button', class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', text: '↑' });
    var down = h('button', { type: 'button', class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', text: '↓' });
    var del = h('button', { type: 'button', class: 'icon-btn icon-btn--danger', title: 'Delete block', 'aria-label': 'Delete block', text: '✕' });
    up.disabled = index === 0;
    down.disabled = index === total - 1;
    up.addEventListener('click', function () { moveBlock(b, -1); });
    down.addEventListener('click', function () { moveBlock(b, 1); });

    var armed = false;
    var armTimer = 0;
    del.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        del.textContent = 'Delete?';
        del.classList.add('is-armed');
        armTimer = setTimeout(function () { armed = false; del.textContent = '✕'; del.classList.remove('is-armed'); }, 3000);
        return;
      }
      clearTimeout(armTimer);
      current.blocks.splice(current.blocks.indexOf(b), 1);
      markDirty();
      drawBlocks();
    });

    return h('section', { class: 'blk blk--' + b.type, 'aria-label': TYPE_LABEL[b.type] + ' ' + (index + 1) },
      h('div', { class: 'blk-head' },
        h('span', { class: 'tag', text: (index + 1) + '. ' + TYPE_LABEL[b.type] }),
        h('div', { class: 'blk-tools' }, up, down, del)),
      h('div', { class: 'blk-body' }, blockFields(b)));
  }

  function moveBlock(b, dir) {
    var list = current.blocks;
    var i = list.indexOf(b);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    list[i] = list[j];
    list[j] = b;
    markDirty();
    drawBlocks();
  }

  function drawBlocks() {
    if (!blocksBox) return;
    blocksBox.textContent = '';
    if (!current.blocks.length) {
      blocksBox.append(h('p', { class: 'muted empty-blocks', text: 'Your story is empty. Add a heading, some text or an artwork photo below.' }));
      return;
    }
    current.blocks.forEach(function (b, i) { blocksBox.append(blockCard(b, i, current.blocks.length)); });
  }

  function addBlock(type) {
    current.blocks.push(newBlock(type));
    markDirty();
    drawBlocks();
    var card = blocksBox.lastElementChild;
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var first = card.querySelector('input:not([type=file]), textarea');
      if (first) first.focus({ preventScroll: true });
    }
  }

  function addPhotos(files) {
    var chain = Promise.resolve();
    var done = 0;
    files.forEach(function (file, i) {
      chain = chain.then(function () {
        toast('Uploading photo ' + (i + 1) + ' of ' + files.length + '…');
        return uploadFile(file).then(function (url) {
          var b = newBlock('image');
          b.src = url;
          current.blocks.push(b);
          done += 1;
          markDirty();
          drawBlocks();
        });
      }).catch(function (e) { toast(file.name + ': ' + e.message, 'error'); });
    });
    chain.then(function () { if (done) toast(done === 1 ? 'Photo added.' : done + ' photos added.'); });
  }

  /* ---------- saving ---------- */

  function payload() {
    return {
      title: current.title,
      category: current.category || 'Issues',
      dek: current.dek || '',
      cover: current.cover || '',
      pdf_url: current.pdf_url || '',
      featured: !!current.featured,
      status: current.status || 'draft',
      blocks: current.blocks || []
    };
  }

  function save() {
    if (!current.title.trim()) {
      toast('Add a title first.', 'error');
      var t = document.getElementById('f-title');
      if (t) t.focus();
      return Promise.reject(new Error('no title'));
    }
    var creating = !current.id;
    var req = guard(AVD.adminSave(creating ? null : current.id, payload()));
    return req.then(function (saved) {
      current.id = saved.id;
      current.slug = saved.slug;
      current.status = saved.status;
      dirty = false;
      if (dirtyEl) dirtyEl.hidden = true;
      if (creating) {
        skipHash = true;
        location.hash = '#/edit/' + saved.id;
        lastHash = location.hash;
      }
      toast(saved.status === 'published' ? 'Saved. This feature is live.' : 'Saved as a draft.');
      return saved;
    }).catch(function (e) {
      toast(e.message, 'error');
      throw e;
    });
  }

  /* ---------- views / list ---------- */

  function listRow(a, row) {
    var del = h('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Delete' });
    var armed = false;
    var timer = 0;
    del.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        del.textContent = 'Confirm delete';
        del.classList.add('is-armed');
        timer = setTimeout(function () { armed = false; del.textContent = 'Delete'; del.classList.remove('is-armed'); }, 3000);
        return;
      }
      clearTimeout(timer);
      del.disabled = true;
      guard(AVD.adminDelete(a.id)).then(function () {
        row.remove();
        toast('Feature deleted.');
      }).catch(function (e) { del.disabled = false; toast(e.message, 'error'); });
    });

    var published = a.status === 'published';
    var viewsCount = a.views || 0;

    return h('article', { class: 'feat' },
      AV.photo(a, 'feat-thumb'),
      h('div', { class: 'feat-info' },
        h('a', { class: 'feat-title', href: '#/edit/' + a.id, text: a.title }),
        h('div', { class: 'feat-meta' },
          h('span', { class: 'tag', text: a.category }),
          h('span', { class: 'chip ' + (published ? 'chip--live' : 'chip--draft'), text: published ? 'Published' : 'Draft' }),
          a.featured ? h('span', { class: 'chip', text: 'Cover story' }) : null,
          h('span', { class: 'chip', style: 'background: var(--accent-purple, #7d328d); color: #fffff3; border: none; font-weight: 600;' }, '👁️ ' + viewsCount.toLocaleString() + ' reads'),
          h('span', { class: 'muted', text: 'Edited ' + fmt(a.updatedAt) }))),
      h('div', { class: 'feat-actions' },
        h('a', { class: 'btn btn--small', href: '#/edit/' + a.id, text: 'Edit' }),
        h('a', { class: 'btn btn--small btn--ghost', href: '/read/' + a.slug, target: '_blank', rel: 'noopener', text: 'View' }),
        del));
  }

  function showList() {
    current = null;
    dirtyEl = null;
    document.title = 'Features | HOLIX editor';
    app.textContent = '';
    var box = h('div', { class: 'feat-list' }, h('p', { class: 'muted', text: 'Loading…' }));
    app.append(
      h('div', { class: 'page-head' },
        h('h1', { text: 'Features' }),
        h('a', { class: 'btn btn--solid', href: '#/new', text: 'New feature' })),
      box);
    guard(AVD.adminList()).then(function (list) {
      box.textContent = '';
      if (!list.length) {
        box.append(h('p', { class: 'muted', text: 'No features yet. Choose New feature to write your first one.' }));
        return;
      }
      list.forEach(function (a) {
        var holder = h('div');
        var row = listRow(a, holder);
        holder.append(row);
        box.append(holder);
      });
    }).catch(function (e) {
      box.textContent = '';
      box.append(h('p', { class: 'form-msg', text: e.message }));
    });
  }

  function drawEditor() {
    document.title = (current.title || 'New feature') + ' | HOLIX editor';
    app.textContent = '';

    dirtyEl = h('span', { class: 'dirty', text: 'Unsaved changes', hidden: !dirty });
    var saveBtn = h('button', { type: 'button', class: 'btn btn--solid', text: 'Save' });
    var previewBtn = h('button', { type: 'button', class: 'btn', text: 'Preview as book' });
    saveBtn.addEventListener('click', function () { saveBtn.disabled = true; save().catch(function () {}).then(function () { saveBtn.disabled = false; }); });
    previewBtn.addEventListener('click', function () {
      var win = window.open('about:blank', '_blank');
      save().then(function (s) {
        if (win) win.location.href = '/read/' + s.slug;
      }).catch(function () { if (win) win.close(); });
    });

    var title = bindInput(h('input', { type: 'text', id: 'f-title', maxlength: 200, placeholder: 'A headline for the feature' }), current, 'title');
    var dek = autoGrow(bindInput(h('textarea', { rows: 3, maxlength: 400, placeholder: 'One or two sentences that introduce the story' }), current, 'dek'));
    var statusSel = select([['draft', 'Draft (private)'], ['published', 'Published (public)']], current, 'status');
    var catSel = select(CATEGORY_NAMES.map(function (c) { return [c, c]; }), current, 'category');
    var featured = h('input', { type: 'checkbox', id: 'f-featured' });
    featured.checked = !!current.featured;
    featured.addEventListener('change', function () { current.featured = featured.checked; markDirty(); });

    blocksBox = h('div', { class: 'blocks' });

    var multi = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'file-input' });
    multi.addEventListener('change', function () {
      var files = [].slice.call(multi.files);
      multi.value = '';
      if (files.length) addPhotos(files);
    });

    var addBar = h('div', { class: 'add-bar' },
      h('span', { class: 'tag', text: 'Add to the story' }),
      h('div', { class: 'add-btns' },
        addButton('Heading', 'heading'),
        addButton('Text', 'text'),
        addButton('Photo', 'image'),
        addButton('Pull quote', 'quote'),
        addButton('Work Specs', 'specs'),
        h('label', { class: 'btn btn--small' }, 'Add several photos', multi)));

    app.append(
      h('div', { class: 'page-head' },
        h('div', { class: 'page-head__l' },
          h('a', { class: 'back', href: '#/', text: '← All features' }),
          h('h1', { text: current.id ? 'Edit feature' : 'New feature' })),
        h('div', { class: 'page-head__r' }, dirtyEl, previewBtn, saveBtn)),
      h('div', { class: 'editor-grid' },
        h('div', { class: 'editor-main' },
          fld('Title', title),
          fld('Standfirst', dek, 'Shown under the title and on cards.'),
          h('h2', { class: 'sub', text: 'The story' }),
          blocksBox,
          addBar),
        h('aside', { class: 'editor-side', 'aria-label': 'Feature settings' },
          h('div', { class: 'side-card' },
            fld('Status', statusSel, 'Save as a draft until it is ready.'),
            fld('Section', catSel),
            h('label', { class: 'check' }, featured, h('span', { text: 'Make this the cover story on the homepage' }))),
          h('div', { class: 'side-card' },
            h('span', { class: 'tag', text: 'PDF Magazine (Optional)' }),
            pdfUploader(current.pdf_url, function (url) { current.pdf_url = url; markDirty(); }),
            h('p', { class: 'hint', text: 'Upload a complete pre-made PDF issue instead of writing manual blocks.' })),
          h('div', { class: 'side-card' },
            h('span', { class: 'tag', text: 'Cover photo' }),
            uploader(current.cover, function (url) { current.cover = url; markDirty(); }, 'Choose cover photo'),
            h('p', { class: 'hint', text: 'Used on the book cover, the homepage and section pages. A tall photo works best.' })),
          current.slug && current.status === 'published'
            ? h('a', { class: 'btn btn--ghost btn--block', href: '/read/' + current.slug, target: '_blank', rel: 'noopener', text: 'Open the live book' })
            : null)));
    drawBlocks();
  }

  function addButton(label, type) {
    var b = h('button', { type: 'button', class: 'btn btn--small', text: label });
    b.addEventListener('click', function () { addBlock(type); });
    return b;
  }

  function showEditor(id) {
    if (!id) {
      current = { title: '', category: 'Issues', dek: '', cover: '', pdf_url: '', featured: false, status: 'draft', blocks: [] };
      dirty = false;
      drawEditor();
      return;
    }
    app.textContent = '';
    app.append(h('p', { class: 'muted', text: 'Loading…' }));
    guard(AVD.adminGet(id)).then(function (a) {
      current = a;
      dirty = false;
      drawEditor();
    }).catch(function (e) {
      app.textContent = '';
      app.append(
        h('p', { class: 'form-msg', text: e.message }),
        h('a', { class: 'btn', href: '#/', text: 'Back to all features' }));
    });
  }

  /* ---------- routing ---------- */

  function route() {
    var m = location.hash.match(/^#\/edit\/([\w-]+)$/);
    if (m) showEditor(m[1]);
    else if (location.hash === '#/new') showEditor(null);
    else showList();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', function () {
    if (skipHash) { skipHash = false; return; }
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) {
      skipHash = true;
      location.hash = lastHash;
      return;
    }
    dirty = false;
    lastHash = location.hash;
    route();
  });

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && current) {
      e.preventDefault();
      save().catch(function () {});
    }
  });

  var signoutBtn = document.getElementById('signout');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', function () {
      if (dirty && !window.confirm('You have unsaved changes. Sign out anyway?')) return;
      dirty = false;
      AVD.signOut().catch(function () {}).then(function () { window.location.href = '/admin/login.html'; });
    });
  }

  var csvBtn = document.getElementById('subs-csv');
  if (csvBtn) {
    csvBtn.addEventListener('click', function () {
      guard(AVD.subscribersCsv()).then(function (csv) {
        var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        var a = h('a', { href: url, download: 'holix-subscribers.csv' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }).catch(function (e) { toast(e.message, 'error'); });
    });
  }

  AVD.getSession().then(function (s) {
    if (!s) { window.location.replace('/admin/login.html'); return; }
    route();
  }).catch(function () { window.location.replace('/admin/login.html'); });
})();