-- ==========================================================================
-- Malwarous — Supabase schema
-- Run this ONCE in your Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- What it creates:
--   profiles     one row per account: the public handle
--   admins       who is an admin (add rows by hand, see the bottom of this file)
--   guestbook    short messages signed from the console
--   flag_solves  who solved the hidden flag challenge
--
-- Security model: the website's key is public, so EVERY rule that matters
-- lives here, as Row Level Security (RLS) policies and triggers. The browser
-- is never trusted. Anything the page "hides" can still be called directly.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1. Profiles: a public handle for every account
-- --------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  handle     text not null unique check (handle ~ '^[a-z0-9_-]{3,20}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can see handles (they appear next to guestbook messages).
create policy "handles are public"
  on public.profiles for select
  using (true);

-- There are deliberately NO insert/update/delete policies: profiles are only
-- created by the trigger below, and handles can't be changed from the site.

-- When someone signs up, create their profile from the handle they chose.
-- (signup.html sends it as user metadata.)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, lower(new.raw_user_meta_data ->> 'handle'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- --------------------------------------------------------------------------
-- 2. Admins
-- --------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade
);

alter table public.admins enable row level security;
-- No policies at all: nobody can read or change this table through the
-- website. You manage it from the dashboard (see the bottom of this file).

-- True if the person making the request is an admin.
create function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;


-- --------------------------------------------------------------------------
-- 3. Guestbook
-- --------------------------------------------------------------------------
create table public.guestbook (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message    text not null
             check (char_length(message) between 1 and 140)  -- short, like the console
             check (message !~ '[[:cntrl:]]'),                -- no newlines: can't fake console output
  created_at timestamptz not null default now()
);

alter table public.guestbook enable row level security;

create policy "anyone can read the guestbook"
  on public.guestbook for select
  using (true);

create policy "members can sign as themselves"
  on public.guestbook for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "authors and admins can delete"
  on public.guestbook for delete
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No update policy: messages can't be edited, only deleted.

-- Before every new message: force the real author and time, trim spaces,
-- and allow one message per person every 2 minutes.
create function public.guestbook_before_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.user_id    := auth.uid();
  new.created_at := now();
  new.message    := btrim(new.message);

  if exists (
    select 1 from public.guestbook
    where user_id = new.user_id
      and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'slow down: one message every 2 minutes';
  end if;

  return new;
end;
$$;

create trigger guestbook_rate_limit
  before insert on public.guestbook
  for each row execute procedure public.guestbook_before_insert();


-- --------------------------------------------------------------------------
-- 4. Hidden flag challenge
-- --------------------------------------------------------------------------
create table public.flag_solves (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  solved_at timestamptz not null default now()
);

alter table public.flag_solves enable row level security;

create policy "solves are public"
  on public.flag_solves for select
  using (true);

-- No insert policy: a solve can only be recorded by submit_flag() below,
-- which checks the answer on the server. Faking a solve from the browser
-- doesn't work.

-- The flag is never stored here, only its SHA-256 hash. If you change the
-- flag, update this hash AND the one in js/main.js (FLAG_SHA256).
create function public.submit_flag(guess text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  correct boolean := encode(sha256(convert_to(btrim(guess), 'UTF8')), 'hex')
                     = 'f232a87719796a811e477e5114f60c08f364c1ce35857b6c3c98daf153819049';
begin
  if correct and auth.uid() is not null then
    insert into public.flag_solves (user_id) values (auth.uid())
    on conflict do nothing;
  end if;
  return correct;
end;
$$;


-- --------------------------------------------------------------------------
-- 5. Permissions for the website's roles
--    anon = visitors who aren't logged in, authenticated = logged-in members.
--    These only open the door; the RLS policies above decide which rows.
-- --------------------------------------------------------------------------
grant select                 on public.profiles    to anon, authenticated;
grant select                 on public.guestbook   to anon, authenticated;
grant insert, delete         on public.guestbook   to authenticated;
grant select                 on public.flag_solves to anon, authenticated;
grant execute on function public.submit_flag(text) to anon, authenticated;
grant execute on function public.is_admin()        to anon, authenticated;


-- --------------------------------------------------------------------------
-- 6. Making yourself an admin (run AFTER you've signed up on the site)
--    Replace your-handle, then run just these lines:
--
--    insert into public.admins (user_id)
--    select id from public.profiles where handle = 'your-handle';
-- --------------------------------------------------------------------------
