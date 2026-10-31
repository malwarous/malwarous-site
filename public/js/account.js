/* ==========================================================================
   Malwarous — account.js
   Everything that talks to Supabase: signup, login, logout, the console
   guestbook, the flag challenge, posts (write-ups page) and team
   applications (team page).

   The Supabase library (~218 KB) is only downloaded when it's needed: on the
   login/signup pages, when a logged-in member visits, or when a console
   command needs it. Visitors who never log in never download it.

   Security note: nothing in this file is a security boundary. Anyone can
   skip the checks here and call Supabase directly. The real rules live in
   supabase/schema.sql. The checks here only give friendly error messages.

   Contents
     1. Loading Supabase
     2. The Account object (used by the console in main.js and the pages below)
     3. Status bar: "login" or "@handle"
     4. Form helpers
     5. Login page
     6. Signup page
     7. Write-ups page (read approved posts, submit new ones)
     8. Team page (application form)
     9. Password reset page
   ========================================================================== */


/* --------------------------------------------------------------------------
   1. Loading Supabase
   -------------------------------------------------------------------------- */

// Pinned version + integrity hash: if jsDelivr ever served a different file,
// the browser would refuse to run it.
const SUPABASE_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const SUPABASE_SRI = 'sha256-WdOUh8NYmEO0EDItij1WLOAiq6HlzLFomO8/sqDaLs0=';

// Where Supabase saves the login session in the browser (localStorage)
const AUTH_STORAGE_KEY = 'malwarous-auth';

const HANDLE_PATTERN = /^[a-z0-9_-]{3,20}$/;
const THM_PATTERN = /^[A-Za-z0-9._-]{1,40}$/; // TryHackMe usernames, e.g. hasnaat.hussain.2
const MIN_PASSWORD_LENGTH = 10;

let supabaseClientPromise = null; // created once, then reused
let cachedProfile = null;         // { userId, handle } so we don't ask every time

