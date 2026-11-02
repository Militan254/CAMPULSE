-- CampusPulse Phase 2 backend additions.
-- Run this file in the Supabase SQL Editor before using Account or Chat.

create extension if not exists pgcrypto;

alter table public.listings
  add column if not exists image_url text,
  add column if not exists availability text not null default 'full'
    check (availability in ('full', 'available'));

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Student')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

-- Profiles are private to their owner.
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Everyone signed in can read the campus chat; users can only post as themselves.
drop policy if exists "Signed in users can read chat" on public.messages;
create policy "Signed in users can read chat"
on public.messages for select
to authenticated
using (true);

drop policy if exists "Signed in users can send chat messages" on public.messages;
create policy "Signed in users can send chat messages"
on public.messages for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chat messages" on public.messages;
create policy "Users can delete their own chat messages"
on public.messages for delete
to authenticated
using (auth.uid() = user_id);

-- Keep the existing public read experience while explicitly allowing the seed rows.
insert into public.updates (title, body, category, source_type, pinned)
select * from (values
  (
    'Lecturers strike set to end this Friday',
    'The lecturers strike is set to end this Friday. Please watch for official campus communication about the return to normal teaching schedules.',
    'strike', 'official', true
  ),
  (
    'Inter-university games next month',
    'The inter-university games will be held next month on the 14th at Great Lakes University.',
    'sports', 'official', false
  ),
  (
    'Return your gowns by 12 November',
    'Graduation gowns should be returned by 12 November. Contact the relevant campus office if you need help with the return process.',
    'notice', 'official', false
  ),
  (
    'Prince Indah Live at Triple X Lounge',
    'Prince Indah Live at Triple X Lounge Kasarani on 29 October.',
    'event', 'unverified', false
  )
) as seed(title, body, category, source_type, pinned)
where not exists (
  select 1 from public.updates existing where existing.title = seed.title
);

insert into public.listings
  (title, price, area, distance_to_campus, water_available, security_notes, contact, image_url, availability)
select * from (values
  ('Sunrise Bedsitter', 8500, 'Kasarani', '1.8 km from main gate', true, 'Gated compound with night guard', '+254700000001', '/SAV.jpeg', 'full'),
  ('Great Lakes Hostels', 7000, 'Milimani', '1.2 km from main gate', true, 'Controlled entrance and perimeter lighting', '+254700000002', '/SAV.jpeg', 'full'),
  ('Student Corner Rooms', 6000, 'Mamboleo', '2.5 km from main gate', false, 'Shared compound with caretaker', '+254700000003', '/SAV.jpeg', 'full'),
  ('Lakeview Apartments', 12000, 'Kisumu CBD', '3.4 km from main gate', true, 'Secure parking and staffed gate', '+254700000004', '/SAV.jpeg', 'full')
) as seed(title, price, area, distance_to_campus, water_available, security_notes, contact, image_url, availability)
where not exists (
  select 1 from public.listings existing where existing.title = seed.title
);

create index if not exists messages_created_at_idx on public.messages (created_at);

-- Needed only if you want live chat updates through Supabase Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
