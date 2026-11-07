/* ==========================================================================
   Malwarous — ui.js
   The "experience" layer: theme switching, the site cursor, scroll motion,
   the command palette and the live visitor count. The homepage hero mesh
   lives in js/hero-mesh.js.

   This file is deliberately independent of account.js and main.js. Everything
   here is progressive: if a feature cannot run, the site behaves exactly like
   before. Nothing in here needs a build step or a library.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches && window.matchMedia('(hover: hover)').matches;
  var THEME_KEY = 'malwarous:theme';
  // config.js declares MALWAROUS_CONFIG with `const`, so it is a lexically
  // scoped global rather than a window property. Read it either way.
  var config = (typeof MALWAROUS_CONFIG !== 'undefined' ? MALWAROUS_CONFIG : window.MALWAROUS_CONFIG) || {};

  document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    initScrollProgress();
    initReveal();
    initMagnets();
    initPalette();
    initCursor();
    initPresence();
    initKonami();
    initComingSoon();
    document.documentElement.classList.add('ui-ready');
  });


  /* ==========================================================================
     1. Theme
     The first paint is handled by main.js (to avoid a flash). This section
     only adds the control and keeps everything else in sync.
     ========================================================================== */

  function currentTheme() {
    return root.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme, save) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (save !== false) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* storage off */ }
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#F4F2EC' : '#0E0E11';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
      button.setAttribute('aria-pressed', String(theme === 'light'));
    });
    window.dispatchEvent(new CustomEvent('malwarous:theme', { detail: { theme: theme } }));
  }

  function initThemeToggle() {
    var header = document.querySelector('.site-header__inner');
    var actions = header ? header.querySelector('.site-header__actions') : null;
    var join = header ? header.querySelector('.site-header__join') : null;
    var button = document.querySelector('[data-theme-toggle]');

    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle';
      button.setAttribute('data-theme-toggle', '');
      button.innerHTML =
        '<span class="theme-toggle__icon" aria-hidden="true">' +
          '<svg class="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
            '<circle cx="12" cy="12" r="4"></circle>' +
            '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>' +
          '</svg>' +
          '<svg class="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
            '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"></path>' +
          '</svg>' +
        '</span>' +
        '<span class="theme-toggle__beam" aria-hidden="true"></span>';

      if (header) header.insertBefore(button, actions || join || null);
      else {
        button.classList.add('theme-toggle--floating');
        document.body.appendChild(button);
      }
    }

    applyTheme(currentTheme(), false);

    button.addEventListener('click', function (event) {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      button.classList.remove('is-spinning');
      void button.offsetWidth; // restart the icon animation
      button.classList.add('is-spinning');
      setTimeout(function () { button.classList.remove('is-spinning'); }, 520);
      switchTheme(next, event);
    });

    document.addEventListener('keydown', function (event) {
      if (event.altKey && (event.key === 't' || event.key === 'T')) {
        if (isTyping(event.target)) return;
        event.preventDefault();
        switchTheme(currentTheme() === 'light' ? 'dark' : 'light', button);
      }
    });
  }

  var activeTransition = null;
  var pendingTheme = null;

  function switchTheme(next, source) {
    // No transition support, reduced motion, a hidden tab or a transition
    // already in flight: switch instantly so the command never gets lost.
    if (reducedMotion || !document.startViewTransition || document.visibilityState !== 'visible') {
      applyThemeInstant(next);
      return;
    }
    if (activeTransition) {
      pendingTheme = next;
      return;
    }

    try {
      activeTransition = document.startViewTransition(function () { applyTheme(next, true); });
    } catch (error) {
      activeTransition = null;
      applyThemeInstant(next);
      return;
    }

    var done = function () {
      activeTransition = null;
      if (pendingTheme) {
        var queued = pendingTheme;
        pendingTheme = null;
        switchTheme(queued, source);
      }
    };
    activeTransition.finished.then(done, done);

    activeTransition.ready.then(function () {
      var rect = source && source.getBoundingClientRect ? source.getBoundingClientRect() : null;
      var x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
      var y = rect ? rect.top + rect.height / 2 : 48;
      var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      document.documentElement.animate(
        { clipPath: ['circle(0 at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () { /* the theme already switched */ });
  }

  function applyThemeInstant(next) {
    root.classList.add('theme-transition');
    applyTheme(next, true);
    setTimeout(function () { root.classList.remove('theme-transition'); }, 420);
  }


  /* ==========================================================================
     2. Scroll progress + reveal-on-scroll
     ========================================================================== */

  function initScrollProgress() {
    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    document.body.appendChild(bar);
    var fill = bar.firstChild;
    var ticking = false;

    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      fill.style.transform = 'scaleX(' + progress + ')';
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function initReveal() {
    if (reducedMotion || !('IntersectionObserver' in window)) return;

    var groups = [
      { selector: '.section__head, .event-panel, .split__aside, .split__main, .join > *, .page-hero__inner > *', step: 0 },
      { selector: '.log__row, .member, .past, .post, .gallery-event, .lesson, .roadmap__stage, .step, .rule, .project, .crew__card, .shelf__item, .season__stat, .podium__place, .module, .kit__item', step: 55 },
      { selector: '.events-table tbody tr, .ls__row', step: 35 }
    ];

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    groups.forEach(function (group) {
      var seen = new WeakMap();
      document.querySelectorAll(group.selector).forEach(function (element) {
        if (element.closest('.hero, .boot, .console, .palette')) return;
        var parent = element.parentElement;
        var index = seen.get(parent) || 0;
        seen.set(parent, index + 1);
        element.classList.add('reveal');
        if (group.step) element.style.setProperty('--reveal-delay', Math.min(index, 6) * group.step + 'ms');
        observer.observe(element);
      });
    });
  }

  function initMagnets() {
    if (!finePointer || reducedMotion) return;
    document.querySelectorAll('.btn, .filter, .room__arrow, .theme-toggle').forEach(function (element) {
      element.classList.add('is-magnetic');
      element.addEventListener('pointermove', function (event) {
        var rect = element.getBoundingClientRect();
        var x = (event.clientX - rect.left - rect.width / 2) / rect.width;
        var y = (event.clientY - rect.top - rect.height / 2) / rect.height;
        element.style.setProperty('--mag-x', (x * 5).toFixed(2) + 'px');
        element.style.setProperty('--mag-y', (y * 4).toFixed(2) + 'px');
      });
      element.addEventListener('pointerleave', function () {
        element.style.setProperty('--mag-x', '0px');
        element.style.setProperty('--mag-y', '0px');
      });
    });
  }


  /* ==========================================================================
     3. Command palette — Ctrl/Cmd+K
     ========================================================================== */

  var palette = null;
  var paletteItems = [];
  var paletteIndex = 0;
  var paletteLastFocus = null;

  function initPalette() {
    if (document.getElementById('palette')) return;

    palette = document.createElement('div');
    palette.className = 'palette';
    palette.id = 'palette';
    palette.hidden = true;
    palette.innerHTML =
      '<div class="palette__scrim" data-palette-close></div>' +
      '<div class="palette__box" role="dialog" aria-modal="true" aria-labelledby="palette-title">' +
        '<div class="palette__bar"><span id="palette-title">// command palette</span><button class="palette__close" type="button" data-palette-close aria-label="Close command palette">[ esc ]</button></div>' +
        '<label class="palette__search"><span aria-hidden="true">&gt;</span><input id="palette-input" type="text" autocomplete="off" spellcheck="false" placeholder="jump to a page or run a command..." aria-label="Search commands"></label>' +
        '<ul class="palette__list" id="palette-list" role="listbox" aria-label="Commands"></ul>' +
        '<p class="palette__hint"><kbd>&uarr;</kbd><kbd>&darr;</kbd> move <span>&middot;</span> <kbd>enter</kbd> run <span>&middot;</span> <kbd>ctrl</kbd> <kbd>k</kbd> toggle</p>' +
      '</div>';
    document.body.appendChild(palette);

    var input = document.getElementById('palette-input');
    var list = document.getElementById('palette-list');
    var isHome = /(^|\/)index\.html$/.test(location.pathname) || /\/$/.test(location.pathname);

    function page(path) {
      return function () { location.href = path; };
    }

    function section(hash) {
      return function () {
        if (isHome) {
          var target = document.querySelector(hash);
          if (target) target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
          else location.href = 'index.html' + hash;
        } else {
          location.href = 'index.html' + hash;
        }
      };
    }

    paletteItems = [
      { label: 'next event', hint: '~/events/next', keys: 'event ctf countdown register', run: section('#next-event') },
      { label: 'events', hint: '~/events', keys: 'ctf hackathon workshop archive', run: page('events.html') },
      { label: 'arena', hint: '~/arena', keys: 'tryhackme room challenges', run: page('arena.html') },
      { label: 'academy', hint: '~/academy', keys: 'learn courses lectures psp', run: page('academy.html') },
      { label: 'write-ups', hint: '~/writeups', keys: 'posts blog opportunities', run: page('writeups.html') },
      { label: 'hall of fame', hint: '~/hall-of-fame', keys: 'ranking scores winners leaderboard', run: page('hall-of-fame.html') },
      { label: 'gallery', hint: '~/gallery', keys: 'photos pictures events', run: page('gallery.html') },
      { label: 'team', hint: '~/team', keys: 'members people apply', run: page('team.html') },
      { label: 'about', hint: '~/about', keys: 'what we do mission', run: section('#what-we-do') },
      { label: 'join', hint: '~/join', keys: 'signup whatsapp community', run: section('#join') },
      { label: 'log in', hint: '~/login', keys: 'account auth sign in', run: page('login.html') },
      { label: 'create account', hint: '~/signup', keys: 'join register auth', run: page('signup.html') },
      { label: 'toggle theme', hint: currentTheme() === 'light' ? 'dark mode' : 'light mode', keys: 'light dark colour color lights', run: function () { switchTheme(currentTheme() === 'light' ? 'dark' : 'light', document.querySelector('[data-theme-toggle]')); } },
      { label: 'open console', hint: 'shell', keys: 'terminal guestbook whoami flag', run: function () { closePalette(); var trigger = document.querySelector('[data-console-open]'); if (trigger) trigger.click(); } },
      { label: 'copy page link', hint: location.pathname, keys: 'share clipboard url', run: function () { copyText(location.href); } },
      { label: 'github', hint: 'external', keys: 'source code repository', run: function () { window.open('https://github.com/malwarous', '_blank', 'noopener'); } },
      { label: 'whatsapp community', hint: 'external', keys: 'chat join community', run: function () { window.open('https://chat.whatsapp.com/KH2JPvkNBVl4ZqPslutRWs', '_blank', 'noopener'); } },
      { label: 'tryhackme room', hint: 'external', keys: 'arena play challenge', run: function () { window.open('https://tryhackme.com/jr/inboxundersiege', '_blank', 'noopener'); } }
    ];

    function render(query) {
      var needle = (query || '').trim().toLowerCase();
      list.textContent = '';
      var items = paletteItems.filter(function (item) {
        if (!needle) return true;
        return (item.label + ' ' + item.hint + ' ' + item.keys).toLowerCase().indexOf(needle) !== -1;
      });
      paletteIndex = 0;
      if (!items.length) {
        var empty = document.createElement('li');
        empty.className = 'palette__empty';
        empty.textContent = 'nothing matched. try "events", "theme" or "join".';
        list.appendChild(empty);
        return;
      }
      items.forEach(function (item, index) {
        var li = document.createElement('li');
        li.className = 'palette__item';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(index === 0));
        li.innerHTML = '<span class="palette__label"></span><span class="palette__hint-text"></span>';
        li.firstChild.textContent = item.label;
        li.lastChild.textContent = item.hint;
        li.addEventListener('click', function () { runItem(item); });
        li.addEventListener('pointermove', function () {
          paletteIndex = index;
          updateSelection();
        });
        list.appendChild(li);
      });
      updateSelection();
    }

    function visibleItems() {
      return Array.prototype.slice.call(list.querySelectorAll('.palette__item'));
    }

    function updateSelection() {
      var items = visibleItems();
      items.forEach(function (li, index) {
        li.setAttribute('aria-selected', String(index === paletteIndex));
      });
      var active = items[paletteIndex];
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function runItem(item) {
      closePalette();
      setTimeout(function () { item.run(); }, 40);
    }

    function openPalette() {
      if (!palette.hidden) return;
      paletteLastFocus = document.activeElement;
      palette.hidden = false;
      root.classList.add('palette-open');
      render('');
      input.value = '';
      requestAnimationFrame(function () {
        palette.classList.add('is-open');
        input.focus();
      });
    }

    function closePalette() {
      if (palette.hidden) return;
      palette.classList.remove('is-open');
      palette.hidden = true;
      root.classList.remove('palette-open');
      if (paletteLastFocus && paletteLastFocus.focus) paletteLastFocus.focus();
    }

    input.addEventListener('input', function () { render(input.value); });

    input.addEventListener('keydown', function (event) {
      var items = visibleItems();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        paletteIndex = Math.min(items.length - 1, paletteIndex + 1);
        updateSelection();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        paletteIndex = Math.max(0, paletteIndex - 1);
        updateSelection();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        var item = paletteItems.filter(function (candidate) {
          return (candidate.label + ' ' + candidate.hint + ' ' + candidate.keys).toLowerCase().indexOf(input.value.trim().toLowerCase()) !== -1;
        })[paletteIndex];
        if (item) runItem(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      }
    });

    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-palette-close]')) closePalette();
    });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        if (palette.hidden) openPalette(); else closePalette();
        return;
      }
      if (event.key === 'Escape' && !palette.hidden) {
        event.preventDefault();
        closePalette();
      }
    });

    document.querySelectorAll('[data-palette-open]').forEach(function (button) {
      button.addEventListener('click', openPalette);
    });

    // Make the status-bar hint clickable without editing the shared layout.
    var statusbar = document.querySelector('.statusbar');
    var hint = statusbar ? statusbar.querySelector('.statusbar__hint') : null;
    if (statusbar && hint) {
      var paletteButton = document.createElement('button');
      paletteButton.type = 'button';
      paletteButton.className = 'statusbar__item statusbar__palette';
      paletteButton.setAttribute('data-palette-open', '');
      paletteButton.setAttribute('aria-label', 'Open command palette');
      paletteButton.innerHTML = '<kbd>ctrl</kbd> <kbd>k</kbd> palette';
      paletteButton.addEventListener('click', openPalette);
      statusbar.insertBefore(paletteButton, hint);
    }
  }


  /* ==========================================================================
     4. The site cursor
     Only on precise pointers. The native cursor is hidden only after this
     feature successfully starts, so there is never a cursor-less page.
     ========================================================================== */

  function initCursor() {
    if (!finePointer || reducedMotion || !document.body) return;

    var wrap = document.createElement('div');
    wrap.className = 'site-cursor';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<canvas class="site-cursor__trail"></canvas>' +
      '<div class="site-cursor__ring">' +
        '<i class="site-cursor__corner site-cursor__corner--tl"></i>' +
        '<i class="site-cursor__corner site-cursor__corner--tr"></i>' +
        '<i class="site-cursor__corner site-cursor__corner--bl"></i>' +
        '<i class="site-cursor__corner site-cursor__corner--br"></i>' +
        '<span class="site-cursor__label"></span>' +
      '</div>' +
      '<svg class="site-cursor__dot" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C12.7 6.6 17.4 11.3 24 12C17.4 12.7 12.7 17.4 12 24C11.3 17.4 6.6 12.7 0 12C6.6 11.3 11.3 6.6 12 0Z"/></svg>';
    document.body.appendChild(wrap);

    // A <dialog> paints in the browser's top layer, above every z-index. Move
    // the cursor into the open dialog so it never vanishes over the gallery
    // lightbox, then put it back when the dialog closes.
    document.addEventListener('toggle', function (event) {
      var dialog = event.target;
      if (!dialog || dialog.tagName !== 'DIALOG') return;
      if (dialog.open) {
        dialog.appendChild(wrap);
        wrap.classList.add('is-top-layer');
      } else if (wrap.parentElement !== document.body) {
        document.body.appendChild(wrap);
        wrap.classList.remove('is-top-layer');
      }
    }, true);

    var ring = wrap.querySelector('.site-cursor__ring');
    var dot = wrap.querySelector('.site-cursor__dot');
    var label = wrap.querySelector('.site-cursor__label');
    var canvas = wrap.querySelector('.site-cursor__trail');
    var context = canvas.getContext('2d');
    var targetX = window.innerWidth / 2;
    var targetY = window.innerHeight / 2;
    var ringX = targetX;
    var ringY = targetY;
    var dotX = targetX;
    var dotY = targetY;
    var active = false;
    var pressed = false;
    var particles = [];
    var frame = 0;
    var running = false;

    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    size();
    window.addEventListener('resize', size, { passive: true });

    function draw() {
      frame++;
      ringX += (targetX - ringX) * 0.16;
      ringY += (targetY - ringY) * 0.16;
      dotX += (targetX - dotX) * 0.72;
      dotY += (targetY - dotY) * 0.72;
      ring.style.transform = 'translate3d(' + ringX + 'px,' + ringY + 'px,0) translate(-50%,-50%)';
      dot.style.transform = 'translate3d(' + dotX + 'px,' + dotY + 'px,0) translate(-50%,-50%) rotate(' + (frame * 0.35) + 'deg)';

      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      var tint = getComputedStyle(root).getPropertyValue('--brand-tint').trim() || '#9D90FF';
      context.fillStyle = tint;
      context.font = '11px "JetBrains Mono", monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life -= 0.035;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        context.globalAlpha = p.life * 0.55;
        context.fillText(p.char, p.x, p.y);
      }
      context.globalAlpha = 1;

      if (particles.length || active) {
        requestAnimationFrame(draw);
      } else {
        running = false;
      }
    }

    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(draw);
    }

    function spawnBurst(x, y, count) {
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2;
        var speed = 0.8 + Math.random() * 3.4;
        particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.6 + Math.random() * 0.5,
          char: ['.', '+', '*', '\u00b7'][Math.floor(Math.random() * 4)]
        });
      }
    }

    // Move particles in the same loop as the ring for a soft "packet trace".
    var originalDraw = draw;
    draw = function () {
      for (var i = 0; i < particles.length; i++) {
        particles[i].x += particles[i].vx;
        particles[i].y += particles[i].vy;
        particles[i].vx *= 0.96;
        particles[i].vy *= 0.96;
      }
      originalDraw();
    };

    document.addEventListener('pointermove', function (event) {
      targetX = event.clientX;
      targetY = event.clientY;
      if (!active) {
        active = true;
        ringX = targetX;
        ringY = targetY;
        dotX = targetX;
        dotY = targetY;
        wrap.classList.add('is-visible');
        // Only hide the native cursor once the custom one is actually on
        // screen, so there is never a cursor-less first frame.
        root.classList.add('has-site-cursor');
      }
      if (frame % 2 === 0) {
        particles.push({
          x: event.clientX + (Math.random() - 0.5) * 8,
          y: event.clientY + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.25 + Math.random() * 0.6,
          life: 0.5 + Math.random() * 0.4,
          char: Math.random() > 0.7 ? '+' : '.'
        });
        if (particles.length > 60) particles.shift();
      }
      start();
    }, { passive: true });

    document.addEventListener('pointerover', function (event) {
      var interactive = event.target.closest('a, button, input, textarea, select, label, [role="button"], [data-console-open], .gallery__thumb, [data-mesh-stage], .lightbox');
      wrap.classList.toggle('is-active', Boolean(interactive));
      if (!interactive) {
        label.textContent = '';
        return;
      }
      var text = 'open';
      if (interactive.matches('input, textarea, select')) text = 'type';
      else if (interactive.matches('.gallery__thumb')) text = 'zoom';
      else if (interactive.matches('[data-console-open]')) text = 'shell';
      else if (interactive.matches('[data-mesh-stage]')) text = 'scan';
      else if (interactive.matches('button, .filter, .room__arrow, [role="button"]')) text = 'run';
      else if (interactive.matches('.lightbox')) text = 'view';
      else if (interactive.matches('a') && /github|whatsapp|tryhackme/i.test(interactive.href || '')) text = 'visit';
      label.textContent = text;
    });

    document.addEventListener('pointerdown', function (event) {
      pressed = true;
      wrap.classList.add('is-pressed');
      spawnBurst(event.clientX, event.clientY, 9);
      start();
    });
    document.addEventListener('pointerup', function () {
      pressed = false;
      wrap.classList.remove('is-pressed');
    });

    document.addEventListener('pointerleave', function () {
      active = false;
      wrap.classList.remove('is-visible');
    });

    window.addEventListener('blur', function () {
      active = false;
      wrap.classList.remove('is-visible');
    });

    // Touch or keyboard users should never inherit the hidden native cursor.
    document.addEventListener('touchstart', function () { root.classList.remove('has-site-cursor'); }, { once: true });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') root.classList.remove('has-site-cursor');
    }, { once: true });
  }


  /* ==========================================================================
     5. The live intrusion mesh
     The homepage hero animation lives in js/hero-mesh.js so it only loads
     on the page that uses it. This file keeps the shared experience layer.
     ========================================================================== */

  /* ==========================================================================
     6. Live visitor count (Supabase Realtime presence, native WebSocket)
     No library, no table, no cookies. If Realtime is unavailable the item
     simply stays hidden.
     ========================================================================== */

  function initPresence() {
    var statusbar = document.querySelector('.statusbar');
    if (!statusbar || !config.supabaseUrl || !config.supabaseKey || !window.WebSocket) return;

    var host;
    try { host = new URL(config.supabaseUrl).host; } catch (error) { return; }

    var item = document.createElement('span');
    item.className = 'statusbar__item statusbar__visitors';
    item.hidden = true;
    item.title = 'People on malwarous.dev right now';
    item.innerHTML = '<span class="statusbar__pulse" aria-hidden="true"></span><span id="visitor-count">--</span><span class="statusbar__visitors-label"> online</span>';
    var spacer = statusbar.querySelector('.statusbar__spacer');
    statusbar.insertBefore(item, spacer || null);

    var countEl = item.querySelector('#visitor-count');
    var socket = null;
    var attempts = 0;
    var ref = 0;
    var joined = false;
    var tracked = false;
    var state = {};
    var heartbeat = null;
    var retry = null;
    var closedByUs = false;

    function setCount(count) {
      if (!count || count < 1) { item.hidden = true; return; }
      item.hidden = false;
      countEl.textContent = String(count);
    }

    function countState() {
      var total = 0;
      Object.keys(state).forEach(function (key) {
        var entry = state[key];
        total += entry && entry.metas ? entry.metas.length : 1;
      });
      return total;
    }

    function send(event, payload, topic) {
      if (!socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({
        topic: topic || 'realtime:malwarous-online',
        event: event,
        payload: payload || {},
        ref: String(++ref)
      }));
    }

    function connect() {
      if (attempts > 3) return;
      closedByUs = false;
      var url = 'wss://' + host + '/realtime/v1/websocket?apikey=' + encodeURIComponent(config.supabaseKey) + '&vsn=1.0.0';
      try { socket = new WebSocket(url); } catch (error) { scheduleRetry(); return; }

      socket.onopen = function () {
        attempts = 0;
        send('phx_join', {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
            postgres_changes: []
          },
          access_token: config.supabaseKey
        });
      };

      socket.onmessage = function (event) {
        var message;
        try { message = JSON.parse(event.data); } catch (error) { return; }

        if (message.event === 'phx_reply' && message.payload && message.payload.status === 'ok') {
          if (!joined) {
            joined = true;
            send('presence', { type: 'presence', event: 'track', payload: { online_at: new Date().toISOString(), page: location.pathname } });
          }
        }

        if (message.event === 'presence_state') {
          state = message.payload || {};
          setCount(countState());
        }

        if (message.event === 'presence_diff') {
          var payload = message.payload || {};
          if (payload.joins) Object.keys(payload.joins).forEach(function (key) { state[key] = payload.joins[key]; });
          if (payload.leaves) Object.keys(payload.leaves).forEach(function (key) { delete state[key]; });
          setCount(countState());
        }

        if (message.event === 'system' && message.payload && message.payload.status === 'error') {
          // Rate limits / auth errors: stop quietly instead of breaking the page.
          close();
        }
      };

      socket.onerror = function () { /* onclose handles the retry */ };

      socket.onclose = function () {
        joined = false;
        if (closedByUs) return;
        scheduleRetry();
      };
    }

    function scheduleRetry() {
      setCount(0);
      if (retry) return;
      if (attempts >= 3) return;
      var delay = [1500, 4000, 9000][attempts] || 9000;
      attempts++;
      retry = setTimeout(function () { retry = null; connect(); }, delay);
    }

    function close() {
      closedByUs = true;
      if (socket) {
        try {
          if (joined) send('presence', { type: 'presence', event: 'untrack', payload: {} });
          socket.close();
        } catch (error) { /* already closed */ }
      }
      socket = null;
      joined = false;
    }

    heartbeat = setInterval(function () {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
      }
    }, 30000);

    window.addEventListener('pagehide', function () {
      clearInterval(heartbeat);
      close();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !socket) connect();
    });

    connect();
  }


  /* ==========================================================================
     7. Small extras: clipboard, toast, coming-soon links, Konami
     ========================================================================== */

  // Links whose real destination is not public yet still respond instead of
  // jumping to the top of the page. The message comes from the data attribute.
  function initComingSoon() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('[data-coming-soon]');
      if (!link) return;
      event.preventDefault();
      toast(link.getAttribute('data-coming-soon') || 'that link is coming soon.');
    });
  }

  function copyText(text) {
    function done() { toast('copied to clipboard.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { toast('copy failed. the address is in the bar above.'); });
    } else {
      toast('copy is not available in this browser.');
    }
  }

  function toast(message) {
    var box = document.querySelector('.toast');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.classList.remove('is-visible');
    void box.offsetWidth;
    box.classList.add('is-visible');
    clearTimeout(box._timer);
    box._timer = setTimeout(function () { box.classList.remove('is-visible'); }, 2600);
  }

  function initKonami() {
    if (reducedMotion) return;
    var sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var position = 0;
    var used = false;

    document.addEventListener('keydown', function (event) {
      if (used) return;
      if (isTyping(event.target)) return;
      if (event.key === sequence[position]) {
        position++;
        if (position === sequence.length) {
          used = true;
          starRain();
          toast('konami unlocked. now go break something - with permission.');
        }
      } else {
        position = event.key === sequence[0] ? 1 : 0;
      }
    });
  }

  function starRain() {
    var layer = document.createElement('div');
    layer.className = 'star-rain';
    layer.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 48; i++) {
      var star = document.createElement('i');
      star.style.left = Math.random() * 100 + '%';
      star.style.animationDelay = Math.random() * 0.9 + 's';
      star.style.animationDuration = 2.2 + Math.random() * 2 + 's';
      star.style.fontSize = 8 + Math.random() * 16 + 'px';
      star.textContent = Math.random() > 0.5 ? '\u2726' : '+';
      layer.appendChild(star);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 5200);
  }

  function isTyping(target) {
    return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  // Expose a tiny, stable API for main.js and future features.
  window.MalwarousUI = { toast: toast, theme: currentTheme, setTheme: function (theme) { switchTheme(theme, document.querySelector('[data-theme-toggle]')); } };
})();
