/* ==========================================================================
   Malwarous — config.js
   The settings you'll actually edit. Every page loads this file first.
   ========================================================================== */

const MALWAROUS_CONFIG = {

  // When the next event starts. Both countdowns (the // 01 panel on the
  // homepage and the status bar on every page) read this one value.
  // Format: YYYY-MM-DDTHH:MM:SS+05:00   (+05:00 = Pakistan time)
  nextEventStart: '2026-10-10T10:00:00+05:00',

  // Supabase (accounts, guestbook, flag solves).
  // Find both values in your Supabase dashboard: Project Settings -> API.
  // The anon / publishable key is MEANT to be public. Your data is protected
  // by the Row Level Security rules in supabase/schema.sql, not by hiding it.
  // Leave them empty and the site still works; accounts just stay switched off.
  supabaseUrl: '',   // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseKey: ''    // the anon / publishable key (never the service_role key!)

};
