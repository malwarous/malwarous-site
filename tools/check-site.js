/* ==========================================================================
   check-site.js — a fast, dependency-free sanity check for the static site.
       npm run check

   It catches the mistakes that are easy to miss in a plain-HTML project:
   broken local links, pages missing the experience layer, pages without the
   layout markers, and a config date that the timer cannot parse.
   Exit code 1 means CI should stop.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const problems = [];
const warnings = [];

const pages = fs.readdirSync(publicDir).filter(function (file) {
  return file.endsWith('.html');
});

const exists = function (file) {
  return fs.existsSync(path.join(publicDir, file));
};

const requiredExperience = ['css/experience.css', 'js/ui.js'];

pages.forEach(function (page) {
  const html = fs.readFileSync(path.join(publicDir, page), 'utf8');

  // Every page should use the shared layout, except the 404 page which is
  // standalone on purpose (and uses absolute paths).
  if (page !== '404.html') {
    if (!html.includes('<!-- layout:top -->') || !html.includes('<!-- layout:bottom -->')) {
      problems.push(page + ': missing layout markers (run npm run sync)');
    }
  }

  requiredExperience.forEach(function (asset) {
    if (!html.includes(asset)) problems.push(page + ': missing ' + asset);
  });

  if (!html.includes('js/config.js') || !html.includes('js/main.js')) {
    problems.push(page + ': missing config.js or main.js');
  }

  // Local links only. External links, mailto:, hashes and query strings are
  // not this script's business. Comments often contain example markup with
  // placeholder paths, so they are ignored.
  const links = html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/(?:href|src)="([^"]+)"/g);
  for (const match of links) {
    const value = match[1];
    if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(value)) continue;
    const clean = value.split('#')[0].split('?')[0];
    if (!clean || clean.endsWith('/')) continue;
    if (/^[a-z0-9-]+\.html$/i.test(clean) || /\.(css|js|svg|png|jpe?g|webp|ico)$/i.test(clean)) {
      if (!exists(clean)) problems.push(page + ': broken local link -> ' + value);
    }
  }
});

// The timer's source of truth must be a parseable date (or empty for "tba").
const config = fs.readFileSync(path.join(publicDir, 'js', 'config.js'), 'utf8');
const dateFields = ['nextEventStart', 'nextEventEnd'];
dateFields.forEach(function (field) {
  const match = config.match(new RegExp(field + ":\\s*'([^']*)'"));
  if (!match || !match[1]) return;
  if (Number.isNaN(new Date(match[1]).getTime())) {
    problems.push('js/config.js: ' + field + " is not a parseable date: '" + match[1] + "'");
  }
});

// Nice-to-know: the visible event table should follow the config, not a
// hand-typed date that will go stale.
if (!fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').includes('data-event-start="nextEventStart"')) {
  warnings.push('index.html: live event row is not linked to nextEventStart');
}

warnings.forEach(function (message) { console.log('  ! ' + message); });
problems.forEach(function (message) { console.log('  x ' + message); });

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s). Fix them before pushing.');
  process.exit(1);
}

console.log('\n  ok: ' + pages.length + ' pages checked, no broken local links.');
