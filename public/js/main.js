/* ==========================================================================
   Malwarous — main.js
   The interactions shared by every page. No libraries.
   (Anything that talks to Supabase lives in account.js.)

   Contents
     0. Early setup     (runs immediately, before the page is drawn)
     1. Boot screen     (homepage only)
     2. Hero typing animation
     3. Mobile navigation
     4. Countdown       (next-event panel + status bar)
     5. Command console (easter egg: press the ` key)
     6. Events page filters
     7. 404 page
     8. Small helpers
   ========================================================================== */


/* --------------------------------------------------------------------------
   0. Early setup
   This file is loaded in <head>, so the lines below run before the page is
   drawn. That lets us turn the boot screen on without a flash of content.
   -------------------------------------------------------------------------- */

const root = document.documentElement;
root.classList.add('js'); // tells the CSS that JavaScript is running

// true if the visitor asked their OS for less motion
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The boot screen shows once per browser session, and only on pages whose
// <html> tag has the data-boot attribute (just the homepage).
const BOOT_KEY = 'malwarous:booted';
const shouldBoot = root.hasAttribute('data-boot') && !reducedMotion && readSession(BOOT_KEY) !== 'yes';

if (shouldBoot) {
  root.classList.add('is-booting'); // CSS makes the #boot overlay visible
}

// Everything else waits until the HTML has been fully read.
document.addEventListener('DOMContentLoaded', function () {
  initNav();
  initCountdown();
  initConsole();
  initFilters();
  initNotFound();
  setYear();
  runBootScreen(startTyping); // when the boot screen is done, type the headline
});


/* --------------------------------------------------------------------------
   1. Boot screen
   A short fake boot log (under 1.5 s). Any key or click skips it.
   -------------------------------------------------------------------------- */

const BOOT_LINES = [
  ['initializing malwarous...', 'ok'],
  ['mounting /dev/curiosity...', 'ok'],
  ['loading ctf arena...', 'ok'],
  ['checking permissions...', 'granted'],
  ['ready.', '']
];

const BOOT_LINE_DELAY = 180; // ms between log lines
const BOOT_TOTAL = 1250;     // ms before the screen starts fading (+200 ms fade)

function runBootScreen(onDone) {
  const boot = document.getElementById('boot');

  if (!shouldBoot || !boot) {
    root.classList.remove('is-booting');
    onDone();
    return;
  }

  writeSession(BOOT_KEY, 'yes'); // don't show it again this session

  const log = document.getElementById('boot-log');
  const timers = [];
  let finished = false;

  // Schedule each log line
  BOOT_LINES.forEach(function (line, i) {
    const time = 100 + i * BOOT_LINE_DELAY;
    timers.push(setTimeout(function () {
      log.appendChild(makeBootLine(time, line[0], line[1]));
    }, time));
  });

  // Finish on its own after BOOT_TOTAL, or earlier if the visitor skips
  timers.push(setTimeout(finish, BOOT_TOTAL));
  document.addEventListener('keydown', finish);
  document.addEventListener('pointerdown', finish);

  function finish() {
    if (finished) return;
    finished = true;

    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', finish);
    document.removeEventListener('pointerdown', finish);

    boot.classList.add('is-leaving'); // CSS fades it out over 200 ms
    setTimeout(function () {
      root.classList.remove('is-booting');
      onDone();
    }, 200);
  }
}

// Builds one line like:  [   0.280] mounting /dev/curiosity... ok
function makeBootLine(ms, text, result) {
  const li = document.createElement('li');

  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  stamp.textContent = '[' + (ms / 1000).toFixed(3).padStart(8, ' ') + '] ';

  const ok = document.createElement('span');
  ok.className = 'ok';
  ok.textContent = result ? ' ' + result : '';

  li.append(stamp, text, ok);
  return li;
}


/* --------------------------------------------------------------------------
   2. Hero typing animation (the only typing animation on the site)
   Every character becomes its own <span>, hidden at first. We reveal them
   one by one, so the layout never jumps.
   -------------------------------------------------------------------------- */

const TYPE_SPEED = 55;   // ms per character
const TYPE_PAUSE = 280;  // extra pause after a full stop