// Adds a <script> tag and waits for it to load
function loadScript(src, integrity) {
  return new Promise(function (resolve, reject) {
    const script = document.createElement('script');
    script.src = src;
    script.integrity = integrity;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Returns the Supabase client, downloading the library the first time.
// Resolves to null if accounts aren't configured or the library can't load.
function getClient() {
  if (!Account.isConfigured()) return Promise.resolve(null);

  if (!supabaseClientPromise) {
    supabaseClientPromise = loadScript(SUPABASE_SRC, SUPABASE_SRI)
      .then(function () {
        const client = window.supabase.createClient(
          MALWAROUS_CONFIG.supabaseUrl,
          MALWAROUS_CONFIG.supabaseKey,
          { auth: { storageKey: AUTH_STORAGE_KEY } }
        );
        // Keep the status bar in sync when someone logs in or out.
        // (Supabase asks us not to call it again directly inside this
        // callback, hence the setTimeout.)
        client.auth.onAuthStateChange(function () {
          setTimeout(refreshStatusUser, 0);
        });
        return client;
      })
      .catch(function () {
        supabaseClientPromise = null; // allow another try later
        return null;
      });
  }
  return supabaseClientPromise;
}


/* --------------------------------------------------------------------------
   2. The Account object
   Every function returns a plain object like { ok: true, ... } or
   { ok: false, message: 'what went wrong' }, so callers stay simple.
   -------------------------------------------------------------------------- */

function fail(message) {
  return { ok: false, message: message };
}

function offline() {
  return Account.isConfigured()
    ? fail("couldn't reach the account server. check your connection and try again.")
    : fail("accounts aren't open yet. check back soon.");
}

// Turns Supabase's error messages into something a human wants to read
function friendlyError(error) {
  const text = (error && error.message) || '';
  const status = error && error.status;
  const code = error && error.code;
  if (/failed to fetch|network/i.test(text)) return "couldn't reach the account server. check your connection and try again.";
  if (/invalid login credentials/i.test(text)) return 'wrong email or password.';
  if (/email not confirmed/i.test(text)) return 'confirm your email first: check your inbox for the link.';
  if (/already registered/i.test(text)) return 'that email already has an account. try logging in.';
  if (/rate limit|too many/i.test(text) || status === 429) return 'too many attempts. wait a minute and try again.';
  if (/database error saving new user/i.test(text)) return "that handle or TryHackMe username can't be used (it may be taken). try another.";
  // Our own database rules ("slow down: ...", "already applied: ...") are already readable
  if (/^(slow down|already applied)/i.test(text)) return text;
  if (code === '23514') return 'something you entered is too short, too long, or in the wrong format.';
  return text ? text.toLowerCase() : 'something went wrong. try again.';
}

const Account = {

  // Are the Supabase settings filled in (js/config.js)?
  isConfigured: function () {
    return Boolean(MALWAROUS_CONFIG.supabaseUrl && MALWAROUS_CONFIG.supabaseKey);
  },

  // Is there a saved login in this browser? (checked WITHOUT downloading Supabase)
  hasSavedSession: function () {
    try {
      return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
    } catch (error) {
      return false;
    }
  },

  // The logged-in member as { id, email, handle }, or null
  getCurrentUser: async function () {
    const client = await getClient();
    if (!client) return null;

    const { data } = await client.auth.getSession();
    const user = data.session ? data.session.user : null;
    if (!user) return null;

    if (!cachedProfile || cachedProfile.userId !== user.id) {
      const profile = await client.from('profiles').select('handle').eq('id', user.id).maybeSingle();
      cachedProfile = { userId: user.id, handle: profile.data ? profile.data.handle : null };
    }
    return { id: user.id, email: user.email, handle: cachedProfile.handle };
  },

  // thmUsername is optional ('' = none)
  signUp: async function (handle, email, password, thmUsername) {
    const client = await getClient();
    if (!client) return offline();

    // Friendly early checks. The database's unique rules are the real guard.
    const taken = await client.from('profiles').select('id').eq('handle', handle).maybeSingle();
    if (taken.error) return fail(friendlyError(taken.error));
    if (taken.data) return fail('that handle is taken. pick another.');

    if (thmUsername) {
      const thmTaken = await client.from('profiles').select('id').eq('thm_username', thmUsername).maybeSingle();
      if (thmTaken.error) return fail(friendlyError(thmTaken.error));
      if (thmTaken.data) return fail('that TryHackMe username is already linked to another account.');
    }

    const { data, error } = await client.auth.signUp({
      email: email,
      password: password,
      options: {
        // the database trigger turns this into a profile
        data: { handle: handle, thm_username: thmUsername || '' },
        emailRedirectTo: new URL('login.html', window.location.href).href
      }
    });
    if (error) return fail(friendlyError(error));

    // No session yet means Supabase sent a confirmation email first
    return { ok: true, needsConfirmation: !data.session };
  },

  signIn: async function (email, password) {
    const client = await getClient();
    if (!client) return offline();

    const { error } = await client.auth.signInWithPassword({ email: email, password: password });
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  signOut: async function () {
    const client = await getClient();
    if (!client) return offline();

    const { error } = await client.auth.signOut();
    cachedProfile = null;
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  isAdmin: async function () {
    const client = await getClient();
    if (!client) return false;
    const { data } = await client.rpc('is_admin');
    return data === true;
  },

  // Latest guestbook messages, newest first
  readGuestbook: async function (limit) {
    const client = await getClient();
    if (!client) return offline();

    const { data, error } = await client
      .from('guestbook')
      .select('id, message, created_at, profiles(handle)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return fail(friendlyError(error));

    const entries = data.map(function (row) {
      return {
        id: row.id,
        message: row.message,
        date: new Date(row.created_at),
        handle: row.profiles ? row.profiles.handle : 'unknown'
      };
    });
    return { ok: true, entries: entries };
  },

  signGuestbook: async function (message) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    if (!user) return fail("log in first to sign the guestbook. try 'login'.");

    const { error } = await client.from('guestbook').insert({ message: message });
    if (error) return fail(friendlyError(error));
    return { ok: true, handle: user.handle };
  },

  deleteGuestbookEntry: async function (id) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    if (!user) return fail("log in first. try 'login'.");

    // .select() returns what was deleted. Nothing back = not allowed or not found.
    const { data, error } = await client.from('guestbook').delete().eq('id', id).select('id');
    if (error) return fail(friendlyError(error));
    if (!data.length) return fail('#' + id + ": not yours, or it doesn't exist.");
    return { ok: true };
  },

  // Checks a flag on the server, and records the solve if you're logged in
  submitFlag: async function (guess) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    const { data, error } = await client.rpc('submit_flag', { guess: guess });
    if (error) return fail(friendlyError(error));
    return { ok: true, correct: data === true, recordedFor: data === true && user ? user.handle : null };
  },

  // Approved write-ups and opportunities, newest first
  readPosts: async function () {
    const client = await getClient();
    if (!client) return offline();

    const { data, error } = await client
      .from('posts')
      .select('id, kind, title, body, link, deadline, approved_at, created_at, profiles(handle)')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(50);
    if (error) return fail(friendlyError(error));
    return { ok: true, posts: data };
  },

  // post = { kind, title, body, link, deadline }. Always starts as 'pending'.
  submitPost: async function (post) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    if (!user) return fail('log in first to submit a post.');

    const { error } = await client.from('posts').insert(post);
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  // Emails a password-reset link. Always says "sent", whether or not the
  // email has an account, so the form can't be used to find out who's signed up.
  requestPasswordReset: async function (email) {
    const client = await getClient();
    if (!client) return offline();

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('reset.html', window.location.href).href
    });
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  // Sets a new password for the person who arrived from the reset link
  updatePassword: async function (password) {
    const client = await getClient();
    if (!client) return offline();

    const { data } = await client.auth.getSession();
    if (!data.session) return fail('this reset link has expired or was already used. request a new one below.');

    const { error } = await client.auth.updateUser({ password: password });
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  // application = { full_name, program, skills, interest, links }
  applyToTeam: async function (application) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    if (!user) return fail('log in first to apply.');

    const { error } = await client.from('team_applications').insert(application);
    if (error) return fail(friendlyError(error));
    return { ok: true };
  }
};


/* --------------------------------------------------------------------------
   3. Status bar: shows "login", or "@handle" once logged in
   -------------------------------------------------------------------------- */

async function refreshStatusUser() {
  const link = document.getElementById('status-user');
  if (!link) return;

  // Only download Supabase if this browser has a saved login
  if (!Account.isConfigured() || !Account.hasSavedSession()) {
    link.textContent = 'login';
    return;
  }
  const user = await Account.getCurrentUser();
  link.textContent = user && user.handle ? '@' + user.handle : 'login';
}


/* --------------------------------------------------------------------------
   4. Form helpers (login + signup pages)
   -------------------------------------------------------------------------- */

// Shows one error message and marks the field it belongs to
function showFormError(form, message, field) {
  form.querySelectorAll('[aria-invalid]').forEach(function (input) {
    input.removeAttribute('aria-invalid');
  });
  form.querySelector('.form__error').textContent = message;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function clearFormError(form) {
  showFormError(form, '', null);
}

// Disables the submit button while waiting, and changes its label
function setBusy(form, busy, busyLabel) {
  const button = form.querySelector('[type="submit"]');
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.label;
    button.disabled = false;
  }
}

function disableForm(form) {
  form.querySelectorAll('input, button').forEach(function (element) {
    element.disabled = true;
  });
}

function showNotice(text) {
  const notice = document.getElementById('auth-notice');
  if (!notice) return;
  notice.textContent = text;
  notice.hidden = false;
}

// [ show ] / [ hide ] buttons next to password fields
function initPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
    const input = document.getElementById(button.getAttribute('aria-controls'));
    button.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? '[ hide ]' : '[ show ]';
      button.setAttribute('aria-pressed', String(show));
    });
  });
}


