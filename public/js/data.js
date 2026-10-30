/*
 * AUTOVANT data layer.
 * Replaces the old Node server (/api/...). Everything now talks to Supabase directly:
 *   - features live in the "articles" table
 *   - photos live in the "photos" storage bucket
 *   - email sign-ups live in the "subscribers" table
 *   - the editor signs in with Supabase Auth
 * Who may read and write what is enforced by the row-level security rules in supabase/setup.sql.
 * The anon key below is meant to be public; it can only do what those rules allow.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ijfbywnlygjmebblqwrh.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmJ5d25seWdqbWViYmxxd3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MTI5OTYsImV4cCI6MjEwNzM4ODk5Nn0.73jEbITrBDxUCeIyMdm9FpCtNHLAE9bc_yzq8V6sutE';
  var BUCKET = 'photos';

  var CATEGORIES = ['Exterior', 'Interior', 'Custom Builds', 'Designers & Brands', 'Concepts', 'Features'];
  var SOURCES = ['Official', 'Verified', 'Our view'];
  // Photos may come from our storage bucket or from the bundled sample images.
  var PDF_RE = new RegExp('^' + SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/storage/v1/object/public/issues/[A-Za-z0-9._-]{1,120}$');
  var SRC_RE = new RegExp('^(' + SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/storage/v1/object/public/' + BUCKET + '/[A-Za-z0-9._-]{1,120}|/img/[A-Za-z0-9._-]{1,100})$');

  if (!window.supabase || !window.supabase.createClient) {
    console.error('Supabase library did not load. Check your connection.');
  }
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ---------- helpers ---------- */

  function fail(message, status) {
    var e = new Error(message);
    e.status = status || 0;
    return e;
  }

  // Turn a Supabase error into a plain-English Error the pages can show.
  function explain(error, fallback) {
    if (!error) return fail(fallback || 'Something went wrong. Try again.');
    var msg = String(error.message || '');
    var status = error.status || error.statusCode || 0;
    if (status === 401 || /jwt|not authenticated|unauthorized/i.test(msg)) {
      return fail('Your session has ended. Sign in again.', 401);
    }
    if (/row-level security|violates row-level/i.test(msg)) {
      return fail('Supabase refused this (permissions). Run supabase/setup.sql in your Supabase project, then sign in again.', 403);
    }
    if (error.code === '42P01' || /relation .* does not exist|schema cache/i.test(msg)) {
      return fail('The database tables are missing. Run supabase/setup.sql in your Supabase SQL editor.', 500);
    }
    if (/bucket not found/i.test(msg)) {
      return fail('The "photos" storage bucket is missing. Run supabase/setup.sql in your Supabase SQL editor.', 500);
    }
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return fail('Could not reach Supabase. Check your connection and try again.', 0);
    }
    return fail(msg || fallback || 'Something went wrong. Try again.', status);
  }

  function str(v, max) {
    return typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '';
  }
  function pick(v, list, fallback) {
    return list.indexOf(v) > -1 ? v : fallback;
  }

  function slugify(title) {
    return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'story';
  }

  function cleanBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks.slice(0, 300).map(function (b) {
      if (!b || typeof b !== 'object') return null;
      switch (b.type) {
        case 'heading':
          return { type: 'heading', text: str(b.text, 200) };
        case 'text':
          return { type: 'text', text: str(b.text, 20000) };
        case 'quote':
          return { type: 'quote', text: str(b.text, 500), cite: str(b.cite, 120) };
        case 'image':
          return {
            type: 'image',
            src: SRC_RE.test(b.src || '') ? b.src : '',
            caption: str(b.caption, 300),
            alt: str(b.alt, 200),
            layout: pick(b.layout, ['fit', 'fill', 'spread'], 'fit'),
            focus: pick(b.focus, ['left', 'center', 'right'], 'center')
          };
        case 'specs':
          return {
            type: 'specs',
            title: str(b.title, 80),
            rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map(function (r) {
              return {
                field: str(r && r.field, 80),
                value: str(r && r.value, 200),
                source: pick(r && r.source, SOURCES, 'Our view')
              };
            })
          };
        default:
          return null;
      }
    }).filter(Boolean);
  }

  // database row -> the article object the pages expect
  function fromRow(r) {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      dek: r.dek || '',
      cover: r.cover || '',
      featured: !!r.featured,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      publishedAt: r.published_at,
      pdfUrl: r.pdf_url || '',
      blocks: Array.isArray(r.blocks) ? r.blocks : []
    };
  }

  function summary(a) {
    var words = a.blocks.reduce(function (n, b) {
      return n + (b.type === 'text' ? b.text.split(/\s+/).filter(Boolean).length : 0);
    }, 0);
    return {
      id: a.id, slug: a.slug, title: a.title, category: a.category, dek: a.dek, cover: a.cover,
      featured: a.featured, status: a.status, publishedAt: a.publishedAt, updatedAt: a.updatedAt,
      minutes: Math.max(1, Math.round(words / 200))
    };
  }

  /* ---------- public reading ---------- */

  function listPublished(category) {
    var q = sb.from('articles').select('*').eq('status', 'published');
    if (category) q = q.eq('category', category);
    return q.order('published_at', { ascending: false, nullsFirst: false }).then(function (res) {
      if (res.error) throw explain(res.error);
      return res.data.map(fromRow).map(summary);
    });
  }

  // Drafts are only returned when the editor is signed in (the database enforces this).
  function getBySlug(slug) {
    return sb.from('articles').select('*').eq('slug', slug).maybeSingle().then(function (res) {
      if (res.error) throw explain(res.error);
      if (!res.data) throw fail('Not found.', 404);
      return fromRow(res.data);
    });
  }

  function subscribe(email) {
    email = str(email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Promise.reject(fail('Enter a valid email address.', 400));
    return sb.from('subscribers').insert({ email: email }).then(function (res) {
      // 23505 = already on the list, which is fine
      if (res.error && res.error.code !== '23505') throw explain(res.error, 'Could not save your email. Try again.');
      return { ok: true };
    });
  }

  /* ---------- editor: sign-in ---------- */

  function signIn(email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw fail(res.error.message || 'Sign in failed.', res.error.status || 400);
      return res.data.session;
    });
  }

  function getSession() {
    return sb.auth.getSession().then(function (res) { return (res.data && res.data.session) || null; });
  }

  function signOut() {
    return sb.auth.signOut();
  }

  // Run an editor call, but fail clearly if the editor is not signed in.
  function authed(fn) {
    return getSession().then(function (s) {
      if (!s) throw fail('Your session has ended. Sign in again.', 401);
      return fn();
    });
  }

  /* ---------- editor: features ---------- */

  function adminList() {
    return authed(function () {
      return sb.from('articles').select('*').order('updated_at', { ascending: false }).then(function (res) {
        if (res.error) throw explain(res.error);
        return res.data.map(fromRow).map(summary);
      });
    });
  }

  function adminGet(id) {
    return authed(function () {
      return sb.from('articles').select('*').eq('id', id).maybeSingle().then(function (res) {
        if (res.error) throw explain(res.error);
        if (!res.data) throw fail('Not found.', 404);
        return fromRow(res.data);
      });
    });
  }

  function uniqueSlug(title) {
    var base = slugify(title);
    return sb.from('articles').select('slug').like('slug', base + '%').then(function (res) {
      if (res.error) throw explain(res.error);
      var taken = {};
      res.data.forEach(function (r) { taken[r.slug] = true; });
      var slug = base;
      var n = 2;
      while (taken[slug]) slug = base + '-' + n++;
      return slug;
    });
  }

  function adminSave(id, body) {
    var title = str(body.title, 200);
    if (!title) return Promise.reject(fail('Add a title first.', 400));
    var status = body.status === 'published' ? 'published' : 'draft';
    var now = new Date().toISOString();

    var fields = {
      title: title,
      category: pick(body.category, CATEGORIES, 'Features'),
      dek: str(body.dek, 400),
      cover: SRC_RE.test(body.cover || '') ? body.cover : '',
      pdf_url: PDF_RE.test(body.pdf_url || '') ? body.pdf_url : '',
      featured: !!body.featured,
      status: status,
      blocks: cleanBlocks(body.blocks),
      updated_at: now
    };

    return authed(function () {
      if (id) {
        return sb.from('articles').select('published_at').eq('id', id).maybeSingle().then(function (cur) {
          if (cur.error) throw explain(cur.error);
          if (!cur.data) throw fail('Not found.', 404);
          fields.published_at = cur.data.published_at || (status === 'published' ? now : null);
          return sb.from('articles').update(fields).eq('id', id).select('*').maybeSingle();
        }).then(function (res) {
          if (res.error) throw explain(res.error);
          if (!res.data) throw fail('Could not save. Your session may have ended: sign in again.', 401);
          return fromRow(res.data);
        });
      }
      return uniqueSlug(title).then(function (slug) {
        fields.slug = slug;
        fields.published_at = status === 'published' ? now : null;
        return sb.from('articles').insert(fields).select('*').single();
      }).then(function (res) {
        if (res.error) throw explain(res.error);
        return fromRow(res.data);
      });
    });
  }

  function adminDelete(id) {
    return authed(function () {
      return sb.from('articles').delete().eq('id', id).select('id').then(function (res) {
        if (res.error) throw explain(res.error);
        if (!res.data || !res.data.length) throw fail('Could not delete. Your session may have ended: sign in again.', 401);
        return { ok: true };
      });
    });
  }

  /* ---------- editor: photos ---------- */

  var MAX_BYTES = 25 * 1024 * 1024;

  // Shrink to 2600px and convert to WebP in the browser, so pages load fast and uploads stay small.
  function prepare(file) {
    var original = { body: file, type: file.type, ext: file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg' };
    if (!window.createImageBitmap) return Promise.resolve(original);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve(blob && blob.type === 'image/webp' && blob.size < file.size * 1.2
            ? { body: blob, type: 'image/webp', ext: 'webp' }
            : original);
        }, 'image/webp', 0.86);
      });
    }).catch(function () { return original; });
  }

  function randomName() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var PDF_BUCKET = 'issues';
  var MAX_PDF_BYTES = 50 * 1024 * 1024;

  function upload(file) {
    if (!file) return Promise.reject(fail('No file selected.', 400));
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

    return authed(function () {
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) throw fail('That PDF is over 50 MB. Compress it and try again.', 400);
        var path = Date.now() + '-' + randomName().slice(0, 8) + '.pdf';
        return sb.storage.from(PDF_BUCKET)
          .upload(path, file, { cacheControl: '3600', contentType: 'application/pdf', upsert: false })
          .then(function (res) {
            if (res.error) throw explain(res.error, 'Could not upload the PDF.');
            return sb.storage.from(PDF_BUCKET).getPublicUrl(path).data.publicUrl;
          });
      }
      if (file.size > MAX_BYTES) throw fail('That photo is over 25 MB.', 400);
      return prepare(file).then(function (p) {
        var name = randomName() + '.' + p.ext;
        return sb.storage.from(BUCKET)
          .upload(name, p.body, { cacheControl: '31536000', contentType: p.type, upsert: false })
          .then(function (res) {
            if (res.error) throw explain(res.error, 'Could not upload the photo.');
            return sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
          });
      });
    });
  }

  /* ---------- view counter (public) ---------- */

  // Fire and forget: a failed count must never stop a story from opening.
  function recordView(articleId) {
    if (!articleId) return;
    try {
      Promise.resolve(sb.rpc('increment_article_views', { article_id: articleId }))
        .then(function (res) { if (res && res.error) console.warn('View not counted:', res.error.message); })
        .catch(function () {});
    } catch (e) { /* ignore */ }
  }

  /* ---------- editor: subscribers ---------- */

  function subscribersCsv() {
    return authed(function () {
      return sb.from('subscribers').select('email,created_at').order('created_at', { ascending: true }).then(function (res) {
        if (res.error) throw explain(res.error);
        var rows = ['email,signed_up'].concat(res.data.map(function (s) { return s.email + ',' + s.created_at; }));
        return rows.join('\n');
      });
    });
  }

  window.AVD = {
    listPublished: listPublished,
    getBySlug: getBySlug,
    subscribe: subscribe,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    adminList: adminList,
    adminGet: adminGet,
    adminSave: adminSave,
    adminDelete: adminDelete,
    upload: upload,
    subscribersCsv: subscribersCsv,
    recordView: recordView
  };
})();