function startTyping() {
  const typed = document.querySelector('.hero__typed');
  if (!typed) return;

  const lines = typed.querySelectorAll('.hero__line');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  // Reduced motion: show the whole headline at once, cursor at the end (it won't blink).
  if (reducedMotion) {
    lines[lines.length - 1].appendChild(cursor);
    typed.classList.add('is-ready');
    return;
  }

  // Split every line into single-character spans
  const chars = [];
  lines.forEach(function (line) {
    splitIntoChars(line, chars);
  });

  // While .is-typing is on, letters stay hidden until revealed, and the
  // overline on "permission" waits. Removing it at the end draws the overline.
  typed.classList.add('is-typing', 'is-ready');
  lines[0].prepend(cursor);

  let i = 0;
  function typeNext() {
    if (i >= chars.length) {
      typed.classList.remove('is-typing');
      return;
    }
    const current = chars[i];
    current.classList.add('is-on');
    current.after(cursor); // move the cursor right after the newest letter
    i++;
    setTimeout(typeNext, current.textContent === '.' ? TYPE_PAUSE : TYPE_SPEED);
  }

  setTimeout(typeNext, 250);
}

// Replaces every piece of text inside `element` with one <span class="ch">
// per character, and adds those spans to `chars` in reading order.
// Inner wrappers (like <span class="hero__mark">) are kept, so their
// styling (the overline) still applies.
function splitIntoChars(element, chars) {
  Array.from(element.childNodes).forEach(function (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const letters = document.createDocumentFragment();
      for (const letter of node.textContent) {
        const span = document.createElement('span');
        span.className = 'ch';
        span.textContent = letter;
        letters.appendChild(span);
        chars.push(span);
      }
      node.replaceWith(letters);
    } else {
      splitIntoChars(node, chars); // go inside the wrapper
    }
  });
}


/* --------------------------------------------------------------------------
   3. Mobile navigation
   The [ menu ] button shows/hides the link list on small screens.
   -------------------------------------------------------------------------- */

function initNav() {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '[ close ]' : '[ menu ]';
    menu.classList.toggle('is-open', open);
  }

  function isOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  toggle.addEventListener('click', function () {
    setOpen(!isOpen());
  });

  // Close after choosing a link
  menu.addEventListener('click', function (event) {
    if (event.target.closest('a')) setOpen(false);
  });

  // Escape closes the menu and puts focus back on the button
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });
}


/* --------------------------------------------------------------------------
   4. Countdown
   ONE source of truth: nextEventStart in js/config.js. The same tick()
   updates the big panel on the homepage AND the status bar on every page,
   so they can never disagree.
   -------------------------------------------------------------------------- */

function initCountdown() {
  const timeEl = document.getElementById('next-event-time');
  const panel = document.getElementById('event-panel');
  const statusEl = document.getElementById('status-countdown');
  const clockEl = document.getElementById('status-clock');
  const labelEl = document.getElementById('clock-label');

  const parts = {
    days: document.querySelector('[data-countdown="days"]'),
    hours: document.querySelector('[data-countdown="hours"]'),
    minutes: document.querySelector('[data-countdown="minutes"]'),
    seconds: document.querySelector('[data-countdown="seconds"]')
  };

  const start = MALWAROUS_CONFIG.nextEventStart;
  const target = new Date(start).getTime();
  if (timeEl) timeEl.setAttribute('datetime', start); // keeps the HTML accurate

  // Pakistan time for the status bar clock
  const pktFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi'
  });

  function tick() {
    if (clockEl) clockEl.textContent = pktFormat.format(new Date());

    // No valid date set yet: leave the "--" placeholders in place
    if (isNaN(target)) return;

    const left = splitTime(target - Date.now());

    if (left.done) {
      setText(parts.days, '00');
      setText(parts.hours, '00');
      setText(parts.minutes, '00');
      setText(parts.seconds, '00');
      setText(labelEl, 'live now');
      setText(statusEl, 'live now');
      if (panel) panel.classList.add('is-live');
      return;
    }

    setText(parts.days, pad(left.days));
    setText(parts.hours, pad(left.hours));
    setText(parts.minutes, pad(left.minutes));
    setText(parts.seconds, pad(left.seconds));
    setText(statusEl, pad(left.days) + 'd ' + pad(left.hours) + 'h ' + pad(left.minutes) + 'm');
  }

  tick();
  setInterval(tick, 1000);
}

// Turns milliseconds into days / hours / minutes / seconds
function splitTime(ms) {
  if (ms <= 0) return { done: true };
  const total = Math.floor(ms / 1000);
  return {
    done: false,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  };
}


