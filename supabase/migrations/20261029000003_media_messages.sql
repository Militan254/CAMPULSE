-- Media, post comments, and direct-message-ready fields.
-- Run after the existing CampusPulse migrations.

alter table public.posts
  add column if not exists video_url text,
  add column if not exists audio_url text,
  add column if not exists song_url text;

alter table public.updates
  add column if not exists video_url text,
  add column if not exists audio_url text,
  add column if not exists song_url text;

alter table public.messages
  add column if not exists recipient_id uuid references auth.users(id) on delete set null;

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.post_comments enable row level security;

drop policy if exists "Signed in users can read post comments" on public.post_comments;
create policy "Signed in users can read post comments"
on public.post_comments for select to authenticated using (true);

drop policy if exists "Users can create post comments" on public.post_comments;
create policy "Users can create post comments"
on public.post_comments for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete post comments" on public.post_comments;
create policy "Users can delete post comments"
on public.post_comments for delete to authenticated
using (auth.uid() = user_id or public.is_admin());

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do update set public = true;

drop policy if exists "Signed in users can upload post media" on storage.objects;
create policy "Signed in users can upload post media"
on storage.objects for insert to authenticated
with check (bucket_id = 'post-media');

drop policy if exists "Anyone can view post media" on storage.objects;
create policy "Anyone can view post media"
on storage.objects for select to public
using (bucket_id = 'post-media');

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