/* --------------------------------------------------------------------------
   5. Login page (login.html)
   -------------------------------------------------------------------------- */

async function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const signedIn = document.getElementById('signed-in');
  const switchLine = document.getElementById('auth-switch');

  function showSignedIn(user) {
    document.getElementById('signed-in-handle').textContent = '@' + (user.handle || 'member');
    form.hidden = true;
    switchLine.hidden = true;
    signedIn.hidden = false;
  }

  function showForm() {
    form.hidden = false;
    switchLine.hidden = false;
    signedIn.hidden = true;
  }

  if (!Account.isConfigured()) {
    showNotice("accounts aren't open yet. check back soon.");
    disableForm(form);
    return;
  }

  // Arriving from the confirmation email? (Supabase reads the link itself.)
  const fromEmailLink = /type=signup|access_token|code=/.test(window.location.hash + window.location.search);

  const user = await Account.getCurrentUser();
  if (user) {
    if (fromEmailLink) showNotice('email confirmed. welcome to malwarous.');
    showSignedIn(user);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault(); // we send it ourselves, the page doesn't reload
    const email = form.elements.email;
    const password = form.elements.password;

    if (!email.value.trim()) return showFormError(form, 'enter your email.', email);
    if (!password.value) return showFormError(form, 'enter your password.', password);
    clearFormError(form);

    setBusy(form, true, '> logging in...');
    const result = await Account.signIn(email.value.trim(), password.value);
    setBusy(form, false);

    if (!result.ok) return showFormError(form, result.message, null);
    window.location.href = 'index.html';
  });

  document.getElementById('logout-button').addEventListener('click', async function () {
    await Account.signOut();
    form.reset();
    showForm();
    showNotice('logged out.');
  });
}


