-- Complete relational schema for the Lost & Found DBMS project.
-- PostgreSQL 14+; compatible with a later Supabase deployment.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create type public.item_kind as enum ('lost', 'found');
create type public.item_status as enum ('open', 'claimed', 'reunited', 'archived');
create type public.claim_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.notification_type as enum ('claim_received', 'claim_updated', 'message_received', 'item_status_changed');

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text unique,
  supabase_auth_user_id uuid unique,
  email citext unique,
  display_name text not null default 'User' check (char_length(trim(display_name)) between 1 and 120),
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  migrated_at timestamptz
);

create table public.roles (
  id smallint generated always as identity primary key,
  name text not null unique check (name in ('user', 'moderator', 'admin')),
  description text
);

create table public.user_roles (
  user_id uuid not null references public.app_users(id) on delete cascade,
  role_id smallint not null references public.roles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table public.categories (
  id smallint generated always as identity primary key,
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  icon text,
  active boolean not null default true
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz not null default now(),
  check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  owner_id uuid not null references public.app_users(id) on delete restrict,
  category_id smallint not null references public.categories(id) on delete restrict,
  location_id uuid references public.locations(id) on delete set null,
  kind public.item_kind not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null check (char_length(trim(description)) between 1 and 5000),
  occurred_on date,
  contact text,
  status public.item_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  storage_path text not null unique,
  public_url text,
  alt_text text,
  position smallint not null default 1 check (position > 0),
  uploaded_at timestamptz not null default now(),
  unique (item_id, position)
);

create table public.tags (
  id smallint generated always as identity primary key,
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$')
);

create table public.item_tags (
  item_id uuid not null references public.items(id) on delete cascade,
  tag_id smallint not null references public.tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

create table public.item_status_history (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  changed_by uuid references public.app_users(id) on delete set null,
  old_status public.item_status,
  new_status public.item_status not null,
  note text,
  changed_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  claimant_id uuid not null references public.app_users(id) on delete restrict,
  status public.claim_status not null default 'pending',
  claim_message text not null check (char_length(trim(claim_message)) between 10 and 3000),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reviewed_by is null and reviewed_at is null) or (reviewed_by is not null and reviewed_at is not null)),
  check (claimant_id <> reviewed_by)
);

create unique index claims_one_active_claim_per_user_idx
  on public.claims (item_id, claimant_id) where status in ('pending', 'approved');

create table public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('photo', 'document', 'description')),
  content text not null,
  submitted_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.app_users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  sent_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  claim_id uuid references public.claims(id) on delete cascade,
  type public.notification_type not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  legacy_firestore_id text unique,
  sender_id uuid references public.app_users(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 200),
  email citext not null,
  subject text not null check (char_length(trim(subject)) between 1 and 300),
  message text not null check (char_length(trim(message)) between 10 and 10000),
  created_at timestamptz not null default now()
);

create index items_browse_idx on public.items (kind, status, created_at desc);
create index items_owner_idx on public.items (owner_id, created_at desc);
create index items_category_idx on public.items (category_id);
create index items_location_idx on public.items (location_id);
create index items_title_trgm_idx on public.items using gin (title gin_trgm_ops);
create index items_description_trgm_idx on public.items using gin (description gin_trgm_ops);
create index claims_item_idx on public.claims (item_id, status, created_at desc);
create index messages_conversation_idx on public.messages (conversation_id, sent_at);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);
create index item_status_history_item_idx on public.item_status_history (item_id, changed_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger items_set_updated_at before update on public.items
for each row execute function public.set_updated_at();
create trigger claims_set_updated_at before update on public.claims
for each row execute function public.set_updated_at();

insert into public.roles (name, description) values
  ('user', 'Standard community member'),
  ('moderator', 'Can review claims and moderate content'),
  ('admin', 'Full platform administration');

insert into public.categories (name, slug, icon) values
  ('Electronics', 'electronics', '💻'), ('Clothing', 'clothing', '👕'),
  ('Jewelry', 'jewelry', '💍'), ('Documents', 'documents', '📄'),
  ('Bags', 'bags', '👜'), ('Keys', 'keys', '🔑'), ('Wallet', 'wallet', '👛'),
  ('Pet', 'pet', '🐾'), ('Other', 'other', '📦');

commit;

-- Supabase browser access. The anon key is safe to publish only with these policies.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.app_users
    set supabase_auth_user_id = new.id,
        email = new.email,
        display_name = coalesce(new.raw_user_meta_data ->> 'display_name', display_name)
    where id = (select u.id from public.app_users u
      where u.supabase_auth_user_id = new.id or (new.email is not null and u.email = new.email)
      order by (u.supabase_auth_user_id = new.id) desc nulls last limit 1);
  if not found then
    insert into public.app_users (supabase_auth_user_id, email, display_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', 'User'));
  end if;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_new_auth_user();

alter table public.app_users enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.items enable row level security;
alter table public.item_images enable row level security;
alter table public.contact_messages enable row level security;

create policy "categories are readable" on public.categories for select to anon, authenticated using (active);
create policy "profiles readable by owner" on public.app_users for select to authenticated
  using (supabase_auth_user_id = (select auth.uid()));
create policy "locations readable" on public.locations for select to anon, authenticated using (true);
create policy "authenticated users can add locations" on public.locations for insert to authenticated with check (true);
create policy "items are publicly readable" on public.items for select to anon, authenticated using (true);
create policy "users create their own items" on public.items for insert to authenticated
  with check (owner_id = (select id from public.app_users where supabase_auth_user_id = (select auth.uid())));
create policy "users update their own items" on public.items for update to authenticated
  using (owner_id = (select id from public.app_users where supabase_auth_user_id = (select auth.uid())))
  with check (owner_id = (select id from public.app_users where supabase_auth_user_id = (select auth.uid())));
create policy "users delete their own items" on public.items for delete to authenticated
  using (owner_id = (select id from public.app_users where supabase_auth_user_id = (select auth.uid())));
create policy "item images are publicly readable" on public.item_images for select to anon, authenticated using (true);
create policy "users add images to own items" on public.item_images for insert to authenticated
  with check (exists (select 1 from public.items i join public.app_users u on u.id = i.owner_id
    where i.id = item_id and u.supabase_auth_user_id = (select auth.uid())));
create policy "users remove images from own items" on public.item_images for delete to authenticated
  using (exists (select 1 from public.items i join public.app_users u on u.id = i.owner_id
    where i.id = item_id and u.supabase_auth_user_id = (select auth.uid())));
create policy "anyone can send contact messages" on public.contact_messages for insert to anon, authenticated
  with check (true);

grant select on public.categories, public.locations, public.items, public.item_images to anon, authenticated;
grant select, insert, update, delete on public.locations, public.items, public.item_images to authenticated;
grant select on public.app_users to authenticated;
grant insert on public.contact_messages to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "item images are publicly downloadable" on storage.objects for select to anon, authenticated
  using (bucket_id = 'item-images');
create policy "users upload to their own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users delete from their own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'item-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
