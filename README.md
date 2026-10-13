# AUTOVANT

A car design magazine that reads like a book. Readers open a feature, the cover lifts, and the pages turn.
You write and publish features from a private admin page, and upload the photos there too.

## What is in the folder

```
server.js               the server (pages, API, login, photo uploads)
package.json            the list of things the server needs
.env.example            settings you copy to ".env" and fill in

public/                 everything visitors can see
  index.html            homepage
  section.html          one section (Exterior, Interior, ...)
  read.html             the book reader
  css/base.css          colours, type, header, footer
  css/home.css          homepage and section pages
  css/book.css          the book: cover, pages, spine, page turns
  js/common.js          shared helpers
  js/home.js            fills the homepage from your features
  js/section.js         fills a section page
  js/book.js            the page-turn engine (3D turns, open and close)
  js/reader.js          loads a feature and cuts it into book pages
  img/                  sample images used by the sample features

admin/                  only served to you after you sign in
  login.html            sign-in page
  editor.html           the editor
  assets/admin.css      editor styling
  assets/login.js       sign-in script
  assets/editor.js      the editor itself

seed/articles.json      three sample features, loaded the first time the server starts
data/                   created on first run: your features and email sign-ups
uploads/                created on first run: your uploaded photos
```

HTML, CSS and JavaScript are in separate files throughout.

## Run it on your computer

1. Install Node.js 18 or newer from nodejs.org.
2. In this folder run: `npm install`
3. Copy `.env.example` to a new file named `.env`. Open it and set:
   - `ADMIN_PASSWORD` to a long passphrase only you know (10+ characters).
   - `SESSION_SECRET` to a random string. Make one with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - For testing on your own computer, delete the `NODE_ENV=production` line.
4. Run: `npm start`
5. Open http://localhost:3000 for the site and http://localhost:3000/admin for the editor.

The server will not start if `.env` still has the example values.

## Writing a feature

Sign in at `/admin`, then choose **New feature**.

- **Title, standfirst, section, cover photo** are on the page and in the right-hand panel.
- **Add to the story** adds blocks: Heading, Text, Photo, Pull quote and Spec sheet. Use the arrows to reorder them.
- **Add several photos** uploads a batch and makes one photo block for each.
- **Text**: leave a blank line between paragraphs.
- **Spec sheet**: label every fact Official (the maker published it), Verified (you confirmed it) or Our view (your opinion). Readers see these labels in the book.
- **Photo layouts**
  - *Inline, with the text*: sits in the flow of the story.
  - *Full page*: fills one whole page. Best for tall photos.
  - *Across two pages*: spans both pages of an open book. Best for wide photos. On a phone it sits inline instead.
  - *Keep this part when cropped* chooses what stays in frame when a photo is cropped to fit.
- **Status**: Draft is private. Published is public. Save a draft until you are ready.
- **Make this the cover story** puts the feature on the homepage cover.
- **Preview as book** saves, then opens the feature exactly as readers will see it. Drafts can only be previewed while you are signed in.
- Ctrl+S (or Cmd+S) saves.

The three "Sample feature" stories load on first start so the site is not empty. Delete them from the Features list once you have your own.

Photos must be JPG, PNG or WebP, up to 25 MB. With the optional `sharp` package installed (it installs by itself on most computers) they are resized to 2600 px and converted to WebP. Only upload photos you own, have permission to use, or have licensed.

## How the book works

On a wide screen the feature opens as a two-page spread. On a phone it shows one page at a time. Readers can click or tap a page, use the arrow buttons, press the left and right arrow keys, or swipe. The contents list on the title page jumps to a heading. "Close the book" closes the cover and returns to where they came from. People who ask their device to reduce motion get instant page changes with no animation.

Text is cut into pages by measuring it at the real page size, so it re-flows if the window is resized.

## Putting it online (Netlify + Supabase)

The site is now plain static files in `public/`, and Supabase stores everything else:
features (table `articles`), email sign-ups (table `subscribers`), photos (storage bucket `photos`) and the editor sign-in (Supabase Auth).

1. In Supabase open **SQL Editor**, paste all of `supabase/setup.sql` and run it (once).
2. In Supabase **Authentication > Users**, create your editor user (email + password). Then in **Authentication > Sign In / Providers**, turn **off** "Allow new users to sign up" so nobody else can become an editor.
3. Push this folder to GitHub. In Netlify the build command stays empty and the publish directory is `public` (`netlify.toml` already says so).
4. Open `https://YOUR-SITE.netlify.app/admin` and sign in.

`server.js`, `.env` and `data/` belong to the old file-based version and are not used on Netlify.

## How the admin is protected

- `/admin`, its scripts, and every write action (saving, deleting, uploading) check a signed login cookie. Without it the server answers 401 or shows only the sign-in page.
- The cookie is HttpOnly (page scripts cannot read it) and SameSite=Strict. Writes also need a custom header, which blocks requests forged from other sites.
- After 5 wrong passwords, that address is locked out for 15 minutes.
- Uploads are checked by their real file contents, not their names. SVG and other types are refused.
- Everything you type is shown as plain text, so nothing you write can run as code on a reader's page.
- Drafts are never sent to the public.

Honest limits: there is one shared password and no two-step sign-in, so pick a long passphrase and keep `.env` private. To change the password, edit `.env` and restart. Changing `SESSION_SECRET` signs you out everywhere. Email sign-ups are stored in `data/subscribers.json`; download them as a CSV from the editor's top bar. Tell people how you use those addresses.

## If something looks wrong

- **Fonts look plain**: the site loads Bodoni Moda, Hanken Grotesk and IBM Plex Mono from Google Fonts, so it needs a connection to fonts.googleapis.com.
- **"Your session has ended"** in the editor: sign in again in the new tab it offers, then return and save. Your edits are still on the page.
- **Locked out**: wait 15 minutes, or restart the server.
- **A photo will not upload**: check it is JPG, PNG or WebP and under 25 MB. iPhone HEIC photos need converting first.