/* --------------------------------------------------------------------------
   5. Command console (easter egg)
   Press ` to open. Also opens by clicking the prompt in the status bar,
   so it works on phones too.
   -------------------------------------------------------------------------- */

// Where each navigation command goes. "#something" means a section on the
// homepage (from other pages we go to index.html#something). Anything else
// is a page.
const ROUTES = {
  events: 'events.html',
  arena: '#next-event',
  academy: '#academy',
  writeups: '#writeups',
  halloffame: '#hall-of-fame',
  team: '#team',
  about: '#what-we-do',
  join: '#join',
  signup: 'signup.html',
  login: 'login.html'
};

const HELP_TEXT = [
  'navigate',
  '  events         all events, upcoming and past',
  '  arena          the next ctf',
  '  academy        learning paths',
  '  writeups       latest write-ups',
  '  halloffame     the leaderboard',
  '  team           who runs this place',
  '  about          what we do',
  '  join           how to join',
  'account',
  '  signup         create an account',
  '  login          log in',
  '  logout         log out',
  '  whoami         who are you, really',
  'guestbook',
  '  guestbook                 read the latest messages',
  '  guestbook sign <message>  leave one (log in first)',
  '  guestbook rm <id>         delete your own message',
  'other',
  '  flag <answer>  submit the flag hidden on this site',
  '  sudo           try it',
  '  clear          clear the console',
  '  exit           close (or press Esc)'
].join('\n');

const WHOAMI_LINES = [
  'uid=1000(guest) gid=1000(curious) groups=1000(curious),27(future-ctf-players)',
  'a guest with no shell, no creds, and a lot of curiosity. good start.',
  'someone who found the hidden console. that already counts as recon.',
  'not root. yet.'
];

// The hidden flag challenge. Only the SHA-256 hash of the flag is stored
// here, never the flag itself. The same hash is in supabase/schema.sql.
// To change the flag: open any page, press F12, and in the browser's own
// console run:  await sha(`malwarous{your_new_flag}`)  after pasting:
//   const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Then update this hash, the one in schema.sql, and ops/notes.txt.
const FLAG_SHA256 = 'f232a87719796a811e477e5114f60c08f364c1ce35857b6c3c98daf153819049';

