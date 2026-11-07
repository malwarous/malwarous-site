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
     8. Arena: current room card
     9. Videos (click to play)
    10. Small helpers
   ========================================================================== */


/* --------------------------------------------------------------------------
   0. Early setup
   This file is loaded in <head>, so the lines below run before the page is
   drawn. That lets us turn the boot screen on without a flash of content.
   -------------------------------------------------------------------------- */

// Theme is chosen before the first paint so there is never a flash of the
// wrong palette. ui.js adds the control that changes it.
(function initThemeEarly() {
  let saved = null;
  try { saved = localStorage.getItem('malwarous:theme'); } catch (error) { /* storage off */ }
  const theme = saved === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();

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
  initEventStatus();
  initEventCalendar();
  initConsole();
  initFilters();
  initNotFound();
  initArenaRoom();
  initVideos();
  setYear();
  runBootScreen(startTyping); // when the boot screen is done, type the headline
});


/* --------------------------------------------------------------------------
   1. Boot screen
   A short fake boot log (under 1.5 s). Any key or click skips it.
   -------------------------------------------------------------------------- */

const BOOT_LINES = [
  ['handshake', 'establishing secure channel', 'ok'],
  ['route', 'edge -> islamabad/pk', '14ms'],
  ['crypto', 'verifying payload signature', 'ok'],
  ['fs', 'mounting /dev/curiosity', 'ok'],
  ['auth', 'guest session accepted', 'read-only'],
  ['arena', 'loading weekly ctf index', 'ok'],
  ['ready', 'welcome to malwarous', '']
];

const BOOT_LINE_DELAY = 185; // ms between log lines
const BOOT_TOTAL = 2150;     // ms of progress before the wipe
const BOOT_EXIT = 520;       // ms of transition
const BOOT_WORD = 'MALWAROUS';
const BOOT_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*';
const BOOT_STAGES = [
  [0, 'initializing secure channel'],
  [26, 'verifying payload signature'],
  [48, 'mounting /dev/curiosity'],
  [68, 'negotiating guest session'],
  [86, 'loading arena index'],
  [100, 'access granted']
];

function runBootScreen(onDone) {
  const boot = document.getElementById('boot');

  if (!shouldBoot || !boot) {
    root.classList.remove('is-booting');
    onDone();
    return;
  }

  writeSession(BOOT_KEY, 'yes'); // don't show it again this session

  const log = document.getElementById('boot-log');
  const word = document.getElementById('boot-word');
  const bar = boot.querySelector('[data-boot-bar]');
  const percent = boot.querySelector('[data-boot-percent]');
  const status = boot.querySelector('[data-boot-status]');
  const letters = [];
  const timers = [];
  let finished = false;
  let raf = 0;

  // Build the wordmark as fixed-width glyph slots, then decode it.
  if (word) {
    word.textContent = '';
    BOOT_WORD.split('').forEach(function (character) {
      const span = document.createElement('span');
      span.className = 'is-pending';
      span.textContent = randomGlyph();
      letters.push({ element: span, target: character });
      word.appendChild(span);
    });
  }

  let settled = 0;
  const decode = setInterval(function () {
    if (settled < letters.length) {
      letters[settled].element.textContent = letters[settled].target;
      letters[settled].element.classList.remove('is-pending');
      settled++;
    }
    for (let i = settled; i < letters.length; i++) {
      letters[i].element.textContent = randomGlyph();
    }
    if (settled >= letters.length) clearInterval(decode);
  }, 62);

  BOOT_LINES.forEach(function (line, index) {
    timers.push(setTimeout(function () {
      if (log) log.appendChild(makeBootLine(line[0], line[1], line[2]));
    }, 140 + index * BOOT_LINE_DELAY));
  });

  // One requestAnimationFrame loop drives the bar, percentage and status, so
  // they can never drift apart (and rAF pauses politely in a hidden tab).
  const started = performance.now();
  function progress(now) {
    const ratio = Math.min(1, (now - started) / BOOT_TOTAL);
    const eased = 1 - Math.pow(1 - ratio, 2);
    const value = Math.round(eased * 100);

    if (bar) bar.style.transform = 'scaleX(' + eased + ')';
    if (percent) percent.textContent = String(value).padStart(3, '0') + '%';

    if (status) {
      let label = BOOT_STAGES[0][1];
      BOOT_STAGES.forEach(function (stage) {
        if (value >= stage[0]) label = stage[1];
      });
      status.textContent = label;
    }

    if (ratio < 1) raf = requestAnimationFrame(progress);
    else finish();
  }
  raf = requestAnimationFrame(progress);
  // rAF pauses in a hidden tab; this fallback guarantees the boot always ends.
  const autoFinish = setTimeout(finish, BOOT_TOTAL + 150);

  document.addEventListener('keydown', finish);
  document.addEventListener('pointerdown', finish);
  window.addEventListener('pagehide', finish, { once: true });

  function finish() {
    if (finished) return;
    finished = true;

    timers.forEach(clearTimeout);
    clearInterval(decode);
    clearTimeout(autoFinish);
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', finish);
    document.removeEventListener('pointerdown', finish);

    // Settle the wordmark and the meter before the wipe, so skipping early
    // still ends on a finished frame.
    letters.forEach(function (letter) {
      letter.element.textContent = letter.target;
      letter.element.classList.remove('is-pending');
    });
    if (bar) bar.style.transform = 'scaleX(1)';
    if (percent) percent.textContent = '100%';
    if (status) status.textContent = 'access granted';

    boot.classList.add('is-leaving');
    setTimeout(function () {
      root.classList.remove('is-booting');
      boot.classList.remove('is-leaving');
      onDone();
    }, BOOT_EXIT);
  }
}

