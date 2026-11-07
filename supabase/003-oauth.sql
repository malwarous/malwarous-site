-- ==========================================================================
-- Malwarous — migration 003: Google / GitHub sign-in
--
-- Run this AFTER schema.sql, once, in the Supabase dashboard:
--   SQL Editor -> New query -> paste -> Run.
--
-- Why it exists: the original handle_new_user() required a "handle" in the
-- signup metadata. Google and GitHub don't send one, so those signups failed
-- with "Database error saving new user".
--
-- What it does:
--   * adds profiles.auto_handle (true = a handle was generated for you)
--   * creates a safe, unique handle for OAuth signups
--   * lets an OAuth member claim a real handle once
--   * adds ensure_profile(), a repair path for a missing profile row
--
-- The database is still the security boundary. claim_handle() only works for
-- the logged-in user and only while their handle is still generated.
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1. Mark generated handles
-- --------------------------------------------------------------------------
alter table public.profiles
  add column if not exists auto_handle boolean not null default false;


-- --------------------------------------------------------------------------
-- 2. Turn names / emails into a valid unused handle
--    Examples: "Hasnaat Hussain" -> hasnaat, "a@b.com" -> a-1 (then member-2)
-- --------------------------------------------------------------------------
create or replace function public.safe_handle(p_meta jsonb, p_email text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  base      text;
  candidate text;
  attempt   int := 0;
begin
  base := lower(coalesce(
    p_meta ->> 'user_name',
    p_meta ->> 'preferred_username',
    split_part(coalesce(p_meta ->> 'name', ''), ' ', 1),
    split_part(coalesce(p_email, ''), '@', 1),
    'member'
  ));

  -- Keep only characters the profiles table allows.
  base := regexp_replace(base, '[^a-z0-9_-]', '', 'g');
  base := left(base, 16);
  if length(base) < 3 then
    base := 'member';
  end if;

  candidate := base;
  loop
    exit when not exists (select 1 from public.profiles where handle = candidate);
    attempt := attempt + 1;
    candidate := left(base, 20 - length(attempt::text) - 1) || '-' || attempt::text;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.safe_handle(jsonb, text) from public;


-- --------------------------------------------------------------------------
-- 3. Create the profile for every new auth user
--    Email signup still supplies its chosen handle. OAuth gets a generated
--    one and can replace it with claim_handle() below.
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')));
  thm       text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'thm_username', '')), '');
  base      text;
  candidate text;
  attempt   int := 0;
begin
  -- A valid handle from signup.html: keep it exactly as typed.
  if requested <> '' and requested ~ '^[a-z0-9_-]{3,20}$' then
    insert into public.profiles (id, handle, thm_username, auto_handle)
    values (new.id, requested, thm, false);
    return new;
  end if;

  -- OAuth: derive a readable base, then find a free handle.
  base := lower(coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    split_part(coalesce(new.raw_user_meta_data ->> 'name', ''), ' ', 1),
    split_part(coalesce(new.email, ''), '@', 1),
    'member'
  ));
  base := regexp_replace(base, '[^a-z0-9_-]', '', 'g');
  base := left(base, 16);
  if length(base) < 3 then
    base := 'member';
  end if;

  loop
    attempt := attempt + 1;
    if attempt = 1 then
      candidate := base;
    else
      candidate := left(base, 20 - length(attempt::text) - 1) || '-' || attempt::text;
    end if;

    begin
      insert into public.profiles (id, handle, thm_username, auto_handle)
      values (new.id, candidate, thm, true);
      return new;
    exception when unique_violation then
      -- Another signup grabbed that handle in the last millisecond.
      if attempt >= 50 then
        raise;
      end if;
    end;
  end loop;
end;
$$;


-- --------------------------------------------------------------------------
-- 4. Claim a real handle (OAuth accounts only)
-- --------------------------------------------------------------------------
create or replace function public.claim_handle(p_handle text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted text := lower(btrim(coalesce(p_handle, '')));
  uid    uuid := auth.uid();
begin
  if uid is null then
    raise exception 'log in first';
  end if;

  if wanted !~ '^[a-z0-9_-]{3,20}$' then
    raise exception 'handles are 3 to 20 characters: a-z, 0-9, _ and -';
  end if;

  update public.profiles
     set handle = wanted,
         auto_handle = false
   where id = uid
     and auto_handle = true;

  if not found then
    raise exception 'this account already has a handle';
  end if;

  return wanted;
exception
  when unique_violation then
    raise exception 'that handle is taken. pick another.';
end;
$$;

grant execute on function public.claim_handle(text) to authenticated;


-- --------------------------------------------------------------------------
-- 5. Repair path: if an auth user somehow has no profile row, create one.
--    The website calls this only after a profile lookup comes back empty.
-- --------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  meta    jsonb;
  email   text;
  current text;
begin
  if uid is null then
    raise exception 'log in first';
  end if;

  select handle into current from public.profiles where id = uid;
  if found then
    return current;
  end if;

  select raw_user_meta_data, email into meta, email
    from auth.users
   where id = uid;

  current := public.safe_handle(meta, email);

  insert into public.profiles (id, handle, auto_handle)
  values (uid, current, true)
  on conflict (id) do nothing;

  select handle into current from public.profiles where id = uid;
  return current;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;


-- --------------------------------------------------------------------------
-- 6. Sanity check (optional; run after testing a Google/GitHub signup):
--
--    select p.handle, p.auto_handle, u.email
--      from public.profiles p join auth.users u on u.id = p.id
--     order by p.created_at desc
--     limit 10;
-- --------------------------------------------------------------------------
