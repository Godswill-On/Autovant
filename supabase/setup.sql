-- AUTOVANT: run this ONCE in Supabase -> SQL Editor -> New query -> Run.
-- It is safe to run again.

-- 1. Features -------------------------------------------------------------
create table if not exists public.articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  category     text not null default 'Features',
  dek          text not null default '',
  cover        text not null default '',
  featured     boolean not null default false,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  blocks       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);

alter table public.articles enable row level security;

drop policy if exists "public reads published" on public.articles;
create policy "public reads published" on public.articles
  for select to anon using (status = 'published');

drop policy if exists "editor reads all" on public.articles;
create policy "editor reads all" on public.articles
  for select to authenticated using (true);

drop policy if exists "editor inserts" on public.articles;
create policy "editor inserts" on public.articles
  for insert to authenticated with check (true);

drop policy if exists "editor updates" on public.articles;
create policy "editor updates" on public.articles
  for update to authenticated using (true) with check (true);

drop policy if exists "editor deletes" on public.articles;
create policy "editor deletes" on public.articles
  for delete to authenticated using (true);

-- 2. Email sign-ups -------------------------------------------------------
create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  created_at timestamptz not null default now()
);

alter table public.subscribers enable row level security;

drop policy if exists "anyone can subscribe" on public.subscribers;
create policy "anyone can subscribe" on public.subscribers
  for insert to anon, authenticated with check (true);

drop policy if exists "editor reads subscribers" on public.subscribers;
create policy "editor reads subscribers" on public.subscribers
  for select to authenticated using (true);

-- 3. Photos ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 26214400, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 26214400, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "editor uploads photos" on storage.objects;
create policy "editor uploads photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists "editor updates photos" on storage.objects;
create policy "editor updates photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos');

drop policy if exists "editor deletes photos" on storage.objects;
create policy "editor deletes photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
