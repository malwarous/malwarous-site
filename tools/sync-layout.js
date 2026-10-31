/* ==========================================================================
   sync-layout.js
   Copies the shared header (layout/top.html) and footer + status bar +
   console (layout/bottom.html) into every page in public/.

   Run it from the malwarous-site folder after changing anything in layout/:
       node tools/sync-layout.js

   In each page, the shared parts sit between these marker comments:
       <!-- layout:top -->     ...     <!-- /layout:top -->
       <!-- layout:bottom -->  ...     <!-- /layout:bottom -->
   Never edit between the markers by hand: the next run overwrites it.

   It also marks the current page in the nav (aria-current="page"), and on
   the homepage turns "index.html#section" links into plain "#section".
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const top = fs.readFileSync(path.join(root, 'layout', 'top.html'), 'utf8').trimEnd();
const bottom = fs.readFileSync(path.join(root, 'layout', 'bottom.html'), 'utf8').trimEnd();

// Replaces everything between <!-- layout:NAME --> and <!-- /layout:NAME -->
function fillMarker(html, name, content, file) {
  const pattern = new RegExp('(<!-- layout:' + name + ' -->)[\\s\\S]*?(<!-- /layout:' + name + ' -->)');
  if (!pattern.test(html)) {
    console.log('  ! ' + file + ': no layout:' + name + ' markers, skipped that part');
    return html;
  }
  return html.replace(pattern, function (match, open, close) {
    return open + '\n' + content + '\n  ' + close;
  });
}

// Which nav link is "this page"? academy-psp.html counts as academy.html.
function markCurrentPage(html, file) {
  const base = file.replace(/\.html$/, '');
  return html.replace(/<a href="([a-z0-9-]+)\.html">/g, function (match, linkBase) {
    const isCurrent = base === linkBase || base.startsWith(linkBase + '-');
    return isCurrent ? '<a href="' + linkBase + '.html" aria-current="page">' : match;
  });
}

let changed = 0;

fs.readdirSync(publicDir)
  .filter(function (file) { return file.endsWith('.html') && file !== '404.html'; })
  .forEach(function (file) {
    const fullPath = path.join(publicDir, file);
    const before = fs.readFileSync(fullPath, 'utf8');

    let pageTop = markCurrentPage(top, file);
    let pageBottom = bottom;

    // On the homepage, homepage sections don't need "index.html" in front
    if (file === 'index.html') {
      pageTop = pageTop.replace(/href="index\.html#/g, 'href="#').replace('href="index.html"', 'href="#top"');
      pageBottom = pageBottom.replace(/href="index\.html#/g, 'href="#');
    }

    let after = fillMarker(before, 'top', pageTop, file);
    after = fillMarker(after, 'bottom', pageBottom, file);

    // Keep the file's own line endings (on Windows, files often use CRLF)
    after = after.replace(/\r?\n/g, before.includes('\r\n') ? '\r\n' : '\n');

    if (after !== before) {
      fs.writeFileSync(fullPath, after);
      changed++;
      console.log('  updated ' + file);
    }
  });

console.log(changed ? 'done: ' + changed + ' page(s) updated.' : 'done: everything was already up to date.');
