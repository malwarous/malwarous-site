-- ==========================================================================
-- Malwarous — event registrations (part 2)
-- Run this ONCE in the SQL Editor, AFTER schema.sql.
--
-- What it creates:
--   events         one row per event people can register for (admins add rows)
--   registrations  who registered for what (members see only their own,
--                  admins see everything in the Table Editor)
--   event_status() public seat count for an event, without revealing who registered
--
-- Admin work (Table Editor):
--   new event          events -> insert row (slug, title, starts_at, capacity)
--   close registration events -> registration_open = false
--   see who registered registrations -> filter by event_slug, export as CSV
-- ==========================================================================


-- --------------------------------------------------------------------------
-- 1. Events
-- --------------------------------------------------------------------------
create table public.events (
  -- short id used in links: register.html?event=<slug>
  slug              text primary key check (slug ~ '^[a-z0-9-]{3,60}$'),
  title             text not null check (char_length(title) between 3 and 160),
  starts_at         timestamptz,               -- registration closes when it starts
  capacity          int check (capacity > 0),  -- seat limit; empty = no limit
  registration_open boolean not null default true,
  created_at        timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "events are public"
  on public.events for select
  using (true);

-- No insert/update/delete policies: admins manage events in the dashboard.


-- --------------------------------------------------------------------------
-- 2. Registrations
-- --------------------------------------------------------------------------
create table public.registrations (
  id          bigint generated always as identity primary key,
  event_slug  text not null references public.events (slug) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  email       text,  -- filled in automatically from the account
  team_name   text check (char_length(team_name) between 2 and 60),  -- empty = going solo
  university  text not null check (char_length(university) between 2 and 120),
  created_at  timestamptz not null default now(),
  unique (event_slug, user_id)  -- one registration per person per event
);

alter table public.registrations enable row level security;

-- Members only ever see their own registrations
create policy "members see their own registrations"
  on public.registrations for select
  to authenticated
  using (user_id = auth.uid());

create policy "members register themselves"
  on public.registrations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "members cancel their own registration"
  on public.registrations for delete
  to authenticated
  using (user_id = auth.uid());

-- Before every new registration: force the real person, their email and
-- the time, then check the event is open, hasn't started, and isn't full.
create function public.registrations_before_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  ev    public.events;
  taken int;
begin
  new.user_id    := auth.uid();
  new.email      := auth.jwt() ->> 'email';
  new.created_at := now();
  new.team_name  := nullif(btrim(new.team_name), '');
  new.university := btrim(new.university);

  -- "for update" makes two people grabbing the last seat wait in line
  select * into ev from public.events where slug = new.event_slug for update;

  if not found then
    raise exception 'closed: this event does not take registrations';
  end if;
  if not ev.registration_open or (ev.starts_at is not null and now() >= ev.starts_at) then
    raise exception 'closed: registration for this event is closed';
  end if;

  if ev.capacity is not null then
    select count(*) into taken from public.registrations where event_slug = new.event_slug;
    if taken >= ev.capacity then
      raise exception 'full: no seats left for this event';
    end if;
  end if;

  return new;
end;
$$;

create trigger registrations_rules
  before insert on public.registrations
  for each row execute procedure public.registrations_before_insert();


-- --------------------------------------------------------------------------
-- 3. Public seat count
--    Anyone can ask "how many seats are taken?" without seeing who.
-- --------------------------------------------------------------------------
create function public.event_status(p_slug text)
returns json
language sql
stable
security definer set search_path = ''
as $$
  select json_build_object(
    'title',      e.title,
    'starts_at',  e.starts_at,
    'capacity',   e.capacity,
    'registered', (select count(*) from public.registrations r where r.event_slug = e.slug),
    'open',       e.registration_open and (e.starts_at is null or now() < e.starts_at)
  )
  from public.events e
  where e.slug = p_slug;
$$;


-- --------------------------------------------------------------------------
-- 4. Permissions
-- --------------------------------------------------------------------------
grant select                 on public.events        to anon, authenticated;
grant select, insert, delete on public.registrations to authenticated;
grant execute on function public.event_status(text)  to anon, authenticated;


-- --------------------------------------------------------------------------
-- 5. The first event (the info session on 4 Nov)
--    capacity null = no seat limit. Set a number to cap it.
-- --------------------------------------------------------------------------
insert into public.events (slug, title, starts_at, capacity)
values (
  'info-session-nov-2026',
  'Information Session: Malwarous Website and Online Weekly CTFs',
  '2026-11-04 10:00:00+05',
  null
);