function randomGlyph() {
  return BOOT_GLYPHS[Math.floor(Math.random() * BOOT_GLYPHS.length)];
}

// Builds one line like:  [ handshake ] establishing secure channel  ok
function makeBootLine(label, text, result) {
  const li = document.createElement('li');

  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  stamp.textContent = '[' + label.padEnd(9, ' ') + ']';

  const command = document.createElement('span');
  command.className = 'boot__cmd';
  command.textContent = text;

  const ok = document.createElement('span');
  ok.className = 'ok';
  ok.textContent = result;

  li.append(stamp, command, ok);
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
  const dateRow = document.getElementById('event-date-row');
  const dateLabel = document.getElementById('event-date-label');
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

  // Everything readable on the page is generated from config.js, so changing
  // the date there can never leave the visible date behind.
  const startValue = MALWAROUS_CONFIG.nextEventStart;
  const endValue = MALWAROUS_CONFIG.nextEventEnd;
  const target = configDate(startValue);
  const end = configDate(endValue);
  const liveFor = (MALWAROUS_CONFIG.nextEventHours || 3) * 3600 * 1000;

  if (timeEl && !isNaN(target)) {
    timeEl.setAttribute('datetime', startValue);
    timeEl.textContent = formatPkt(target);
  }

  // One visible date only. Upcoming: the start. Live: the lock. That keeps the
  // panel from showing two dates for the same event.
  let dateMode = '';
  function renderDate(mode) {
    if (!dateRow || !timeEl) return;
    if (dateMode === mode) return;
    dateMode = mode;

    if (mode === 'hidden') {
      dateRow.hidden = true;
      return;
    }

    const ms = mode === 'locks' ? end : target;
    if (isNaN(ms)) {
      dateRow.hidden = true;
      dateMode = 'hidden';
      return;
    }

    dateRow.hidden = false;
    if (dateLabel) dateLabel.textContent = mode === 'locks' ? 'locks' : 'date';
    timeEl.setAttribute('datetime', mode === 'locks' ? endValue : startValue);
    timeEl.textContent = formatPkt(ms);
  }

  renderDate(isNaN(target) ? 'hidden' : (Date.now() >= target && !isNaN(end) ? 'locks' : 'date'));

  // Keep the registration button pointed at the current event, not a slug
  // typed into the HTML months ago.
  const registerLink = document.getElementById('next-event-register');
  if (registerLink && MALWAROUS_CONFIG.nextEventSlug) {
    registerLink.href = 'register.html?event=' + encodeURIComponent(MALWAROUS_CONFIG.nextEventSlug);
  }

  // Pakistan time for the status bar clock
  const pktFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi'
  });

  // Shows "--" everywhere and "tba" in the status bar
  function showTba() {
    setText(parts.days, '--');
    setText(parts.hours, '--');
    setText(parts.minutes, '--');
    setText(parts.seconds, '--');
    setText(labelEl, 'date to be announced');
    setText(statusEl, 'tba');
    renderDate('hidden');
    if (panel) panel.classList.remove('is-live');
  }

  function showDigits(t) {
    setText(parts.days, pad(t.days));
    setText(parts.hours, pad(t.hours));
    setText(parts.minutes, pad(t.minutes));
    setText(parts.seconds, pad(t.seconds));
  }

  function tick() {
    const now = Date.now();
    if (clockEl) clockEl.textContent = pktFormat.format(new Date());

    // Event is live and has an explicit end: count down to the lock.
    if (!isNaN(target) && !isNaN(end) && now >= target) {
      const left = splitTime(end - now);
      if (left.done) {
        // After a day of "locked", the slot is free for the next event.
        if (now > end + 24 * 3600 * 1000) {
          showTba();
          return;
        }
        showDigits({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        renderDate('locks');
        setText(labelEl, 'room locked · results coming soon');
        setText(statusEl, 'locked');
        if (panel) panel.classList.remove('is-live');
      } else {
        showDigits(left);
        renderDate('locks');
        setText(labelEl, 'live · room locks in');
        setText(statusEl, 'locks in ' + pad(left.days) + 'd ' + pad(left.hours) + 'h ' + pad(left.minutes) + 'm');
        if (panel) panel.classList.add('is-live');
      }
      return;
    }

    // No date set yet, or the event is over: "tba" until there's a new date
    if (isNaN(target) || now > target + liveFor) {
      showTba();
      return;
    }

    const left = splitTime(target - now);

    if (left.done) {
      setText(parts.days, '00');
      setText(parts.hours, '00');
      setText(parts.minutes, '00');
      setText(parts.seconds, '00');
      renderDate('date');
      setText(labelEl, 'live now');
      setText(statusEl, 'live now');
      if (panel) panel.classList.add('is-live');
      return;
    }

    renderDate('date');
    setText(labelEl, 'starts in');
    setText(parts.days, pad(left.days));
    setText(parts.hours, pad(left.hours));
    setText(parts.minutes, pad(left.minutes));
    setText(parts.seconds, pad(left.seconds));
    setText(statusEl, pad(left.days) + 'd ' + pad(left.hours) + 'h ' + pad(left.minutes) + 'm');
  }

  tick();
  setInterval(tick, 1000);
}

// An ISO string from config.js -> milliseconds, or NaN when unset.
function configDate(value) {
  return typeof value === 'string' && value.trim() ? new Date(value).getTime() : NaN;
}

// 4 Nov 2026, 10:00 AM PKT
function formatPkt(ms) {
  const text = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi'
  }).format(new Date(ms));
  return text.replace(/\b(am|pm)\b/i, function (match) { return match.toUpperCase(); }) + ' PKT';
}

