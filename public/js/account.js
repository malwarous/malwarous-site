/* ==========================================================================
   Malwarous — account.js
   Everything that talks to Supabase: signup, login, logout, the console
   guestbook and the flag challenge.

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
  if (/database error saving new user/i.test(text)) return "that handle can't be used. try another.";
  if (/slow down/i.test(text)) return 'slow down: one message every 2 minutes.';
  if (code === '23514') return 'messages are 1 to 140 characters, on one line.';
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

  signUp: async function (handle, email, password) {
    const client = await getClient();
    if (!client) return offline();

    // Friendly early check. The database's unique rule is the real guard.
    const taken = await client.from('profiles').select('id').eq('handle', handle).maybeSingle();
    if (taken.error) return fail(friendlyError(taken.error));
    if (taken.data) return fail('that handle is taken. pick another.');

    const { data, error } = await client.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { handle: handle }, // the database trigger turns this into a profile
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
    if (!agree.checked) {
      return showFormError(form, 'tick the box to agree to hack only with permission.', agree);
    }
    clearFormError(form);

    setBusy(form, true, '> creating account...');
    const result = await Account.signUp(handle.value, email.value.trim(), password.value);
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
   Start-up
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function () {
  initPasswordToggles();
  initLoginPage();
  initSignupPage();
  refreshStatusUser();
});
