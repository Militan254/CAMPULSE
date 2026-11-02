-- CampusPulse social profile additions.
-- Run after 20261028000000_phase2_auth_chat_seed.sql.

alter table public.updates
  add column if not exists image_url text;

alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text;

create unique index if not exists profiles_username_idx
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  image_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.post_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, post_id)
);

alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.post_likes enable row level security;

-- Posts are public to signed-in users; authors control their own posts.
drop policy if exists "Signed in users can read posts" on public.posts;
create policy "Signed in users can read posts"
on public.posts for select to authenticated using (true);

drop policy if exists "Users can create their own posts" on public.posts;
create policy "Users can create their own posts"
on public.posts for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own posts" on public.posts;
create policy "Users can update their own posts"
on public.posts for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own posts" on public.posts;
create policy "Users can delete their own posts"
on public.posts for delete to authenticated using (auth.uid() = user_id);

-- Following relationships are visible to signed-in users and writable by the follower.
drop policy if exists "Signed in users can read follows" on public.follows;
create policy "Signed in users can read follows"
on public.follows for select to authenticated using (true);

drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
on public.follows for insert to authenticated
with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow as themselves" on public.follows;
create policy "Users can unfollow as themselves"
on public.follows for delete to authenticated
using (auth.uid() = follower_id);

-- Likes are visible to signed-in users and writable by the liker.
drop policy if exists "Signed in users can read post likes" on public.post_likes;
create policy "Signed in users can read post likes"
on public.post_likes for select to authenticated using (true);

drop policy if exists "Users can like as themselves" on public.post_likes;
create policy "Users can like as themselves"
on public.post_likes for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own likes" on public.post_likes;
create policy "Users can remove their own likes"
on public.post_likes for delete to authenticated
using (auth.uid() = user_id);

-- Public avatar storage. The object path must start with the user's auth id.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and owner_id = auth.uid()::text)
with check (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars"
on storage.objects for select to public
using (bucket_id = 'avatars');

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists likes_post_idx on public.post_likes (post_id);

-- Public images attached to official updates.
insert into storage.buckets (id, name, public)
values ('update-images', 'update-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Signed in users can upload update images" on storage.objects;
create policy "Signed in users can upload update images"
on storage.objects for insert to authenticated
with check (bucket_id = 'update-images');

drop policy if exists "Anyone can view update images" on storage.objects;
create policy "Anyone can view update images"
on storage.objects for select to public
using (bucket_id = 'update-images');
