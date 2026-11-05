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
  login.html, signup.html, 404.html
  css/style.css      all styling (colors, fonts, spacing are variables at the top)
  js/config.js       the settings you edit most (see below)
  js/main.js         interactions shared by every page
  js/account.js      everything that talks to Supabase
layout/              the shared header (top.html) and footer + status bar (bottom.html)
tools/sync-layout.js copies layout/ into every page
supabase/            database setup (schema.sql) and how to switch accounts on (README.md)
wrangler.jsonc       Cloudflare settings: publish only public/
```

## Common updates

| You want to... | Do this |
|---|---|
| Set the next event's countdown | `nextEventStart` in `public/js/config.js` (leave `''` for "tba") |
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

- **Preview:** double-click `public/index.html`.
- **Publish:** commit and push. Cloudflare updates malwarous.dev in a minute or two.
  ```
  git add .
  git commit -m "what you changed"
  git push
  ```

## Admin work

Approving posts, reading team applications and removing guestbook messages all
happen in the Supabase dashboard (Table Editor). See `supabase/README.md`.
