-- Private direct messaging. Run after the existing CampusPulse migrations.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,
  deleted_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default timezone('utc', now()),
  seen_at timestamptz
);

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  message_id uuid references public.direct_messages(id) on delete set null,
  snapshot text not null check (char_length(snapshot) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  check (message_id is not null or reported_user_id is not null)
);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.direct_messages enable row level security;
alter table public.blocks enable row level security;
alter table public.message_reports enable row level security;

-- Protect authorization flags and role data from public profile reads/updates.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, username, bio, avatar_url, created_at) on public.profiles to anon, authenticated;
grant select (id, display_name, username, bio, avatar_url, created_at, verified) on public.profiles to authenticated;

create or replace function public.prevent_profile_privilege_changes()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.verified := old.verified;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privilege_fields on public.profiles;
create trigger protect_profile_privilege_fields before update on public.profiles
for each row execute function public.prevent_profile_privilege_changes();

create or replace function public.is_verified_profile(target_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.profiles where id = target_user and verified = true); $$;

revoke all on function public.is_verified_profile(uuid) from public;
grant execute on function public.is_verified_profile(uuid) to authenticated;

create or replace function public.is_conversation_participant(target_conversation uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = target_conversation and cp.user_id = auth.uid() and cp.deleted_at is null
  );
$$;

revoke all on function public.is_conversation_participant(uuid) from public;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

create or replace function public.is_blocked_with(target_user uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = auth.uid())
  );
$$;

revoke all on function public.is_blocked_with(uuid) from public;
grant execute on function public.is_blocked_with(uuid) to authenticated;

create or replace function public.get_or_create_conversation(other_user_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  found_conversation uuid;
begin
  if current_user_id is null or other_user_id is null or current_user_id = other_user_id then
    raise exception 'A valid signed-in recipient is required';
  end if;
  if exists (
    select 1 from public.blocks
    where (blocker_id = current_user_id and blocked_id = other_user_id)
       or (blocker_id = other_user_id and blocked_id = current_user_id)
  ) then
    raise exception 'Messaging is unavailable for this account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(current_user_id::text, other_user_id::text) || ':' || greatest(current_user_id::text, other_user_id::text), 0));

  select c.id into found_conversation
  from public.conversations c
  where exists (select 1 from public.conversation_participants a where a.conversation_id = c.id and a.user_id = current_user_id and a.deleted_at is null)
    and exists (select 1 from public.conversation_participants b where b.conversation_id = c.id and b.user_id = other_user_id and b.deleted_at is null)
    and (select count(*) from public.conversation_participants p where p.conversation_id = c.id) = 2
  order by c.created_at desc
  limit 1;

  if found_conversation is null then
    insert into public.conversations default values returning id into found_conversation;
    insert into public.conversation_participants (conversation_id, user_id)
    values (found_conversation, current_user_id), (found_conversation, other_user_id);
  end if;
  return found_conversation;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

grant select on public.conversations, public.conversation_participants, public.direct_messages, public.blocks, public.message_reports to authenticated;
grant insert, delete on public.direct_messages to authenticated;
grant insert, delete on public.blocks to authenticated;
grant insert on public.message_reports to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;
grant select (id, conversation_id, sender_id, body, created_at, seen_at) on public.direct_messages to authenticated;
grant select (id, created_at, last_message_at) on public.conversations to authenticated;
grant select (conversation_id, user_id, last_read_at, deleted_at) on public.conversation_participants to authenticated;
grant select (blocker_id, blocked_id, created_at) on public.blocks to authenticated;
grant select (id, reporter_id, reported_user_id, message_id, snapshot, created_at) on public.message_reports to authenticated;

-- Only conversation members may view the thread or participant read markers.
drop policy if exists "Members read conversations" on public.conversations;
create policy "Members read conversations" on public.conversations
for select to authenticated using (public.is_conversation_participant(id));

drop policy if exists "Members read participants" on public.conversation_participants;
create policy "Members read participants" on public.conversation_participants
for select to authenticated using (public.is_conversation_participant(conversation_id));

drop policy if exists "Members update own read marker" on public.conversation_participants;
create policy "Members update own read marker" on public.conversation_participants
for update to authenticated using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.hide_conversation_for_me(target_conversation uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.conversation_participants
  set deleted_at = timezone('utc', now())
  where conversation_id = target_conversation and user_id = auth.uid();
  if not found then raise exception 'Conversation not found'; end if;
end;
$$;

revoke all on function public.hide_conversation_for_me(uuid) from public;
grant execute on function public.hide_conversation_for_me(uuid) to authenticated;

-- Participants may read messages, but membership and block state gate sending.
drop policy if exists "Participants read direct messages" on public.direct_messages;
create policy "Participants read direct messages" on public.direct_messages
for select to authenticated using (public.is_conversation_participant(conversation_id));

drop policy if exists "Participants send direct messages" on public.direct_messages;
create policy "Participants send direct messages" on public.direct_messages
for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_participant(conversation_id)
  and not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = direct_messages.conversation_id
      and cp.user_id <> auth.uid() and cp.deleted_at is null
      and public.is_blocked_with(cp.user_id)
  )
);