// 4 Nov 2026
function formatPktDay(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi'
  }).format(new Date(ms));
}

// Keeps every event row that opts in with data-event-start in sync with the
// clock. The homepage and /events can never say "live" after the room closed.
function initEventStatus() {
  const rows = document.querySelectorAll('[data-event-start]');
  if (!rows.length) return;

  // A row can point at the shared event ("nextEventStart") so changing
  // config.js updates every table at once, or carry its own ISO date.
  function eventDate(value) {
    if (value === 'nextEventStart') return configDate(MALWAROUS_CONFIG.nextEventStart);
    if (value === 'nextEventEnd') return configDate(MALWAROUS_CONFIG.nextEventEnd);
    return configDate(value);
  }

  function display() {
    const now = Date.now();
    rows.forEach(function (row) {
      const start = eventDate(row.dataset.eventStart);
      const end = eventDate(row.dataset.eventEnd);
      if (isNaN(start)) return;

      const dateCell = row.querySelector('.events-table__date');
      if (dateCell) dateCell.textContent = formatPktDay(start);

      let status = row.querySelector('.status');
      if (!status) {
        const cell = row.querySelector('.events-table__status');
        if (!cell) return;
        status = document.createElement('span');
        cell.appendChild(status);
      }

      let label = 'completed';
      let className = 'status status--completed';
      if (now < start) {
        label = 'open';
        className = 'status status--open';
      } else if (isNaN(end) || now < end) {
        label = 'live';
        className = 'status status--live';
      }
      status.className = className;
      status.textContent = label;
    });
  }

  display();
  setInterval(display, 60000);
}

