# Contributing to malwarous.dev

Thanks for helping. This is a small, deliberately boring stack: plain HTML,
CSS and JavaScript, no build step, no dependencies. That is a feature. Keep it
that way unless there is a very good reason not to.

By contributing you agree to the [code of conduct](CODE_OF_CONDUCT.md) and to
hack only with permission.

## Do I need to fork?

- **If you have write access to `malwarous/malwarous-site`:** no. Work on a
  branch in the same repository and open a pull request. This keeps CI,
  secrets and review in one place.
- **If you do not have write access:** yes, fork the repository, push your
  branch to your fork, and open a pull request against `malwarous/malwarous-site`.
  Keep your fork's `main` up to date with the upstream repository (see below).

Never push directly to `main`, even if you can. A branch plus a pull request
gives everyone a chance to review, and gives Cloudflare one clean commit to
deploy.

## Local setup

You need Node.js 18 or newer. There is nothing to install.

```bash
git clone https://github.com/malwarous/malwarous-site.git
cd malwarous-site
npm run dev
```

Open <http://127.0.0.1:3000>. The server serves only `public/`, exactly like
Cloudflare does, so a missing file shows up locally instead of in production.
Use `PORT=8080 npm run dev` (PowerShell: `$env:PORT=8080; npm run dev`) if 3000
is busy.

Double-clicking `public/index.html` still works for quick visual checks, but
OAuth and other redirect-based features need the local server.

## Branch and commit

```bash
git switch main
git pull
git switch -c feat/visitor-count
```

Prefixes: `feat/`, `fix/`, `docs/`, `chore/`. One topic per branch.

Write commit messages in the imperative, short and specific:

```text
Add live visitor count to the status bar
Fix arena room closing before the countdown
```

Avoid `update stuff` and `final final v2`. If a commit needs a paragraph, add
one after a blank line explaining **why**, not just what.

## Before you open a pull request

```bash
npm run check
```

This catches broken local links, pages missing the experience layer or layout
markers, and unparseable event dates. Then check by hand:

- [ ] The page works at phone width (360px), tablet width and desktop.
- [ ] Light mode and dark mode both look right.
- [ ] Keyboard only: Tab reaches every control, Escape closes dialogs.
- [ ] `prefers-reduced-motion` still gives a usable page.
- [ ] No console errors.
- [ ] If you touched auth, try email login as well as Google/GitHub.

## Things that bite people

### The shared header and footer

`layout/top.html` and `layout/bottom.html` are copied into every page. Edit the
layout file, then run:

```bash
npm run sync
```

Never edit between `<!-- layout:top -->` and `<!-- layout:bottom -->` inside a
page: the next sync overwrites it. `404.html` is deliberately standalone and
uses absolute `/css` and `/js` paths.

### Event dates

The countdown, the visible date, the lock time, the calendar file and the
event status all come from `public/js/config.js`. Change the config, not the
HTML. If an event row opts in with `data-event-start="nextEventStart"`, it
follows the config automatically.

### Supabase

- The anon/publishable key is public on purpose. Never put the
  `service_role` key in the site or in git.
- Database changes are numbered migrations: `supabase/schema.sql`,
  `002-registrations.sql`, `003-oauth.sql`. Add a new file; do not rewrite a
  migration that has already been run in production.
- Security lives in Row Level Security policies, not in `account.js`. Assume
  anyone can call the API directly.

### OAuth providers

Google and GitHub must be enabled in the Supabase dashboard before the buttons
work. The callback URL is
`https://zdqdtnthyxkskkigqmww.supabase.co/auth/v1/callback`. Full steps are in
[`supabase/README.md`](supabase/README.md).

## Pull requests

1. Push your branch.
2. Open a PR against `main` and fill in the template.
3. Keep the PR small. A 2,000-line PR will sit unreviewed; three 300-line PRs
   will get merged.
4. Request one reviewer. If you are the only maintainer, still open the PR:
   it documents the change and runs CI.
5. Once approved and green, squash-merge it. Delete the branch.

Review the diff, not just the preview. Ask "what happens on a slow connection,
on a phone, with JavaScript off, and with a year-old cached page?"

## Keeping a fork in sync

```bash
git remote add upstream https://github.com/malwarous/malwarous-site.git
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

Then rebase your feature branch so review is against current code:

```bash
git switch feat/your-branch
git rebase origin/main
```

If you already pushed that branch, `git push --force-with-lease` (never plain
`--force`).

## Parallel work

Use a worktree instead of stashing half-finished work:

```bash
git worktree add ../malwarous-auth -b feat/auth
```

Each worktree gets its own folder and its own local server port. Remove it
with `git worktree remove ../malwarous-auth` when the branch is merged.

## Deploying

Cloudflare deploys `main` automatically. A merge is a deploy. There is no
staging environment, so the local server and the checklist above are the
staging environment. If a change needs a database migration, run the migration
before merging the code that depends on it.
