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
    10. Homepage: latest write-ups
    11. Event registration page
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
  if (/schema cache|could not find the (function|table)/i.test(text)) return "this part of the site isn't set up yet. check back soon.";
  if (/failed to fetch|network/i.test(text)) return "couldn't reach the account server. check your connection and try again.";
  if (/invalid login credentials/i.test(text)) return 'wrong email or password.';
  if (/email not confirmed/i.test(text)) return 'confirm your email first: check your inbox for the link.';
  if (/already registered/i.test(text)) return 'that email already has an account. try logging in.';
  if (/rate limit|too many/i.test(text) || status === 429) return 'too many attempts. wait a minute and try again.';
  if (/database error saving new user/i.test(text)) return "that handle or TryHackMe username can't be used (it may be taken). try another.";
  if (/provider is not enabled|unsupported provider/i.test(text)) return 'that sign-in provider is not enabled yet. use email for now.';
  // Our own database rules ("slow down: ...", "already applied: ...") are already readable
  if (/^(slow down|already applied|closed|full|that handle|this account)/i.test(text)) return text;
  if (code === '23505' && /registrations/i.test(text)) return "you're already registered for this event.";
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

  // The logged-in member as { id, email, handle, autoHandle }, or null
  getCurrentUser: async function () {
    const client = await getClient();
    if (!client) return null;

    const { data } = await client.auth.getSession();
    const user = data.session ? data.session.user : null;
    if (!user) return null;

    if (!cachedProfile || cachedProfile.userId !== user.id) {
      // auto_handle exists after supabase/003-oauth.sql. Falling back keeps the
      // site working on a database that hasn't run the migration yet.
      let profile = await client
        .from('profiles')
        .select('handle, auto_handle')
        .eq('id', user.id)
        .maybeSingle();
      if (profile.error && /auto_handle/i.test(profile.error.message || '')) {
        profile = await client.from('profiles').select('handle').eq('id', user.id).maybeSingle();
      }

      // Last-resort repair for an auth user whose profile row is missing.
      if (!profile.error && !profile.data) {
        const repair = await client.rpc('ensure_profile');
        if (!repair.error) {
          profile = await client.from('profiles').select('handle, auto_handle').eq('id', user.id).maybeSingle();
          if (profile.error) profile = await client.from('profiles').select('handle').eq('id', user.id).maybeSingle();
        }
      }

      cachedProfile = {
        userId: user.id,
        handle: profile.data ? profile.data.handle : null,
        autoHandle: Boolean(profile.data && profile.data.auto_handle)
      };
    }
    return {
      id: user.id,
      email: user.email,
      handle: cachedProfile.handle,
      autoHandle: cachedProfile.autoHandle
    };
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
        // after confirming their email, bring them back to where they were going
        emailRedirectTo: new URL('login.html' + (nextPage() ? '?next=' + encodeURIComponent(nextPage()) : ''), window.location.href).href
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

  // Google / GitHub. Supabase redirects the whole page, so this usually
  // never returns: the browser leaves for the provider and comes back.
  signInWithOAuth: async function (provider) {
    const client = await getClient();
    if (!client) return offline();
    if (provider !== 'google' && provider !== 'github') {
      return fail('that sign-in provider is not supported.');
    }

    const redirect = new URL('login.html', window.location.href);
    if (nextPage()) redirect.searchParams.set('next', nextPage());

    const { error } = await client.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: redirect.href }
    });
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  // OAuth accounts start with a generated handle so signup can never fail on
  // a missing username. This lets the member replace it once.
  claimHandle: async function (handle) {
    const client = await getClient();
    if (!client) return offline();

    const wanted = String(handle || '').trim().toLowerCase();
    if (!HANDLE_PATTERN.test(wanted)) {
      return fail('handles are 3 to 20 characters: a-z, 0-9, _ and -.');
    }

    const { data, error } = await client.rpc('claim_handle', { p_handle: wanted });
    if (error) return fail(friendlyError(error));

    const { data: sessionData } = await client.auth.getSession();
    const id = sessionData.session ? sessionData.session.user.id : null;
    if (id) cachedProfile = { userId: id, handle: data || wanted, autoHandle: false };
    return { ok: true, handle: data || wanted };
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

  // { title, starts_at, capacity, registered, open } for an event, or null
  getEventStatus: async function (slug) {
    const client = await getClient();
    if (!client) return offline();
    const { data, error } = await client.rpc('event_status', { p_slug: slug });
    if (error) return fail(friendlyError(error));
    return { ok: true, event: data };
  },

  // This member's registration for an event, or null
  getMyRegistration: async function (slug) {
    const client = await getClient();
    if (!client) return null;
    const { data } = await client
      .from('registrations')
      .select('team_name, university, created_at')
      .eq('event_slug', slug)
      .maybeSingle();
    return data;
  },

  // teamName '' = going solo
  register: async function (slug, teamName, university) {
    const client = await getClient();
    if (!client) return offline();

    const user = await Account.getCurrentUser();
    if (!user) return fail('log in first to register.');

    const { error } = await client.from('registrations').insert({
      event_slug: slug,
      team_name: teamName || null,
      university: university
    });
    if (error) return fail(friendlyError(error));
    return { ok: true };
  },

  cancelRegistration: async function (slug) {
    const client = await getClient();
    if (!client) return offline();

    const { data, error } = await client.from('registrations').delete().eq('event_slug', slug).select('id');
    if (error) return fail(friendlyError(error));
    if (!data.length) return fail("couldn't find your registration.");
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

// Where to send someone after login/signup, from ?next=... in the address.
// Only pages on this site, like "register.html?event=info-session-nov-2026",
// are allowed: otherwise anyone could make a login link that sends people
// to a fake site afterwards (an "open redirect").
function nextPage() {
  const next = new URLSearchParams(window.location.search).get('next') || '';
  return /^[a-z0-9-]+\.html(\?event=[a-z0-9-]+)?$/.test(next) ? next : '';
}

// Google / GitHub buttons on login and signup.
function initOAuthButtons() {
  document.querySelectorAll('[data-oauth]').forEach(function (button) {
    button.addEventListener('click', async function () {
      if (!Account.isConfigured()) {
        showNotice("accounts aren't open yet. check back soon.");
        return;
      }
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = '> connecting...';
      const result = await Account.signInWithOAuth(button.dataset.oauth);
      if (!result.ok) {
        button.disabled = false;
        button.innerHTML = original;
        showNotice(result.message);
      }
    });
  });
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
  const claim = document.getElementById('claim-handle');
  const oauthBox = document.getElementById('auth-oauth');

  function showSignedIn(user) {
    document.getElementById('signed-in-handle').textContent = '@' + (user.handle || 'member');
    form.hidden = true;
    switchLine.hidden = true;
    signedIn.hidden = false;
    if (claim) claim.hidden = true;
    if (oauthBox) oauthBox.hidden = true;
  }

  function showForm() {
    form.hidden = false;
    switchLine.hidden = false;
    signedIn.hidden = true;
    if (claim) claim.hidden = true;
    if (oauthBox) oauthBox.hidden = false;
  }

  // OAuth users get a generated handle. Ask them to choose the public one
  // before they wander off, but never trap them here.
  function showClaim(user) {
    if (!claim) return showSignedIn(user);
    form.hidden = true;
    switchLine.hidden = true;
    signedIn.hidden = true;
    if (oauthBox) oauthBox.hidden = true;
    claim.hidden = false;
    document.getElementById('claim-current').textContent = '@' + (user.handle || 'member');
    const skip = document.getElementById('claim-skip');
    if (skip) skip.href = nextPage() || 'index.html';
    const input = claim.querySelector('input[name="handle"]');
    if (input) input.value = '';
    claim.focus();
    if (input) input.focus();
  }

  if (!Account.isConfigured()) {
    showNotice("accounts aren't open yet. check back soon.");
    disableForm(form);
    return;
  }

  // Arriving from the confirmation email? (Supabase reads the link itself.)
  const fromEmailLink = /type=signup|access_token|code=/.test(window.location.hash + window.location.search);

  // Keep "where to go after login" when switching to the signup page
  if (nextPage()) {
    const signupLink = switchLine.querySelector('a');
    if (signupLink) signupLink.href = 'signup.html?next=' + encodeURIComponent(nextPage());
  }

  // An OAuth provider can send an error back in the address.
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const oauthError = query.get('error_description') || hash.get('error_description');
  if (oauthError) showNotice(decodeURIComponent(oauthError.replace(/\+/g, ' ')));

  const user = await Account.getCurrentUser();
  if (user) {
    if (fromEmailLink && !user.autoHandle) showNotice('email confirmed. welcome to malwarous.');
    if (user.autoHandle) {
      showClaim(user);
    } else if (nextPage()) {
      // Logged in and on the way somewhere (e.g. registering)? Go there.
      window.location.href = nextPage();
      return;
    } else {
      showSignedIn(user);
    }
  }

  if (claim) {
    const claimForm = claim.querySelector('form');
    const claimInput = claimForm ? claimForm.elements.handle : null;
    if (claimForm && claimInput) {
      claimInput.addEventListener('input', function () {
        claimInput.value = claimInput.value.toLowerCase();
      });
      claimForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        clearFormError(claimForm);
        setBusy(claimForm, true, '> claiming...');
        const result = await Account.claimHandle(claimInput.value);
        setBusy(claimForm, false);
        if (!result.ok) return showFormError(claimForm, result.message, claimInput);
        // Use the new handle everywhere, then finish the journey.
        const fresh = await Account.getCurrentUser();
        if (nextPage()) {
          window.location.href = nextPage();
          return;
        }
        showSignedIn(fresh || { handle: result.handle });
        showNotice('handle claimed. welcome to malwarous.');
        refreshStatusUser();
      });
    }
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
    window.location.href = nextPage() || 'index.html';
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

  // Keep "where to go after login" when switching to the login page
  if (nextPage()) {
    const loginLink = document.querySelector('#auth-switch a');
    if (loginLink) loginLink.href = 'login.html?next=' + encodeURIComponent(nextPage());
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
      window.location.href = nextPage() || 'index.html';
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

// Builds one post as a collapsible <details>: the title row is always
// visible, the text opens on click. Everything is set with textContent, so
// nothing a member writes can ever run as code on the page.
function makePost(post) {
  const article = document.createElement('details');
  article.className = 'post';
  article.id = 'post-' + post.id; // so writeups.html#post-12 links straight to it
  article.dataset.kind = post.kind;

  const summary = document.createElement('summary');
  summary.className = 'post__summary';
  const icon = document.createElement('span');
  icon.className = 'collapse__icon';
  icon.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'post__content';

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

  summary.append(meta, title, icon);
  content.append(body);
  article.append(summary, content);

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
    content.append(extra);
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

      // Arriving from a link like writeups.html#post-12: open that post
      const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
      if (target && target.classList.contains('post')) {
        target.open = true;
        target.scrollIntoView({ block: 'start' });
      }
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
   10. Homepage: latest write-ups (// 05)
   Uses one small direct request instead of the Supabase library, so the
   homepage stays fast. The section collapses when there are no posts.
   -------------------------------------------------------------------------- */

async function initHomeWriteups() {
  const box = document.querySelector('[data-home-writeups]');
  if (!box) return;
  const list = document.getElementById('home-writeups-list');
  const count = document.getElementById('home-writeups-count');
  const empty = document.getElementById('home-writeups-empty');

  let posts = [];
  if (Account.isConfigured()) {
    try {
      const url = MALWAROUS_CONFIG.supabaseUrl + '/rest/v1/posts' +
        '?select=id,kind,title,approved_at,profiles(handle)' +
        '&status=eq.approved&order=approved_at.desc&limit=5';
      const response = await fetch(url, { headers: { apikey: MALWAROUS_CONFIG.supabaseKey } });
      if (response.ok) posts = await response.json();
    } catch (error) {
      // offline: show the empty state
    }
  }

  posts.forEach(function (post) {
    const row = document.createElement('li');
    row.className = 'ls__row';

    const perms = document.createElement('span');
    perms.className = 'ls__perms';
    perms.setAttribute('aria-hidden', 'true');
    perms.textContent = '-rw-r--r--';

    const date = document.createElement('span');
    date.className = 'ls__date';
    date.textContent = new Date(post.approved_at).toLocaleDateString('en-CA');

    const author = document.createElement('span');
    author.className = 'ls__author';
    author.textContent = post.profiles ? '@' + post.profiles.handle : '';

    const title = document.createElement('a');
    title.className = 'ls__title';
    title.href = 'writeups.html#post-' + post.id;
    title.textContent = post.title;

    const kind = document.createElement('span');
    kind.className = 'ls__tags';
    kind.textContent = POST_KINDS[post.kind] || post.kind;

    row.append(perms, date, author, title, kind);
    list.appendChild(row);
  });

  // Open the section when there's something to show; stay collapsed otherwise
  const any = posts.length > 0;
  count.textContent = any ? posts.length + (posts.length === 1 ? ' post' : ' posts') : 'no posts yet';
  list.hidden = !any;
  empty.hidden = any;
  box.open = any;
}


/* --------------------------------------------------------------------------
   11. Event registration (register.html?event=<slug>)
   The slug is the event's id in the database (table "events").
   -------------------------------------------------------------------------- */

async function initRegisterPage() {
  const form = document.getElementById('register-form');
  if (!form) return;

  const slug = new URLSearchParams(window.location.search).get('event') || '';
  const guest = document.getElementById('reg-guest');
  const done = document.getElementById('reg-done');
  const set = function (id, text) { document.getElementById(id).textContent = text; };
  set('reg-slug', slug || '?');

  if (!Account.isConfigured()) return showNotice("registration opens once accounts are switched on. check back soon.");
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return showNotice("that link doesn't point to an event. pick one from the events page.");

  // Event details and seats (public: anyone can see these)
  const status = await Account.getEventStatus(slug);
  if (!status.ok) return showNotice(status.message);
  const ev = status.event;
  if (!ev) return showNotice("that event isn't taking registrations. pick one from the events page.");

  const full = ev.capacity !== null && ev.registered >= ev.capacity;
  set('reg-title', ev.title);
  set('auth-title', 'Register');
  document.title = 'Register: ' + ev.title + ' — Malwarous';
  set('reg-date', ev.starts_at
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }).format(new Date(ev.starts_at)) + ' PKT'
    : 'tba');
  set('reg-seats', ev.capacity === null
    ? ev.registered + ' registered · no limit'
    : ev.registered + ' / ' + ev.capacity + ' taken');
  set('reg-status', !ev.open ? 'closed' : full ? 'full' : 'open');
  document.getElementById('reg-status').className = !ev.open || full ? '' : 'tree__live';

  // Who's looking?
  const user = Account.hasSavedSession() ? await Account.getCurrentUser() : null;

  function showRegistered(registration) {
    set('reg-done-team', registration.team_name || 'solo');
    set('reg-done-university', registration.university);
    form.hidden = true;
    done.hidden = false;
  }

  if (user) {
    document.querySelector('.split__main .prompt__user').textContent = user.handle + '@malwarous:~$';
    const mine = await Account.getMyRegistration(slug);
    if (mine) return showRegistered(mine);
  }

  if (!ev.open) return showNotice('registration for this event is closed.');
  if (full) return showNotice('this event is full. keep an eye on the events page for the next one.');

  if (!user) {
    // Send them through login/signup and straight back here afterwards
    const here = encodeURIComponent('register.html?event=' + slug);
    document.getElementById('reg-login').href = 'login.html?next=' + here;
    document.getElementById('reg-signup').href = 'signup.html?next=' + here;
    guest.hidden = false;
    return;
  }

  form.hidden = false;

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const team = form.elements.team;
    const university = form.elements.university;

    if (team.value.trim() && team.value.trim().length < 2) {
      return showFormError(form, 'team names need at least 2 characters (or leave it empty to go solo).', team);
    }
    if (university.value.trim().length < 2) return showFormError(form, 'enter your university.', university);
    clearFormError(form);

    setBusy(form, true, '> registering...');
    const result = await Account.register(slug, team.value.trim(), university.value.trim());
    setBusy(form, false);

    if (!result.ok) return showFormError(form, result.message, null);
    showRegistered({ team_name: team.value.trim(), university: university.value.trim() });
    done.focus();
  });

  document.getElementById('reg-cancel').addEventListener('click', async function () {
    if (!window.confirm('Cancel your registration for this event?')) return;
    const result = await Account.cancelRegistration(slug);
    if (!result.ok) return showNotice(result.message);
    done.hidden = true;
    form.reset();
    form.hidden = false;
    showNotice('registration cancelled. you can register again while it is open.');
  });
}


/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function () {
  initPasswordToggles();
  initOAuthButtons();
  initLoginPage();
  initSignupPage();
  initWriteupsPage();
  initTeamPage();
  initResetPage();
  initHomeWriteups();
  initRegisterPage();
  refreshStatusUser();
});