/* --------------------------------------------------------------------------
   6. Signup page (signup.html)
   -------------------------------------------------------------------------- */

function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  if (!Account.isConfigured()) {
    showNotice("accounts aren't open yet. check back soon.");
    disableForm(form);
    return;
  }

  // Handles are lowercase: fix it as they type
  const handleInput = form.elements.handle;
  handleInput.addEventListener('input', function () {
    handleInput.value = handleInput.value.toLowerCase();
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const handle = form.elements.handle;
    const email = form.elements.email;
    const password = form.elements.password;
    const thm = form.elements.thm;
    const agree = form.elements.agree;

    if (!HANDLE_PATTERN.test(handle.value)) {
      return showFormError(form, 'handles are 3 to 20 characters: a-z, 0-9, _ and -.', handle);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      return showFormError(form, "that email doesn't look right.", email);
    }
    if (password.value.length < MIN_PASSWORD_LENGTH) {
      return showFormError(form, 'passwords need at least ' + MIN_PASSWORD_LENGTH + ' characters.', password);
    }
    if (thm.value.trim() && !THM_PATTERN.test(thm.value.trim())) {
      return showFormError(form, "that doesn't look like a TryHackMe username: letters, numbers, . _ and - only.", thm);
    }
    if (!agree.checked) {
      return showFormError(form, 'tick the box to agree to hack only with permission.', agree);
    }
    clearFormError(form);

    setBusy(form, true, '> creating account...');
    const result = await Account.signUp(handle.value, email.value.trim(), password.value, thm.value.trim());
    setBusy(form, false);

    if (!result.ok) return showFormError(form, result.message, null);

    if (result.needsConfirmation) {
      const done = document.getElementById('signup-done');
      document.getElementById('signup-sent-email').textContent = email.value.trim();
      form.hidden = true;
      document.getElementById('auth-switch').hidden = true;
      done.hidden = false;
      done.focus(); // so screen readers read the "check your inbox" message
    } else {
      window.location.href = 'index.html';
    }
  });
}


/* --------------------------------------------------------------------------
   Members-only forms (write-ups + team pages)
   <div data-members-only="FORM_ID"> wraps three states:
     [data-state="closed"]   accounts aren't switched on yet
     [data-state="guest"]    "log in to ..." message
     the form itself         shown to logged-in members
   -------------------------------------------------------------------------- */

async function showMembersOnly(form) {
  const box = form.closest('[data-members-only]');
  const closed = box.querySelector('[data-state="closed"]');
  const guest = box.querySelector('[data-state="guest"]');

  function show(state) {
    closed.hidden = state !== 'closed';
    guest.hidden = state !== 'guest';
    form.hidden = state !== 'member';
  }

  if (!Account.isConfigured()) return show('closed');
  if (!Account.hasSavedSession()) return show('guest');
  const user = await Account.getCurrentUser();
  show(user ? 'member' : 'guest');
}

