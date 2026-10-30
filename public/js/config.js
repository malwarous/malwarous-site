/* ==========================================================================
   Malwarous — config.js
   The settings you'll actually edit. Every page loads this file first.
   Dates: YYYY-MM-DDTHH:MM:SS+05:00   (+05:00 = Pakistan time)
   ========================================================================== */

const MALWAROUS_CONFIG = {

  // ---- Next event --------------------------------------------------------
  // The homepage // 01 panel and the status bar count down to this.
  // Leave it '' when there's no date yet: everything shows "tba".
  nextEventStart: '',
  // How many hours it shows "live now" after it starts. After that: "tba".
  nextEventHours: 3,

  // ---- Current arena room (arena.html) -------------------------------------
  // A new room every 10 days: update these four lines each time.
  currentRoom: {
    number: 2,
    name: '[ROOM NAME]',
    url: '',     // the TryHackMe room link. '' = shows "link coming soon"
    opens: '',   // when the room opens, e.g. '2026-11-01T18:00:00+05:00'
    closes: ''   // usually 10 days after it opens
  },

  // ---- Supabase (accounts, posts, team applications, guestbook) -----------
  // Find both values in your Supabase dashboard: Project Settings -> API.
  // The anon / publishable key is MEANT to be public. Your data is protected
  // by the Row Level Security rules in supabase/schema.sql, not by hiding it.
  // Leave them empty and the site still works; accounts just stay switched off.
  supabaseUrl: '',   // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseKey: ''    // the anon / publishable key (never the service_role key!)

};