drop policy if exists "Users delete own direct messages" on public.direct_messages;
create policy "Users delete own direct messages" on public.direct_messages
for delete to authenticated using (sender_id = auth.uid());

-- Each account can see and manage only blocks it created.
drop policy if exists "Users read own blocks" on public.blocks;
create policy "Users read own blocks" on public.blocks
for select to authenticated using (blocker_id = auth.uid());

drop policy if exists "Users create own blocks" on public.blocks;
create policy "Users create own blocks" on public.blocks
for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists "Users remove own blocks" on public.blocks;
create policy "Users remove own blocks" on public.blocks
for delete to authenticated using (blocker_id = auth.uid());

-- Reports contain only the snapshot explicitly submitted by a participant; admins never get conversation-wide access.
drop policy if exists "Users create message reports" on public.message_reports;
create policy "Users create message reports" on public.message_reports
for insert to authenticated with check (
  reporter_id = auth.uid()
  and message_id is not null
  and exists (
    select 1 from public.direct_messages dm
    where dm.id = message_reports.message_id
      and dm.body = message_reports.snapshot
      and dm.sender_id <> auth.uid()
      and public.is_conversation_participant(dm.conversation_id)
  )
);

drop policy if exists "Reporters read own reports" on public.message_reports;
create policy "Reporters read own reports" on public.message_reports
for select to authenticated using (reporter_id = auth.uid());

drop policy if exists "Admins read submitted message reports" on public.message_reports;
create policy "Admins read submitted message reports" on public.message_reports
for select to authenticated using (public.is_admin());

-- Serialize sends per sender so concurrent requests also respect the one-second rate limit.
create or replace function public.enforce_direct_message_rate_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare last_sent timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 1));
  select max(created_at) into last_sent from public.direct_messages where sender_id = new.sender_id;
  if last_sent is not null and clock_timestamp() - last_sent < interval '1 second' then
    raise exception 'Please wait before sending another message';
  end if;
  return new;
end;
$$;

drop trigger if exists direct_message_rate_limit on public.direct_messages;
create trigger direct_message_rate_limit before insert on public.direct_messages
for each row execute function public.enforce_direct_message_rate_limit();

create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists direct_message_touch_conversation on public.direct_messages;
create trigger direct_message_touch_conversation after insert on public.direct_messages
for each row execute function public.touch_conversation_last_message();

create or replace function public.mark_incoming_messages_seen()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.direct_messages dm
  set seen_at = coalesce(dm.seen_at, new.last_read_at)
  where dm.conversation_id = new.conversation_id
    and dm.sender_id <> new.user_id
    and dm.created_at <= new.last_read_at;
  return new;
end;
$$;

drop trigger if exists mark_incoming_direct_messages_seen on public.conversation_participants;
create trigger mark_incoming_direct_messages_seen after update of last_read_at on public.conversation_participants
for each row when (new.last_read_at is distinct from old.last_read_at)
execute function public.mark_incoming_messages_seen();

create index if not exists direct_messages_conversation_created_idx on public.direct_messages (conversation_id, created_at desc);
create index if not exists conversation_participants_user_idx on public.conversation_participants (user_id);
create index if not exists message_reports_created_idx on public.message_reports (created_at desc);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages') then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
