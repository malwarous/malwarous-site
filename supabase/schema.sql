-- ==========================================================================
-- Malwarous — Supabase schema
-- Run this ONCE in your Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- What it creates:
--   profiles           one row per account: public handle + TryHackMe username
--   admins             who is an admin (add rows by hand, see the bottom of this file)
--   guestbook          short messages signed from the console
--   flag_solves        who solved the hidden flag challenge
--   posts              write-ups and opportunities (members submit, admins approve)
--   team_applications  applications to join the team (only admins can read them)
--
-- Admin work happens in the Supabase dashboard (Table Editor):
--   approve a post         posts -> set status to 'approved' (or 'rejected')
--   read applications      team_applications
--   remove a message       guestbook -> delete the row
--
-- Security model: the website's key is public, so EVERY rule that matters
-- lives here, as Row Level Security (RLS) policies and triggers. The browser
-- is never trusted. Anything the page "hides" can still be called directly.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1. Profiles: a public handle (and optional TryHackMe username) per account
-- --------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_-]{3,20}$'),
  -- So admins can match names on TryHackMe room leaderboards to members.
  -- Optional; unique so two accounts can't claim the same TryHackMe name.
  thm_username text unique check (thm_username ~ '^[A-Za-z0-9._-]{1,40}$'),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can see handles (they appear next to posts and guestbook messages).
create policy "handles are public"
  on public.profiles for select
  using (true);

-- There are deliberately NO insert/update/delete policies: profiles are only
-- created by the trigger below, and can't be changed from the site.
-- (Fix a TryHackMe username in the dashboard: Table Editor -> profiles.)

-- When someone signs up, create their profile from what they entered.
-- (signup.html sends it as user metadata.)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, handle, thm_username)
  values (
    new.id,
    lower(new.raw_user_meta_data ->> 'handle'),
    nullif(btrim(new.raw_user_meta_data ->> 'thm_username'), '')
  );
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
-- 5. Posts: write-ups and opportunities
--    Members submit from writeups.html; everything starts as 'pending' and
--    only appears on the site once an admin sets status to 'approved'.
-- --------------------------------------------------------------------------
create table public.posts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('writeup', 'opportunity')),
  title       text not null check (char_length(title) between 5 and 120),
  body        text not null check (char_length(body) between 20 and 4000),
  -- https only: blocks "javascript:" links and other tricks
  link        text check (link ~ '^https://[^[:space:]]+$' and char_length(link) <= 500),
  deadline    date,  -- for opportunities: when applications close
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

alter table public.posts enable row level security;

-- Everyone sees approved posts; authors also see their own pending ones.
create policy "approved posts are public"
  on public.posts for select
  using (status = 'approved' or user_id = auth.uid());

create policy "members can submit posts"
  on public.posts for insert
  to authenticated
  with check (user_id = auth.uid());

-- No update/delete policies: approving, editing and removing posts is done
-- by admins in the dashboard.

-- New posts from the site: force the real author, 'pending', and the time,
-- and allow at most 3 posts per person per day.
-- (Rows an admin adds in the dashboard have no logged-in user, so they're
-- left as typed: admins can add an approved post directly.)
create function public.posts_before_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.user_id     := auth.uid();
    new.status      := 'pending';
    new.created_at  := now();
    new.approved_at := null;

    if (select count(*) from public.posts
        where user_id = new.user_id
          and created_at > now() - interval '1 day') >= 3 then
      raise exception 'slow down: 3 posts a day';
    end if;
  end if;
  return new;
end;
$$;

create trigger posts_rules
  before insert on public.posts
  for each row execute procedure public.posts_before_insert();

-- Stamp the approval time when an admin approves a post
create function public.posts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create trigger posts_approval_time
  before update on public.posts
  for each row execute procedure public.posts_before_update();


-- --------------------------------------------------------------------------
-- 6. Team applications
--    Members apply from team.html. Applications hold personal details, so
--    NOBODY can read them through the website: admins read them in the
--    dashboard (Table Editor -> team_applications).
-- --------------------------------------------------------------------------
create table public.team_applications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  email      text,  -- filled in automatically from the account
  full_name  text not null check (char_length(full_name) between 2 and 80),
  program    text check (char_length(program) <= 80),  -- e.g. "BS CS, 3rd semester"
  skills     text not null check (char_length(skills) between 10 and 1000),
  interest   text not null check (char_length(interest) between 10 and 1000),
  links      text check (char_length(links) <= 300),   -- GitHub, LinkedIn, ...
  created_at timestamptz not null default now()
);

alter table public.team_applications enable row level security;

create policy "members can apply"
  on public.team_applications for insert
  to authenticated
  with check (user_id = auth.uid());

-- No select policy: applicants can't read applications back, and nobody
-- else can either. Only the dashboard (admins) sees them.

-- Force the real author, their account email and the time; one application
-- per person per week.
create function public.applications_before_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.user_id    := auth.uid();
  new.email      := auth.jwt() ->> 'email';
  new.created_at := now();

  if exists (
    select 1 from public.team_applications
    where user_id = new.user_id
      and created_at > now() - interval '7 days'
  ) then
    raise exception 'already applied: one application per week';
  end if;

  return new;
end;
$$;

create trigger applications_rules
  before insert on public.team_applications
  for each row execute procedure public.applications_before_insert();


-- --------------------------------------------------------------------------
-- 7. Permissions for the website's roles
--    anon = visitors who aren't logged in, authenticated = logged-in members.
--    These only open the door; the RLS policies above decide which rows.
-- --------------------------------------------------------------------------
grant select                 on public.profiles          to anon, authenticated;
grant select                 on public.guestbook         to anon, authenticated;
grant insert, delete         on public.guestbook         to authenticated;
grant select                 on public.flag_solves       to anon, authenticated;
grant select                 on public.posts             to anon, authenticated;
grant insert                 on public.posts             to authenticated;
grant insert                 on public.team_applications to authenticated;
grant execute on function public.submit_flag(text) to anon, authenticated;
grant execute on function public.is_admin()        to anon, authenticated;


-- --------------------------------------------------------------------------
-- 8. Making yourself an admin (run AFTER you've signed up on the site)
--    Replace your-handle, then run just these lines:
--
--    insert into public.admins (user_id)
--    select id from public.profiles where handle = 'your-handle';
-- --------------------------------------------------------------------------
