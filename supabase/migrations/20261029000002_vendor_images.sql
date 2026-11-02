-- Add image support for admin-managed vendors.
-- Run after 20261029000000_admin_dashboard.sql.

alter table public.vendors
  add column if not exists image_url text;
