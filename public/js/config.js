/* ==========================================================================
   Malwarous — config.js
   The settings you'll actually edit. Every page loads this file first.
   Dates: YYYY-MM-DDTHH:MM:SS+05:00   (+05:00 = Pakistan time)
   ========================================================================== */

const MALWAROUS_CONFIG = {

  // ---- Next event --------------------------------------------------------
  // The homepage // 01 panel and the status bar count down to this.
  // Leave it '' when there's no date yet: everything shows "tba".
  nextEventStart: '2026-11-04T10:00:00+05:00',
  // How many hours it shows "live now" after it starts. After that: "tba".
  nextEventHours: 3,
  // Optional: when it ENDS. Set this and, once it starts, the timer counts
  // down to the end instead (e.g. a room that locks for results). '' = off.
  nextEventEnd: '2026-11-08T10:00:00+05:00',  // Inbox Under Siege locks 48h after it opened

  // ---- Arena rooms (arena.html) --------------------------------------------
  // One entry per room, oldest first. The arena card opens on the room
  // that's live right now; the < > arrows move between rooms.
  // New room every 10 days: fill in the next entry, then add a new
  // "coming soon" one after it.
  rooms: [
    {
      number: 2,
      name: 'Inbox Under Siege',
      url: 'https://tryhackme.com/jr/inboxundersiege',
      opens: '2026-11-04T10:00:00+05:00',
      closes: '2026-11-06T10:00:00+05:00'
    },
    {
      number: 3,
      name: 'tba',
      url: '',     // the TryHackMe room link. '' = "link appears when the room opens"
      opens: '',   // e.g. '2026-11-14T18:00:00+05:00'
      closes: ''
    }
  ],

  // ---- Supabase (accounts, posts, team applications, guestbook) -----------
  // Find both values in your Supabase dashboard: Project Settings -> API.
  // The anon / publishable key is MEANT to be public. Your data is protected
  // by the Row Level Security rules in supabase/schema.sql, not by hiding it.
  // Leave them empty and the site still works; accounts just stay switched off.
  supabaseUrl: 'https://zdqdtnthyxkskkigqmww.supabase.co',
  supabaseKey: 'sb_publishable_q_j8vwSlc4Onm9uVCH_u9w_cbCgDpVw'    // the anon / publishable key (never the service_role key!)

};