// "add to calendar" writes a real .ics file from config.js. No server needed.
function initEventCalendar() {
  const button = document.querySelector('[data-add-calendar]');
  if (!button) return;

  button.addEventListener('click', function () {
    const start = configDate(MALWAROUS_CONFIG.nextEventStart);
    if (isNaN(start)) {
      notify('no event date is set yet.');
      return;
    }
    let end = configDate(MALWAROUS_CONFIG.nextEventEnd);
    if (isNaN(end) || end <= start) end = start + (MALWAROUS_CONFIG.nextEventHours || 3) * 3600 * 1000;

    const title = MALWAROUS_CONFIG.nextEventTitle || 'Malwarous event';
    const description = MALWAROUS_CONFIG.nextEventDescription || 'A Malwarous event. Break things, with permission.';
    const location = MALWAROUS_CONFIG.nextEventVenue || 'Online';
    const url = MALWAROUS_CONFIG.nextEventUrl || 'https://malwarous.dev/';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Malwarous//Events//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:malwarous-' + start + '@malwarous.dev',
      'DTSTAMP:' + stamp,
      'DTSTART:' + icsDate(start),
      'DTEND:' + icsDate(end),
      'SUMMARY:' + icsEscape(title),
      'DESCRIPTION:' + icsEscape(description),
      'LOCATION:' + icsEscape(location),
      'URL:' + url,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'malwarous-next-event.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    notify('calendar file downloaded.');
  });
}

function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// Use the experience layer's toast when it is available.
function notify(message) {
  if (window.MalwarousUI && window.MalwarousUI.toast) window.MalwarousUI.toast(message);
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
  arena: 'arena.html',
  academy: 'academy.html',
  writeups: 'writeups.html',
  halloffame: 'hall-of-fame.html',
  team: 'team.html',
  about: '#what-we-do',
  join: '#join',
  signup: 'signup.html',
  login: 'login.html'
};

