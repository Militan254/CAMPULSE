-- CampusPulse admin dashboard and managed content.
-- Run after the earlier CampusPulse migrations.
-- Create the Auth user with email YOUR_ADMIN_EMAIL in Supabase Auth first.
-- Set its password in the Supabase Auth dashboard, then run this migration.

alter table public.profiles
  add column if not exists role text not null default 'student'
    check (role in ('student', 'admin'));


create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Protect authorization fields: profile owners may edit descriptive fields only.
create or replace function public.prevent_profile_privilege_changes()
returns trigger
language plpgsql
set search_path = public
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
create trigger protect_profile_privilege_fields
before update on public.profiles
for each row execute function public.prevent_profile_privilege_changes();

revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Admin-only content management policies.
drop policy if exists "Admins can create updates" on public.updates;
create policy "Admins can create updates" on public.updates for insert to authenticated
with check (public.is_admin());
drop policy if exists "Admins can update updates" on public.updates;
create policy "Admins can update updates" on public.updates for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can delete updates" on public.updates;
create policy "Admins can delete updates" on public.updates for delete to authenticated
using (public.is_admin());

drop policy if exists "Admins can create listings" on public.listings;
create policy "Admins can create listings" on public.listings for insert to authenticated
with check (public.is_admin());
drop policy if exists "Admins can update listings" on public.listings;
create policy "Admins can update listings" on public.listings for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can delete listings" on public.listings;
create policy "Admins can delete listings" on public.listings for delete to authenticated
using (public.is_admin());

drop policy if exists "Admins can create vendors" on public.vendors;
create policy "Admins can create vendors" on public.vendors for insert to authenticated
with check (public.is_admin());
drop policy if exists "Admins can update vendors" on public.vendors;
create policy "Admins can update vendors" on public.vendors for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can delete vendors" on public.vendors;
create policy "Admins can delete vendors" on public.vendors for delete to authenticated
using (public.is_admin());

insert into public.vendors (name, type, area, price_info, contact)
select * from (values
  ('Lakeview Water Point', 'water', 'Milimani', '20L refill from KSh 30', '+254700000101'),
  ('Campus Gas Centre', 'gas', 'Behind Main Gate', '6kg refill from KSh 1,500', '+254700000102'),
  ('Mama Achieng Kitchen', 'food', 'Town Side', 'Meals from KSh 100', '+254700000103'),
  ('PrintHub Campus', 'print', 'Opposite Main Gate', 'Printing from KSh 5 per page', '+254700000104'),
  ('Student Choice Shop', 'shop', 'Kisumu CBD', 'Daily essentials and stationery', '+254700000105')
) as seed(name, type, area, price_info, contact)
where not exists (
  select 1 from public.vendors existing where existing.name = seed.name
);

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true), ('vendor-images', 'vendor-images', true)
on conflict (id) do update set public = true;

-- Replace broad update-image uploads with admin-only uploads.
drop policy if exists "Signed in users can upload update images" on storage.objects;
create policy "Admins can upload update images" on storage.objects for insert to authenticated
with check (bucket_id = 'update-images' and public.is_admin());
create policy "Admins can update update images" on storage.objects for update to authenticated
using (bucket_id = 'update-images' and public.is_admin())
with check (bucket_id = 'update-images' and public.is_admin());
create policy "Admins can delete update images" on storage.objects for delete to authenticated
using (bucket_id = 'update-images' and public.is_admin());

create policy "Admins can upload listing images" on storage.objects for insert to authenticated
with check (bucket_id = 'listing-images' and public.is_admin());
create policy "Admins can update listing images" on storage.objects for update to authenticated
using (bucket_id = 'listing-images' and public.is_admin())
with check (bucket_id = 'listing-images' and public.is_admin());
create policy "Admins can delete listing images" on storage.objects for delete to authenticated
using (bucket_id = 'listing-images' and public.is_admin());

create policy "Admins can upload vendor images" on storage.objects for insert to authenticated
with check (bucket_id = 'vendor-images' and public.is_admin());
create policy "Admins can update vendor images" on storage.objects for update to authenticated
using (bucket_id = 'vendor-images' and public.is_admin())
with check (bucket_id = 'vendor-images' and public.is_admin());
create policy "Admins can delete vendor images" on storage.objects for delete to authenticated
using (bucket_id = 'vendor-images' and public.is_admin());