function initConsole() {
  const panel = document.getElementById('console');
  const output = document.getElementById('console-output');
  const form = document.getElementById('console-form');
  const input = document.getElementById('console-input');
  const promptLabel = panel ? panel.querySelector('.console__prompt') : null;
  if (!panel || !output || !form || !input) return;

  const history = [];   // commands typed so far (arrow up/down)
  let historyPos = 0;
  let lastFocus = null; // where focus was before opening, so we can return it
  let greeted = false;
  let promptUser = 'guest';

  /* ---- open / close ---- */

  function isOpen() {
    return !panel.hidden;
  }

  function open() {
    lastFocus = document.activeElement;
    panel.hidden = false;
    if (!greeted) {
      print("malwarous shell. type 'help' to see what it can do.", 'hint');
      greeted = true;
    }
    input.focus();
    updatePromptUser();
  }

  function close() {
    panel.hidden = true;
    input.value = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Shows "kabir@malwarous:~$" instead of "guest@..." when logged in
  async function updatePromptUser() {
    let name = 'guest';
    if (accountsOn() && Account.hasSavedSession()) {
      const user = await Account.getCurrentUser();
      if (user && user.handle) name = user.handle;
    }
    promptUser = name;
    promptLabel.textContent = name + '@malwarous:~$';
  }

  /* ---- output ---- */

  // Adds one line to the console. Uses textContent, never innerHTML,
  // so whatever anyone types (or signs in the guestbook) is plain text.
  function print(text, type) {
    const line = document.createElement('p');
    line.className = 'console__line' + (type ? ' console__line--' + type : '');
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  // Prints a result object from account.js: { ok, message }
  function printResult(result, successText) {
    if (result.ok) print(successText);
    else print(result.message, 'error');
  }

  /* ---- commands ---- */

  function goTo(where) {
    if (where.charAt(0) === '#') {
      const section = document.querySelector(where);
      if (section) {
        const heading = section.querySelector('h2');
        print('-> ' + (heading ? heading.textContent : where));
        section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      where = 'index.html' + where; // that section lives on the homepage
    }
    // Cloudflare serves "events.html" at "/events", so compare without ".html"
    const here = window.location.pathname.replace(/\.html$/, '');
    if (here.endsWith('/' + where.replace(/\.html$/, ''))) {
      print("you're already here.");
      return;
    }
    print('opening ' + where + ' ...');
    window.location.href = where;
  }

  async function whoami() {
    if (accountsOn() && Account.hasSavedSession()) {
      const user = await Account.getCurrentUser();
      if (user && user.handle) {
        const admin = await Account.isAdmin();
        print('@' + user.handle + (admin
          ? ' (admin). with great power, etc.'
          : '. logged in, curious, probably caffeinated.'));
        return;
      }
    }
    if (new Date().getHours() < 5) {
      print("it's past midnight and you're typing into a hidden console. you'll fit right in.");
      return;
    }
    print(WHOAMI_LINES[Math.floor(Math.random() * WHOAMI_LINES.length)]);
  }

  async function logout() {
    if (!accountsOn() || !Account.hasSavedSession()) {
      print("you're not logged in.");
      return;
    }
    printResult(await Account.signOut(), 'logged out. see you around.');
    updatePromptUser();
  }

  // guestbook | guestbook sign <message> | guestbook rm <id>
  async function guestbook(words, line) {
    if (!accountsOn()) {
      print("the guestbook opens when accounts do. check back soon.", 'error');
      return;
    }
    const action = (words[1] || '').toLowerCase();

    if (action === 'sign') {
      // everything after "guestbook sign", without surrounding quotes
      const message = line.replace(/^\S+\s+\S+\s*/, '').replace(/^(["'])(.*)\1$/, '$2').trim();
      if (!message) {
        print('usage: guestbook sign <message>');
        return;
      }
      print('signing...');
      const result = await Account.signGuestbook(message);
      printResult(result, 'signed as @' + result.handle + '. thanks for stopping by.');
      return;
    }

    if (action === 'rm') {
      const id = parseInt(words[2], 10);
      if (!id) {
        print('usage: guestbook rm <id>');
        return;
      }
      printResult(await Account.deleteGuestbookEntry(id), 'deleted #' + id + '.');
      return;
    }

    if (action) {
      print('usage: guestbook [sign <message> | rm <id>]');
      return;
    }

    print('reading the guestbook...');
    const result = await Account.readGuestbook(10);
    if (!result.ok) {
      print(result.message, 'error');
      return;
    }
    if (!result.entries.length) {
      print('the guestbook is empty. be the first: guestbook sign <message>');
      return;
    }
    result.entries.forEach(function (entry) {
      const date = entry.date.toLocaleDateString('en-CA'); // YYYY-MM-DD
      print(('#' + entry.id).padEnd(6) + date + '  @' + entry.handle + ': ' + entry.message);
    });
  }

  // flag <answer>
  async function flag(line) {
    const guess = line.replace(/^\S+\s*/, '').trim();
    if (!guess) {
      print('usage: flag <answer>', 'hint');
      print("there's a flag hidden on this site. start where recon always starts: the page source.");
      return;
    }

    let correct;
    if (window.crypto && window.crypto.subtle) {
      correct = (await sha256Hex(guess)) === FLAG_SHA256;
    } else if (accountsOn()) {
      const result = await Account.submitFlag(guess); // no local crypto: ask the server
      correct = result.ok && result.correct;
    } else {
      print("can't check flags on this connection. try the https version of the site.", 'error');
      return;
    }

    if (!correct) {
      print("nope. that's not it. flags look like malwarous{...}", 'error');
      return;
    }
    print('correct. that is exactly the kind of curiosity we are looking for.', 'hint');
    print("now try the real thing: type 'arena'.");

    // Record the solve on the server (it checks the flag again itself)
    if (accountsOn() && Account.hasSavedSession()) {
      const result = await Account.submitFlag(guess);
      if (result.ok && result.recordedFor) print('solve recorded for @' + result.recordedFor + '.');
    } else if (accountsOn()) {
      print('log in and submit it again to get your handle on the record.');
    }
  }

  function run(raw) {
    const line = raw.trim();
    print(promptUser + '@malwarous:~$ ' + line, 'echo');
    if (!line) return;

    history.push(line);
    historyPos = history.length;

    // "Hall-of-Fame", "write_ups" etc. all work: lowercase, strip - and _
    const words = line.split(/\s+/);
    const name = words[0].toLowerCase().replace(/[-_]/g, '');

    if (ROUTES[name]) {
      if (name === 'arena') print("the arena isn't deployed yet. here's the next ctf:");
      goTo(ROUTES[name]);
    } else if (name === 'help') {
      print(HELP_TEXT);
    } else if (name === 'whoami') {
      whoami();
    } else if (name === 'logout') {
      logout();
    } else if (name === 'guestbook') {
      guestbook(words, line);
    } else if (name === 'flag') {
      flag(line);
    } else if (name === 'sudo') {
      print('nice try.');
    } else if (name === 'clear') {
      output.textContent = '';
    } else if (name === 'exit') {
      close();
    } else {
      print("command not found. try 'help'", 'error');
    }
  }

  /* ---- events ---- */

  form.addEventListener('submit', function (event) {
    event.preventDefault(); // don't reload the page
    run(input.value);
    input.value = '';
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowUp' && history.length) {
      event.preventDefault();
      historyPos = Math.max(0, historyPos - 1);
      input.value = history[historyPos];
    } else if (event.key === 'ArrowDown' && history.length) {
      event.preventDefault();
      historyPos = Math.min(history.length, historyPos + 1);
      input.value = history[historyPos] || '';
    }
  });

  // The ` key toggles the console from anywhere on the page
  document.addEventListener('keydown', function (event) {
    const isBacktick = event.key === '`' || (event.key === 'Dead' && event.code === 'Backquote');
    if (!isBacktick || event.ctrlKey || event.metaKey || event.altKey) return;
    if (root.classList.contains('is-booting')) return;

    // Don't hijack the key if someone is typing in another text field
    const target = event.target;
    const typingElsewhere = target !== input && target.closest && target.closest('input, textarea, select, [contenteditable="true"]');
    if (typingElsewhere) return;

    event.preventDefault();
    if (isOpen()) close(); else open();
  });

  // Buttons that open/close the console (status bar prompt, [ esc ] button)
  document.querySelectorAll('[data-console-open]').forEach(function (button) {
    button.addEventListener('click', open);
  });
  document.querySelectorAll('[data-console-close]').forEach(function (button) {
    button.addEventListener('click', close);
  });
}

// Is account.js loaded and are the Supabase settings filled in?
function accountsOn() {
  return typeof Account !== 'undefined' && Account.isConfigured();
}

// SHA-256 of a string, as hex (uses the browser's built-in crypto)
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}


/* --------------------------------------------------------------------------
   6. Events page filters  [ all ] [ ctf ] [ hackathon ] [ workshop ]
   Each past event has data-type="ctf" (etc.); the buttons show/hide them.
   -------------------------------------------------------------------------- */

function initFilters() {
  const buttons = document.querySelectorAll('[data-filter]');
  if (!buttons.length) return;

  const items = document.querySelectorAll('.past');
  const years = document.querySelectorAll('.archive__year');
  const label = document.getElementById('filter-label');
  const count = document.getElementById('archive-count');
  const empty = document.getElementById('archive-empty');

  function apply(type) {
    let shown = 0;
    items.forEach(function (item) {
      const match = type === 'all' || item.dataset.type === type;
      item.hidden = !match;
      if (match) shown++;
    });

    // Hide a year heading when none of its events are showing
    years.forEach(function (year) {
      year.hidden = !year.querySelector('.past:not([hidden])');
    });

    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === type));
    });

    setText(label, type);
    setText(count, shown + (shown === 1 ? ' event' : ' events'));
    if (empty) empty.hidden = shown > 0;
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      apply(button.dataset.filter);
    });
  });

  apply('all');
}


/* --------------------------------------------------------------------------
   7. 404 page: show the path that wasn't found
   -------------------------------------------------------------------------- */

function initNotFound() {
  let path = window.location.pathname;
  try {
    path = decodeURIComponent(path); // "%20" -> " "
  } catch (error) {
    // badly encoded address: show it as it is
  }
  document.querySelectorAll('[data-missing-path]').forEach(function (element) {
    element.textContent = path; // textContent: the address is shown as text, never run
  });
}


/* --------------------------------------------------------------------------
   8. Small helpers
   -------------------------------------------------------------------------- */

// 7 -> "07"
function pad(number) {
  return String(number).padStart(2, '0');
}

// Only touches the page when the text actually changes
function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

// Footer copyright year
function setYear() {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}

// sessionStorage throws in some private-browsing modes, so we wrap it
function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {
    // storage unavailable: the boot screen will just show again next time
  }
}