const HELP_TEXT = [
  'navigate',
  '  events         all events, upcoming and past',
  '  arena          this room, rules, how to play',
  '  academy        courses and learning paths',
  '  writeups       write-ups and opportunities',
  '  halloffame     winners and rankings',
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
  '  theme [mode]   toggle light/dark, or set: theme light | theme dark',
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

  // theme | theme light | theme dark
  function theme(argument) {
    const wanted = String(argument || '').toLowerCase();
    if (wanted && wanted !== 'light' && wanted !== 'dark') {
      print('usage: theme [light|dark]', 'hint');
      return;
    }
    if (!window.MalwarousUI || !window.MalwarousUI.setTheme) {
      print('theme controls are not available on this page.', 'error');
      return;
    }
    const next = wanted || (window.MalwarousUI.theme() === 'light' ? 'dark' : 'light');
    window.MalwarousUI.setTheme(next);
    print('theme -> ' + next + '.');
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
    } else if (name === 'theme') {
      theme(words[1]);
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
  const buttons = document.querySelectorAll('.archive__bar [data-filter]');
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
   8. Arena: room card with < > arrows
   Shows one room at a time from rooms in js/config.js. It opens on the
   room that's live right now (or the next one to open), and the arrows
   move between rooms. The status keeps itself up to date:
   "opens in ..." / "live · closes in ..." / "closed".
   -------------------------------------------------------------------------- */

function initArenaRoom() {
  const card = document.getElementById('room');
  if (!card) return;

  const rooms = MALWAROUS_CONFIG.rooms || [];
  if (!rooms.length) return;

  const field = function (name) { return card.querySelector('[data-room="' + name + '"]'); };
  const prev = document.getElementById('room-prev');
  const next = document.getElementById('room-next');

  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi'
  });
  const showDate = function (time) { return isNaN(time) ? 'tba' : dateFormat.format(time) + ' PKT'; };
  const timeOf = function (value) { return new Date(value).getTime(); };

  // live = opened and not closed yet. Which room to start on?
  function startIndex() {
    const now = Date.now();
    const live = rooms.findIndex(function (r) {
      return timeOf(r.opens) <= now && (isNaN(timeOf(r.closes)) || now < timeOf(r.closes));
    });
    if (live !== -1) return live;
    // nothing live: the first room that hasn't closed yet (the next one)
    const upcoming = rooms.findIndex(function (r) { return !(timeOf(r.closes) <= now); });
    return upcoming !== -1 ? upcoming : rooms.length - 1;
  }

  let index = startIndex();

  function render() {
    const room = rooms[index];
    const opens = timeOf(room.opens);
    const closes = timeOf(room.closes);
    const now = Date.now();

    setText(field('number'), '#' + pad(room.number || 0));
    setText(field('name'), room.name || 'tba');
    setText(field('opens'), showDate(opens));
    setText(field('closes'), showDate(closes));
    setText(field('position'), (index + 1) + ' / ' + rooms.length);

    let status;
    let live = false;
    if (isNaN(opens)) {
      status = 'next room coming soon';
    } else if (now < opens) {
      status = 'opens in ' + shortTime(opens - now);
    } else if (isNaN(closes) || now < closes) {
      live = true;
      status = isNaN(closes) ? 'live now' : 'live · closes in ' + shortTime(closes - now);
    } else {
      status = 'closed · results in the hall of fame';
    }
    setText(field('status'), status);
    card.classList.toggle('is-live', live);

    // Only accept real TryHackMe links, so a typo can't send people somewhere odd
    const link = field('link');
    const hasLink = /^https:\/\/tryhackme\.com\//.test(room.url || '');
    link.href = hasLink ? room.url : '#';
    link.hidden = !(live && hasLink);
    field('nolink').hidden = live && hasLink;

    // Arrows: greyed out at either end of the list
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === rooms.length - 1;
  }

  function move(step) {
    const target = index + step;
    if (target < 0 || target >= rooms.length) return;
    index = target;
    render();
  }

  if (prev) prev.addEventListener('click', function () { move(-1); });
  if (next) next.addEventListener('click', function () { move(1); });

  // Left/right arrow keys work too while the card (or an arrow) has focus
  card.addEventListener('keydown', function (event) {
    if (event.target.closest('a')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
  });

  render();
  setInterval(render, 30000);
}

// 3 days 4 hours -> "3d 04h"; under a day -> "4h 12m"
function shortTime(ms) {
  const t = splitTime(ms);
  if (t.done) return '0m';
  return t.days ? t.days + 'd ' + pad(t.hours) + 'h' : t.hours + 'h ' + pad(t.minutes) + 'm';
}


/* --------------------------------------------------------------------------
   9. Videos (click to play)
   <div class="video" data-youtube="VIDEO_ID" data-title="..."></div>
   shows a play button; YouTube only loads when someone clicks it, which
   keeps pages fast and doesn't send visitors to YouTube until they choose.
   An empty data-youtube="" shows a "video coming soon" placeholder.
   -------------------------------------------------------------------------- */

function initVideos() {
  document.querySelectorAll('.video[data-youtube]').forEach(function (box) {
    const id = box.dataset.youtube;
    const title = box.dataset.title || 'video';

    // YouTube IDs are 11 letters, digits, - or _. Anything else is ignored.
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      box.classList.add('video--empty');
      box.textContent = '[ video coming soon ]';
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video__play';
    button.setAttribute('aria-label', 'Play video: ' + title);

    const thumb = document.createElement('img');
    thumb.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    thumb.alt = '';
    thumb.loading = 'lazy';

    const label = document.createElement('span');
    label.className = 'video__label';
    label.textContent = '> play';

    button.append(thumb, label);
    box.appendChild(button);

    button.addEventListener('click', function () {
      const frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1';
      frame.title = title;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      box.replaceChildren(frame);
      frame.focus();
    });
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
