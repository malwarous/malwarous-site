# Turning on accounts (Supabase)

The website works without any of this. Until you finish these steps, the login
and signup pages say "accounts aren't open yet" and the console guestbook is
offline. Everything else (including the hidden flag) already works.

Dashboard menu names shift a little between Supabase versions. If a label
doesn't match exactly, look for the nearest one.

## 1. Create the project
1. Sign up at supabase.com (the free plan is enough) and create a new project.
2. Pick a region close to Pakistan (e.g. Mumbai or Singapore).
3. Save the database password in a password manager. The site never needs it.

## 2. Create the tables and security rules
1. Open **SQL Editor**, then **New query**.
2. Paste the whole of `schema.sql` and click **Run**.

## 3. Connect the website
1. Open **Project Settings**, then **API** (or **API Keys**).
2. Copy the **Project URL** and the **anon / publishable** key into `public/js/config.js`.
3. Never use the **service_role / secret** key on the website. It skips every
   security rule in `schema.sql`.

The anon key is meant to be public. Anyone can read it from the page, and
that's fine: the rules in `schema.sql` decide what it can do.

## 4. Auth settings (under Authentication)
- **URL configuration.** Set the Site URL to `https://malwarous.dev`. Under
  Redirect URLs add `https://malwarous.dev/**` and `https://www.malwarous.dev/**`.
  The `**` covers every page and its `?next=...` part: confirmation emails,
  password resets, and "log in, then come back to this event's registration".
- **Email provider.** Keep "Confirm email" on. Set the minimum password length
  to 10. The site checks this too, but only the server's check really counts.
- **Email sending: do this before announcing signups.** Supabase's built-in
  email only sends a few messages per hour and only to your own team's
  addresses. Set up custom SMTP (Authentication, then Emails, then SMTP) with
  a free provider such as Resend or Brevo, or real members won't get their
  confirmation emails.
- **CAPTCHA.** Don't switch on Supabase's CAPTCHA protection yet. The signup
  form would need a small update first.

## 5. Make yourself an admin
1. Sign up on the website with your own handle and confirm your email.
2. Run the snippet at the bottom of `schema.sql` with your handle filled in.
3. Test it: open the console (press `` ` ``), type `whoami`. It should say "(admin)".

Admins can delete any guestbook message with `guestbook rm <id>`.

## 6. Test everything
1. Open the console and try:
   ```
   guestbook sign hello from the other side
   guestbook
   guestbook rm <the id it showed>
   ```
2. On `/writeups`, submit a test post. It should say "submitted for review"
   and NOT appear in the list yet.
3. Approve it (see below), reload `/writeups`: now it shows.
4. On `/team`, send a test application, then find it in the dashboard.

## Admin tasks (all in Table Editor)
- **Approve a post:** table `posts`, find the row with status `pending`,
  change status to `approved` (or `rejected`). The approval time fills in itself.
- **Read team applications:** table `team_applications`. The applicant's email
  is filled in automatically. Nobody can read this table from the website.
- **Fix a TryHackMe username:** table `profiles`, column `thm_username`.
  Use this to match names on a room's scoreboard to members.
- **Remove a guestbook message:** table `guestbook`, delete the row.

## Good to know
- **Free plan:** a project may pause after about a week with no activity.
  Restore it from the dashboard with one click.
- **Adding tables later:** switch on Row Level Security for every new table and
  write its policies, or anyone with the public key can read and change it.
  The dashboard's **Security Advisor** flags tables you missed.
- **Changing the hidden flag:** the steps are in the comment above
  `FLAG_SHA256` in `public/js/main.js`. Update that hash, the hash inside
  `submit_flag()` in `schema.sql` (re-run just that function in the SQL
  Editor), and `public/ops/notes.txt`.

## Event registration (run `002-registrations.sql` once, after `schema.sql`)
- **Add an event people can register for:** Table Editor, `events`, Insert row:
  - `slug`: a short id like `ctf-dec-2026` (lowercase letters, numbers, `-`)
  - `title`, `starts_at` (registration closes automatically when it starts)
  - `capacity`: a seat limit, or leave empty for no limit
- **Link to it** from any button: `register.html?event=ctf-dec-2026`
- **Close registration early:** set `registration_open` to `false`.
- **See who registered:** table `registrations`, filter `event_slug`, then
  **Export to CSV** for the check-in list. Each row has the email, team name
  (empty = solo) and university. Members can only ever see their own row.
- **Teams:** each teammate registers separately with the same team name.
