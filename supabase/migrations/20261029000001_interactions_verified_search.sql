-- Persistent public update interactions, user search, and verified-post sharing.
-- Run after 20261029000000_admin_dashboard.sql.

alter table public.profiles
  add column if not exists verified boolean not null default false;

alter table public.updates
  add column if not exists author_id uuid references auth.users(id) on delete set null,
  add column if not exists shared_from_post_id uuid references public.posts(id) on delete set null;

create table if not exists public.update_likes (
  update_id uuid not null references public.updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (update_id, user_id)
);

create table if not exists public.update_comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.update_likes enable row level security;
alter table public.update_comments enable row level security;

-- Comments can be read by anyone, while only signed-in users can create/delete theirs.
drop policy if exists "Anyone can read update comments" on public.update_comments;
create policy "Anyone can read update comments"
on public.update_comments for select to public using (true);

drop policy if exists "Signed in users can comment on updates" on public.update_comments;
create policy "Signed in users can comment on updates"
on public.update_comments for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own update comments" on public.update_comments;
create policy "Users can delete their own update comments"
on public.update_comments for delete to authenticated
using (auth.uid() = user_id or public.is_admin());

-- Likes are readable publicly and writable only as the signed-in user.
drop policy if exists "Anyone can read update likes" on public.update_likes;
create policy "Anyone can read update likes"
on public.update_likes for select to public using (true);

drop policy if exists "Signed in users can like updates" on public.update_likes;
create policy "Signed in users can like updates"
on public.update_likes for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can remove their update likes" on public.update_likes;
create policy "Users can remove their update likes"
on public.update_likes for delete to authenticated
using (auth.uid() = user_id);

-- Allow the public search box to find basic profile information.
drop policy if exists "Anyone can search profiles" on public.profiles;
create policy "Anyone can search profiles"
on public.profiles for select to public using (true);

-- Verified users can promote only their own posts into the public Updates feed.
drop policy if exists "Verified users can share posts as updates" on public.updates;
create policy "Verified users can share posts as updates"
on public.updates for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_admin() = false
  and exists (select 1 from public.profiles where id = auth.uid() and verified = true)
);

create index if not exists update_comments_update_idx on public.update_comments (update_id, created_at);
create index if not exists update_likes_update_idx on public.update_likes (update_id);
create index if not exists profiles_search_idx on public.profiles (lower(display_name), lower(username));
