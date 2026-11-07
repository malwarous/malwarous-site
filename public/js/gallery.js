/* ==========================================================================
   Malwarous — gallery.js  (only used by gallery.html)

   GALLERY_EVENTS below is the list of events, newest first. Each one has
   its photos in public/assets/gallery/<slug>/ named 01.jpg, 01-thumb.jpg,
   02.jpg, 02-thumb.jpg ...  (full size up to 1600px, thumbnail up to 640px).

   To add an event's photos:
     1. put the files in public/assets/gallery/<slug>/
     2. add one { alt: '...' } line per photo to that event's photos list
        (photo 1 = 01.jpg, photo 2 = 02.jpg, ...). The first is the cover.
   An event with an empty photos list shows "photos coming soon".

   Links: gallery.html lists every event; gallery.html?event=<slug> opens
   that event's photos. The events page links to these.
   ========================================================================== */

const GALLERY_EVENTS = [
  {
    slug: 'info-session-nov-2026',
    title: 'Information Session: Malwarous Website and Online Weekly CTFs',
    date: '4 Nov 2026',
    type: 'online',
    venue: 'CS Department Seminar Room',
    photos: []
  },
  {
    slug: 'lums-abl-info-oct-2026',
    title: 'Information Session: LUMS x ABL Hackathon',
    date: '20 Oct 2026',
    type: 'workshop',
    venue: 'QASMS Seminar Room',
    photos: []
  },
  {
    slug: 'ai-hackathon-oct-2026',
    title: 'AI Mini Project Hackathon',
    date: '14 Oct 2026',
    type: 'hackathon',
    venue: 'Electronics Department Seminar Room',
    photos: [
      { alt: "Participants at their laptops in the lecture hall, with organizers standing among them" },
      { alt: "An organizer pointing at a laptop screen, helping two participants" },
      { alt: "A speaker at the front of the room, beside the whiteboard" },
      { alt: "Rows of participants working on their laptops, with an organizer at the back" },
      { alt: "Participants focused on their laptops, two at the front laughing over a screen" },
      { alt: "Two participants discussing their project over a laptop" },
      { alt: "An organizer talking with two participants at their desk" },
      { alt: "An organizer checking a participant's work with a teammate nearby" },
      { alt: "An organizer talking with a row of participants at their laptops" },
      { alt: "A speaker explaining AI tools in front of the projected screen" },
      { alt: "An organizer talking through an idea with two participants" },
      { alt: "Two participants working through a problem on one laptop" }
    ]
  },
  {
    slug: 'ctf-sep-2026',
    title: 'Capture The Flag (CTF) Competition',
    date: '27 Sep 2026',
    type: 'ctf',
    venue: 'CS Department Seminar Room',
    photos: [
      { alt: 'Group photo of participants and organizers in front of the Malwarous CTF poster' },
      { alt: 'The seminar room during the CTF: participants at their desks, a speaker at the podium' },
      { alt: 'The speaker at the podium introducing TryHackMe' },
      { alt: 'The speaker walking everyone through getting set up on TryHackMe' },
      { alt: 'Participants working on their laptops facing the screens' },
      { alt: 'An organizer helping three participants with a challenge' },
      { alt: 'Three participants working through a challenge on one laptop' },
      { alt: 'The same team working together while others play around the room' },
      { alt: 'Participants at their laptops during the competition' }
    ]
  }
];


/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

function galleryPhotoPath(event, index, thumb) {
  return 'assets/gallery/' + event.slug + '/' + pad(index + 1) + (thumb ? '-thumb' : '') + '.jpg';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // text only, never HTML
  return node;
}


/* --------------------------------------------------------------------------
   1. All events: one row each, with a cover photo when there is one
   -------------------------------------------------------------------------- */

