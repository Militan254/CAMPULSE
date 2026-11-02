-- 1. Blocks can't be bypassed by hiding a conversation
drop policy if exists "Participants send direct messages" on public.direct_messages;
create policy "Participants send direct messages" on public.direct_messages
for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_participant(conversation_id)
  and not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = direct_messages.conversation_id
      and cp.user_id <> auth.uid()
      and public.is_blocked_with(cp.user_id)
  )
);

-- 2. Users may only insert the columns they should control
revoke insert on public.direct_messages from authenticated;
grant insert (conversation_id, sender_id, body) on public.direct_messages to authenticated;

-- 3. A new message brings a hidden conversation back for the other person
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_participants set deleted_at = null
  where conversation_id = new.conversation_id and user_id <> new.sender_id and deleted_at is not null;
  return new;
end;
$$;

-- 4. Verified users can't label their shared updates "official" or pin them
drop policy if exists "Verified users can share posts as updates" on public.updates;
create policy "Verified users can share posts as updates"
on public.updates for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_admin() = false
  and source_type in ('leader', 'unverified')
  and pinned = false
  and exists (select 1 from public.profiles where id = auth.uid() and verified = true)
);

-- 5. post-media: own folder only, size and type limits, owners and admins can delete
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm',
      'video/quicktime','audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/wav']
where id = 'post-media';

drop policy if exists "Signed in users can upload post media" on storage.objects;
drop policy if exists "Users upload post media to own folder" on storage.objects;
create policy "Users upload post media to own folder" on storage.objects
for insert to authenticated
with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners or admins delete post media" on storage.objects;
create policy "Owners or admins delete post media" on storage.objects
for delete to authenticated
using (bucket_id = 'post-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 6. Admins can moderate posts
drop policy if exists "Admins can delete any post" on public.posts;
create policy "Admins can delete any post" on public.posts
for delete to authenticated using (public.is_admin());

drop policy if exists "Admins can update any post" on public.posts;
create policy "Admins can update any post" on public.posts
for update to authenticated using (public.is_admin()) with check (public.is_admin());