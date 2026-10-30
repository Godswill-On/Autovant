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

-- 4. PDF issues -----------------------------------------------------------
alter table public.articles add column if not exists pdf_url text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issues', 'issues', true, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

drop policy if exists "editor uploads issues" on storage.objects;
create policy "editor uploads issues" on storage.objects
  for insert to authenticated with check (bucket_id = 'issues');

drop policy if exists "editor updates issues" on storage.objects;
create policy "editor updates issues" on storage.objects
  for update to authenticated using (bucket_id = 'issues');

drop policy if exists "editor deletes issues" on storage.objects;
create policy "editor deletes issues" on storage.objects
  for delete to authenticated using (bucket_id = 'issues');

-- 5. View counter ---------------------------------------------------------
alter table public.articles add column if not exists views bigint not null default 0;

create or replace function public.increment_article_views(article_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.articles set views = views + 1
  where id = article_id and status = 'published';
$$;

grant execute on function public.increment_article_views(uuid) to anon, authenticated;

-- 6. PDF page pictures (so phones never have to open the PDF itself) -------
alter table public.articles add column if not exists pdf_pages jsonb not null default '[]'::jsonb;

update storage.buckets
  set allowed_mime_types = array['application/pdf', 'image/jpeg']
  where id = 'issues';

-- 7. One view per reader per issue ---------------------------------------
create table if not exists public.article_readers (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  email      text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (article_id, email)
);

alter table public.article_readers enable row level security;

drop policy if exists "editor reads readers" on public.article_readers;
create policy "editor reads readers" on public.article_readers
  for select to authenticated using (true);

create or replace function public.record_unique_view(p_article uuid, p_email text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  n text := left(trim(coalesce(p_name, '')), 80);
  added int;
begin
  if n = '' or length(e) > 200 or e !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return; end if;
  if not exists (select 1 from public.articles where id = p_article and status = 'published') then return; end if;

  insert into public.article_readers (article_id, email, name)
  values (p_article, e, n)
  on conflict (article_id, email) do nothing;

  get diagnostics added = row_count;
  if added > 0 then
    update public.articles set views = views + 1 where id = p_article;
  end if;
end;
$$;

grant execute on function public.record_unique_view(uuid, text, text) to anon, authenticated;

-- The old counter let anyone add views without limit; remove it.
drop function if exists public.increment_article_views(uuid);

-- 8. Homepage: Featured Artist & Artwork -----------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "public reads settings" on public.site_settings;
create policy "public reads settings" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "editor inserts settings" on public.site_settings;
create policy "editor inserts settings" on public.site_settings
  for insert to authenticated with check (true);

drop policy if exists "editor updates settings" on public.site_settings;
create policy "editor updates settings" on public.site_settings
  for update to authenticated using (true) with check (true);