function renderGalleryList(list) {
  GALLERY_EVENTS.forEach(function (event) {
    const item = el('li', 'gallery-event');
    const link = el('a', 'gallery-event__link');
    link.href = 'gallery.html?event=' + event.slug;

    const cover = el('div', 'gallery-event__cover duotone');
    if (event.photos.length) {
      const img = el('img');
      img.src = galleryPhotoPath(event, 0, true);
      img.alt = '';
      img.loading = 'lazy';
      cover.appendChild(img);
    } else {
      cover.classList.add('gallery-event__cover--empty');
      cover.appendChild(el('span', '', '[ photos coming soon ]'));
    }

    const info = el('div', 'gallery-event__info');
    info.append(
      el('p', 'gallery-event__meta', event.date + ' · ' + event.type),
      el('h3', 'gallery-event__title', event.title),
      el('p', 'gallery-event__count', event.photos.length
        ? event.photos.length + ' photos -> open gallery'
        : 'photos coming soon')
    );

    link.append(cover, info);
    item.appendChild(link);
    list.appendChild(item);
  });
}


/* --------------------------------------------------------------------------
   2. One event's photos (gallery.html?event=<slug>)
   -------------------------------------------------------------------------- */

function renderGalleryEvent(event) {
  document.getElementById('gallery-event').hidden = false;
  document.getElementById('gallery-event-title').textContent = event.title;
  document.getElementById('gallery-event-meta').textContent =
    event.date + ' · ' + event.type + ' · ' + event.venue + ' · ' +
    (event.photos.length ? event.photos.length + ' photos' : 'photos coming soon');
  document.title = 'Gallery: ' + event.title + ' — Malwarous';

  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  empty.hidden = event.photos.length > 0;

  event.photos.forEach(function (photo, index) {
    const button = el('button', 'gallery__thumb duotone' +
      (photo.wide ? ' gallery__thumb--wide' : '') + (photo.tall ? ' gallery__thumb--tall' : ''));
    button.type = 'button';
    button.setAttribute('aria-label', 'Open photo ' + (index + 1) + ': ' + photo.alt);

    const img = el('img');
    img.src = galleryPhotoPath(event, index, true);
    img.alt = photo.alt;
    img.loading = index < 3 ? 'eager' : 'lazy';

    button.appendChild(img);
    button.addEventListener('click', function () { openLightbox(event, index); });
    grid.appendChild(button);
  });
}


/* --------------------------------------------------------------------------
   3. Lightbox: the full-size photo, with < > and Esc
   -------------------------------------------------------------------------- */

let lightboxEvent = null;
let lightboxIndex = 0;

function showLightboxPhoto() {
  const photo = lightboxEvent.photos[lightboxIndex];
  const img = document.getElementById('lightbox-img');
  img.src = galleryPhotoPath(lightboxEvent, lightboxIndex, false);
  img.alt = photo.alt;
  document.getElementById('lightbox-caption').textContent = photo.alt;
  document.getElementById('lightbox-count').textContent = (lightboxIndex + 1) + ' / ' + lightboxEvent.photos.length;
}

function openLightbox(event, index) {
  lightboxEvent = event;
  lightboxIndex = index;
  showLightboxPhoto();
  document.getElementById('lightbox').showModal(); // <dialog>: traps focus, Esc closes
}

function moveLightbox(step) {
  const count = lightboxEvent.photos.length;
  lightboxIndex = (lightboxIndex + step + count) % count; // wraps around
  showLightboxPhoto();
}

function initLightbox() {
  const box = document.getElementById('lightbox');
  document.getElementById('lightbox-prev').addEventListener('click', function () { moveLightbox(-1); });
  document.getElementById('lightbox-next').addEventListener('click', function () { moveLightbox(1); });
  document.getElementById('lightbox-close').addEventListener('click', function () { box.close(); });

  box.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') moveLightbox(-1);
    if (event.key === 'ArrowRight') moveLightbox(1);
  });
  // click on the dark area around the photo closes it
  box.addEventListener('click', function (event) {
    if (event.target === box) box.close();
  });
}


/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function () {
  const list = document.getElementById('gallery-list');
  if (!list) return;

  renderGalleryList(list);
  initLightbox();

  const slug = new URLSearchParams(window.location.search).get('event');
  if (!slug) {
    // No event chosen: the list is the only section, so it's // 01
    document.querySelector('#gallery-events .section__num').textContent = '// 01 —';
    return;
  }

  const event = GALLERY_EVENTS.find(function (e) { return e.slug === slug; });
  if (event) {
    renderGalleryEvent(event);
    document.getElementById('gallery-event').scrollIntoView({ block: 'start' });
  } else {
    document.getElementById('gallery-missing').hidden = false;
  }
});