// Shows a "thanks" panel in place of a form after it was sent
function showSent(form, panelId) {
  const panel = document.getElementById(panelId);
  form.hidden = true;
  panel.hidden = false;
  panel.focus();
}


/* --------------------------------------------------------------------------
   7. Write-ups page (writeups.html)
   Reads approved posts from the database, lets members submit new ones.
   -------------------------------------------------------------------------- */

const POST_KINDS = { writeup: 'write-up', opportunity: 'opportunity' };

// Builds one post. Everything is set with textContent, so nothing a member
// writes can ever run as code on the page.
function makePost(post) {
  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.kind = post.kind;

  const meta = document.createElement('p');
  meta.className = 'post__meta';
  const kind = document.createElement('span');
  kind.className = 'post__kind post__kind--' + post.kind;
  kind.textContent = POST_KINDS[post.kind] || post.kind;
  const date = new Date(post.approved_at || post.created_at).toLocaleDateString('en-CA');
  const handle = post.profiles ? '@' + post.profiles.handle : '';
  meta.append(kind, ' · ' + date + (handle ? ' · ' + handle : ''));

  const title = document.createElement('h3');
  title.className = 'post__title';
  title.textContent = post.title;

  const body = document.createElement('p');
  body.className = 'post__body';
  body.textContent = post.body;

  article.append(meta, title, body);

  const extras = [];
  if (post.deadline) extras.push('deadline: ' + post.deadline);
  if (extras.length || post.link) {
    const extra = document.createElement('p');
    extra.className = 'post__extra';
    if (extras.length) extra.append(extras.join(' · ') + (post.link ? ' · ' : ''));
    // Double-check the link is https before making it clickable
    if (post.link && /^https:\/\/\S+$/.test(post.link)) {
      const link = document.createElement('a');
      link.href = post.link;
      link.textContent = 'open link ->';
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow ugc'; // tells search engines it's user content
      extra.append(link);
    }
    article.append(extra);
  }
  return article;
}

async function initWriteupsPage() {
  const list = document.getElementById('post-list');
  if (!list) return;
  const status = document.getElementById('post-status');
  const empty = document.getElementById('post-empty');
  const buttons = document.querySelectorAll('[data-post-filter]');

  // [ all ] [ write-ups ] [ opportunities ]
  function filter(kind) {
    let shown = 0;
    list.querySelectorAll('.post').forEach(function (post) {
      const match = kind === 'all' || post.dataset.kind === kind;
      post.hidden = !match;
      if (match) shown++;
    });
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.postFilter === kind));
    });
    empty.hidden = shown > 0;
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', function () { filter(button.dataset.postFilter); });
  });

  // Load the posts
  if (!Account.isConfigured()) {
    status.textContent = 'offline';
    empty.textContent = 'posts appear here once accounts are switched on. check back soon.';
    empty.hidden = false;
  } else {
    status.textContent = 'loading posts...';
    const result = await Account.readPosts();
    if (!result.ok) {
      status.textContent = 'error';
      empty.textContent = result.message;
      empty.hidden = false;
    } else {
      result.posts.forEach(function (post) { list.appendChild(makePost(post)); });
      status.textContent = result.posts.length + (result.posts.length === 1 ? ' post' : ' posts');
      filter('all');
    }
  }

  // The submit form
  const form = document.getElementById('post-form');
  if (!form) return;
  await showMembersOnly(form);

  // Deadline only makes sense for opportunities
  const deadlineField = document.getElementById('post-deadline-field');
  function syncKind() {
    deadlineField.hidden = form.elements.kind.value !== 'opportunity';
  }
  form.querySelectorAll('[name="kind"]').forEach(function (radio) {
    radio.addEventListener('change', syncKind);
  });
  syncKind();

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const title = form.elements.title;
    const body = form.elements.body;
    const link = form.elements.link;
    const kind = form.elements.kind.value;

    if (title.value.trim().length < 5) return showFormError(form, 'give it a title (at least 5 characters).', title);
    if (body.value.trim().length < 20) return showFormError(form, 'write a little more (at least 20 characters).', body);
    if (link.value.trim() && !/^https:\/\/\S+$/.test(link.value.trim())) {
      return showFormError(form, 'links must start with https://', link);
    }
    clearFormError(form);

    setBusy(form, true, '> submitting...');
    const result = await Account.submitPost({
      kind: kind,
      title: title.value.trim(),
      body: body.value.trim(),
      link: link.value.trim() || null,
      deadline: kind === 'opportunity' && form.elements.deadline.value ? form.elements.deadline.value : null
    });
    setBusy(form, false);

    if (!result.ok) return showFormError(form, result.message, null);
    form.reset();
    showSent(form, 'post-sent');
  });
}


