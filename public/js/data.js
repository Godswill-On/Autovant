/*
- AUTOVANT data layer.
- Everything talks to Supabase directly:
- features live in the "issues" table
- files/media live in storage buckets
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ijfbywnlygjmebblqwrh.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmJ5d25seWdqbWViYmxxd3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MTI5OTYsImV4cCI6MjEwNzM4ODk5Nn0.73jEbITrBDxUCeIyMdm9FpCtNHLAE9bc_yzq8V6sutE';
  var BUCKET = 'media';

  // Updated categories/sections for your magazine platform
  var CATEGORIES = ['Issues', 'Features', 'Custom Builds', 'Editorial'];
  var SOURCES = ['Official', 'Verified', 'Our view'];
  
  var SRC_RE = new RegExp('^(' + SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/storage/v1/object/public/(media|issues)/[A-Za-z0-9._/-]{1,150}|/img/[A-Za-z0-9._-]{1,100})$');

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
      return fail('The storage bucket is missing. Run supabase/setup.sql in your Supabase SQL editor.', 500);
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

  // database row -> the issue/article object the pages expect
  function fromRow(r) {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      dek: r.dek || '',
      cover: r.cover || '',
      pdf_url: r.pdf_url || '',
      featured: !!r.featured,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      publishedAt: r.published_at,
      blocks: Array.isArray(r.blocks) ? r.blocks : []
    };
  }

  function summary(a) {
    var words = a.blocks.reduce(function (n, b) {
      return n + (b.type === 'text' ? b.text.split(/\s+/).filter(Boolean).length : 0);
    }, 0);
    return {
      id: a.id, slug: a.slug, title: a.title, category: a.category, dek: a.dek, cover: a.cover,
      pdf_url: a.pdf_url, featured: a.featured, status: a.status, publishedAt: a.publishedAt, updatedAt: a.updatedAt,
      minutes: Math.max(1, Math.round(words / 200))
    };
  }

  /* ---------- public reading ---------- */

  function listPublished(category) {
    var q = sb.from('issues').select('*').eq('status', 'published');
    if (category) q = q.eq('category', category);
    return q.order('published_at', { ascending: false, nullsFirst: false }).then(function (res) {
      if (res.error) throw explain(res.error);
      return res.data.map(fromRow).map(summary);
    });
  }

  function getBySlug(slug) {
    return sb.from('issues').select('*').eq('slug', slug).maybeSingle().then(function (res) {
      if (res.error) throw explain(res.error);
      if (!res.data) throw fail('Not found.', 404);
      return fromRow(res.data);
    });
  }

  function subscribe(email) {
    email = str(email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Promise.reject(fail('Enter a valid email address.', 400));
    return sb.from('subscribers').insert({ email: email }).then(function (res) {
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

  function authed(fn) {
    return getSession().then(function (s) {
      if (!s) throw fail('Your session has ended. Sign in again.', 401);
      return fn();
    });
  }

  /* ---------- editor: features / issues ---------- */

  function adminList() {
    return authed(function () {
      return sb.from('issues').select('*').order('updated_at', { ascending: false }).then(function (res) {
        if (res.error) throw explain(res.error);
        return res.data.map(fromRow).map(summary);
      });
    });
  }

  function adminGet(id) {
    return authed(function () {
      return sb.from('issues').select('*').eq('id', id).maybeSingle().then(function (res) {
        if (res.error) throw explain(res.error);
        if (!res.data) throw fail('Not found.', 404);
        return fromRow(res.data);
      });
    });
  }

  function uniqueSlug(title) {
    var base = slugify(title);
    return sb.from('issues').select('slug').like('slug', base + '%').then(function (res) {
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
      category: pick(body.category, CATEGORIES, 'Issues'),
      dek: str(body.dek, 400),
      cover: SRC_RE.test(body.cover || '') ? body.cover : '',
      pdf_url: SRC_RE.test(body.pdf_url || '') ? body.pdf_url : (body.pdf_url || ''),
      featured: !!body.featured,
      status: status,
      blocks: cleanBlocks(body.blocks),
      updated_at: now
    };

    return authed(function () {
      if (id) {
        return sb.from('issues').select('published_at').eq('id', id).maybeSingle().then(function (cur) {
          if (cur.error) throw explain(cur.error);
          if (!cur.data) throw fail('Not found.', 404);
          fields.published_at = cur.data.published_at || (status === 'published' ? now : null);
          return sb.from('issues').update(fields).eq('id', id).select('*').maybeSingle();
        }).then(function (res) {
          if (res.error) throw explain(res.error);
          if (!res.data) throw fail('Could not save. Your session may have ended: sign in again.', 401);
          return fromRow(res.data);
        });
      }
      return uniqueSlug(title).then(function (slug) {
        fields.slug = slug;
        fields.published_at = status === 'published' ? now : null;
        return sb.from('issues').insert(fields).select('*').single();
      }).then(function (res) {
        if (res.error) throw explain(res.error);
        return fromRow(res.data);
      });
    });
  }

  function adminDelete(id) {
    return authed(function () {
      return sb.from('issues').delete().eq('id', id).select('id').then(function (res) {
        if (res.error) throw explain(res.error);
        if (!res.data || !res.data.length) throw fail('Could not delete. Your session may have ended: sign in again.', 401);
        return { ok: true };
      });
    });
  }

  /* ---------- editor: upload (photos & PDFs) ---------- */

  function upload(file) {
    if (!file) return Promise.reject(new Error('No file selected.'));

    var isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    var bucketName = isPdf ? 'issues' : 'media';
    var folder = isPdf ? 'pdf/' : 'photos/';
    var cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    var path = folder + Date.now() + '_' + cleanName;

    return sb.storage
      .from(bucketName)
      .upload(path, file, {
        cacheControl: '3600',
        contentType: isPdf ? 'application/pdf' : file.type,
        upsert: true
      })
      .then(function (result) {
        if (result.error) throw result.error;
        var publicData = sb.storage.from(bucketName).getPublicUrl(path);
        return publicData.data.publicUrl;
      });
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
    subscribersCsv: subscribersCsv
  };
})();