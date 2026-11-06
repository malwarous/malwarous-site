# malwarous.dev

Website of **Malwarous**, the student-run cybersecurity community at
Quaid-i-Azam University, Islamabad. Plain HTML, CSS and JavaScript (no
framework, no build step), hosted on Cloudflare, with Supabase for accounts.

## What's where

```
public/              everything that goes online (and nothing else)
  index.html         homepage
  events.html        upcoming events + archive of past events
  arena.html         the current TryHackMe room, how to play, rules
  academy.html       degree courses + the cybersecurity journey
  academy-psp.html   PSP course: lecture videos
  writeups.html      write-ups and opportunities (members submit, admins approve)
  hall-of-fame.html  winners and all-time standings
  team.html          members, projects, application form
  code-of-conduct.html
  login.html, signup.html, 404.html
  css/style.css      all styling (colors, fonts, spacing are variables at the top)
  css/experience.css theme, cursor, motion, palette, star (loaded after style.css)
  js/config.js       the settings you edit most (see below)
  js/main.js         interactions shared by every page
  js/ui.js           theme toggle, command palette, live visitors, interactive star
  js/account.js      everything that talks to Supabase (email + Google/GitHub)
layout/              the shared header (top.html) and footer + status bar (bottom.html)
tools/sync-layout.js copies layout/ into every page
tools/serve.js       zero-dependency local preview server
tools/check-site.js  broken-link / missing-include / date check for CI
supabase/            database setup (schema.sql, 002, 003) and setup guide (README.md)
.github/             pull request + issue templates and the CI workflow
wrangler.jsonc       Cloudflare settings: publish only public/
```

## Common updates

| You want to... | Do this |
|---|---|
| Set the next event | `nextEventStart`, `nextEventEnd`, `nextEventTitle`, `nextEventSlug`, `nextEventVenue` and `nextEventUrl` in `public/js/config.js` (leave dates `''` for "tba") |
| Change the event lock time | `nextEventEnd`, and the matching room's `closes` value, in `public/js/config.js` |
| Post a new arena room (every 10 days) | `rooms` in `public/js/config.js`: fill in the "coming soon" entry (name, link, opens, closes), then add a new "coming soon" entry after it |
| Add a PSP lecture video | Copy a `<li class="lesson">` block in `academy-psp.html` (instructions in the comment there) |
| Add the arena walkthrough video | Put the YouTube ID in `data-youtube=""` in `arena.html` |
| Add results | Copy the `// 01` section in `hall-of-fame.html`, update `// 02`, and the top-5 table on the homepage |
| Add a team member or project | Copy a `<li class="member">` or `<li class="project">` block in `team.html` |
| Add an event | Copy a row in the events tables (`events.html` and the homepage) |
| Change the nav or footer | Edit `layout/top.html` or `layout/bottom.html`, then run `node tools/sync-layout.js` |

Never edit between the `<!-- layout:top -->` / `<!-- layout:bottom -->` markers inside a page:
the sync script overwrites that part.

## Preview and publish

- **Preview (recommended):** `npm run dev`, then open <http://127.0.0.1:3000>.
  This serves only `public/`, like Cloudflare does, and makes OAuth redirects
  work. No `npm install` is needed; there are no dependencies.
- **Quick look:** double-click `public/index.html` (OAuth and redirects will
  not work from `file://`).
- **Check before pushing:** `npm run check` (broken links, missing includes,
  unparseable event dates). CI runs the same script.
- **Publish:** open a pull request, get it reviewed, merge to `main`.
  Cloudflare updates malwarous.dev in a minute or two. Do not push directly
  to `main`.

New to the workflow? Read [`CONTRIBUTING.md`](CONTRIBUTING.md). It covers
branches, forks, sync with `main`, worktrees and the review checklist.

## Accounts and sign-in

Email/password and Google/GitHub sign-in both run through Supabase. The site
code is ready, but the providers must be enabled in the Supabase dashboard
first. Steps, callback URLs and the `003-oauth.sql` migration are in
[`supabase/README.md`](supabase/README.md).

The Supabase publishable key in `public/js/config.js` is public on purpose.
Never put the `service_role` key in the site or in git.

## Admin work

Approving posts, reading team applications and removing guestbook messages all
happen in the Supabase dashboard (Table Editor). See `supabase/README.md`.