/* --------------------------------------------------------------------------
   8. Team page (team.html): application form
   -------------------------------------------------------------------------- */

async function initTeamPage() {
  const form = document.getElementById('apply-form');
  if (!form) return;
  await showMembersOnly(form);

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const name = form.elements.full_name;
    const skills = form.elements.skills;
    const interest = form.elements.interest;

    if (name.value.trim().length < 2) return showFormError(form, 'enter your name.', name);
    if (skills.value.trim().length < 10) return showFormError(form, 'tell us a bit more about your skills (10+ characters).', skills);
    if (interest.value.trim().length < 10) return showFormError(form, 'tell us what you want to work on (10+ characters).', interest);
    clearFormError(form);

    setBusy(form, true, '> sending...');
    const result = await Account.applyToTeam({
      full_name: name.value.trim(),
      program: form.elements.program.value.trim() || null,
      skills: skills.value.trim(),
      interest: interest.value.trim(),
      links: form.elements.links.value.trim() || null
    });
    setBusy(form, false);

    if (!result.ok) return showFormError(form, result.message, null);
    form.reset();
    showSent(form, 'apply-sent');
  });
}


/* --------------------------------------------------------------------------
   9. Password reset (reset.html)
   Step 1: enter your email, get a link.
   Step 2: the link brings you back here, logged in for this one purpose,
           and you choose a new password.
   -------------------------------------------------------------------------- */

async function initResetPage() {
  const requestForm = document.getElementById('reset-request-form');
  const passwordForm = document.getElementById('reset-password-form');
  if (!requestForm || !passwordForm) return;

  if (!Account.isConfigured()) {
    showNotice("accounts aren't open yet. check back soon.");
    disableForm(requestForm);
    return;
  }

  // Arriving from the email link? (Supabase reads the link itself.)
  const fromEmailLink = /type=recovery|access_token|code=/.test(window.location.hash + window.location.search);
  if (fromEmailLink) {
    const user = await Account.getCurrentUser();
    if (user) {
      requestForm.hidden = true;
      passwordForm.hidden = false;
      passwordForm.elements.password.focus();
    } else {
      showNotice('this reset link has expired or was already used. request a new one below.');
    }
  }

  // Step 1: send the email
  requestForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const email = requestForm.elements.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      return showFormError(requestForm, "that email doesn't look right.", email);
    }
    clearFormError(requestForm);

    setBusy(requestForm, true, '> sending...');
    const result = await Account.requestPasswordReset(email.value.trim());
    setBusy(requestForm, false);

    if (!result.ok) return showFormError(requestForm, result.message, null);
    showSent(requestForm, 'reset-sent');
  });

  // Step 2: save the new password
  passwordForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const password = passwordForm.elements.password;
    if (password.value.length < MIN_PASSWORD_LENGTH) {
      return showFormError(passwordForm, 'passwords need at least ' + MIN_PASSWORD_LENGTH + ' characters.', password);
    }
    clearFormError(passwordForm);

    setBusy(passwordForm, true, '> saving...');
    const result = await Account.updatePassword(password.value);
    setBusy(passwordForm, false);

    if (!result.ok) return showFormError(passwordForm, result.message, null);
    document.getElementById('auth-switch').hidden = true;
    showSent(passwordForm, 'reset-done');
  });
}


/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function () {
  initPasswordToggles();
  initLoginPage();
  initSignupPage();
  initWriteupsPage();
  initTeamPage();
  initResetPage();
  refreshStatusUser();
});
