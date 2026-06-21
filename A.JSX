/**
 * AYMO Notebook — Home Screen + Settings Drawer
 *
 * Settings drawer slides in from the left over the sidebar.
 * Sections: Team & Workspace · Language & Region · Appearance · Account & Profile
 */
 
import { useState, useMemo, useEffect, useRef } from "react";
 
// ─── MOCK DATA ────────────────────────────────────────────────────────────────
 
const TAGS = [
  { id: "all",      label: "All Notes", count: 8 },
  { id: "research", label: "Research",  count: 3 },
  { id: "ideas",    label: "Ideas",     count: 2 },
  { id: "work",     label: "Work",      count: 2 },
  { id: "personal", label: "Personal",  count: 1 },
];
 
const INITIAL_NOTES = [
  { id: 1, title: "The Shape of Deep Work",          preview: "Cal Newport argues that the ability to focus without distraction is becoming both increasingly rare and increasingly valuable in our economy...", tag: "research", pinned: true,  date: "Mar 25, 2026", words: 342 },
  { id: 2, title: "Product Redesign Kickoff",         preview: "Agenda: align on north-star metric, review current user pain points, sketch three divergent directions before converging on a prototype brief...", tag: "work",     pinned: true,  date: "Mar 24, 2026", words: 218 },
  { id: 3, title: "Voice UI Patterns",                preview: "The best voice interfaces borrow from radio, not from chat. Brevity, cadence, and silence as punctuation are underrated design tools...",     tag: "ideas",    pinned: false, date: "Mar 23, 2026", words: 487 },
  { id: 4, title: "Reading Notes — Antifragile",      preview: "Taleb distinguishes between the fragile (breaks under stress), the robust (resists stress), and the antifragile (gains from stress)...",     tag: "research", pinned: false, date: "Mar 21, 2026", words: 601 },
  { id: 5, title: "Weekly Review — Sprint 11",        preview: "Shipped the onboarding flow. Still blocked on the analytics dashboard. Need to sync with data team before Monday stand-up...",                 tag: "work",     pinned: false, date: "Mar 20, 2026", words: 155 },
  { id: 6, title: "A Manifesto for Slow Thinking",    preview: "What if the competitive advantage of the next decade is not speed, but depth? The ability to sit with a hard problem longer than anyone else...", tag: "ideas",  pinned: false, date: "Mar 18, 2026", words: 290 },
  { id: 7, title: "Lisbon Trip — Observations",       preview: "The city is built on seven hills. Every street is a decision. The light at 6pm on the Alfama turns terracotta rooftops into burning coals...",  tag: "personal", pinned: false, date: "Mar 14, 2026", words: 412 },
  { id: 8, title: "Cognitive Load & Interface Design",preview: "Miller's Law says humans can hold 7±2 chunks in working memory. Every UI element you add pulls from that budget. Design like it's finite...",   tag: "research", pinned: false, date: "Mar 10, 2026", words: 539 },
];
 
const TEAMS     = ["Personal Workspace", "Design Team", "Engineering", "Marketing", "Product"];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "pt", label: "Português" },
];
const TIMEZONES = [
  "UTC−05:00 Eastern Time",
  "UTC−06:00 Central Time",
  "UTC−07:00 Mountain Time",
  "UTC−08:00 Pacific Time",
  "UTC+00:00 London",
  "UTC+01:00 Paris / Berlin",
  "UTC+03:00 Nairobi",
  "UTC+05:30 Mumbai",
  "UTC+08:00 Beijing / Singapore",
  "UTC+09:00 Tokyo",
];
 
// ─── STYLES ───────────────────────────────────────────────────────────────────
 
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');
 
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
 
  :root {
    --bg:           #ffffff;
    --bg-subtle:    #f5f5f5;
    --bg-card:      #ffffff;
    --border:       #e8e8e8;
    --border-strong:#1a1a1a;
    --text:         #1a1a1a;
    --text-muted:   #8a8a8a;
    --text-xmuted:  #c4c4c4;
    --accent:       #1a1a1a;
    --tag-bg:       #1a1a1a;
    --tag-text:     #ffffff;
    --pin-active:   #1a1a1a;
    --shadow:       0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
    --shadow-hover: 0 2px 8px rgba(0,0,0,0.10), 0 8px 32px rgba(0,0,0,0.07);
    --drawer-shadow:4px 0 40px rgba(0,0,0,0.12);
    --radius:       3px;
    --font-serif:   'Instrument Serif', Georgia, serif;
    --font-sans:    'DM Sans', system-ui, sans-serif;
    --transition:   0.18s cubic-bezier(0.4,0,0.2,1);
  }
 
  [data-theme="dark"] {
    --bg:           #0e0e0e;
    --bg-subtle:    #161616;
    --bg-card:      #141414;
    --border:       #262626;
    --border-strong:#e8e8e8;
    --text:         #f0f0f0;
    --text-muted:   #7a7a7a;
    --text-xmuted:  #3a3a3a;
    --accent:       #f0f0f0;
    --tag-bg:       #f0f0f0;
    --tag-text:     #0e0e0e;
    --pin-active:   #f0f0f0;
    --shadow:       0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3);
    --shadow-hover: 0 2px 8px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.4);
    --drawer-shadow:4px 0 40px rgba(0,0,0,0.6);
  }
 
  html, body, #root { height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans); font-size: 15px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    transition: background var(--transition), color var(--transition);
  }
 
  /* ── LAYOUT ── */
  .app-shell { display: flex; min-height: 100vh; position: relative; }
 
  /* ── SIDEBAR ── */
  .sidebar {
    width: 220px; min-width: 220px;
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    padding: 40px 0 32px;
    position: sticky; top: 0; height: 100vh;
    overflow-y: auto; z-index: 10;
    transition: border-color var(--transition);
  }
  .sidebar-logo { padding: 0 28px 40px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
  .logo-mark { font-family: var(--font-serif); font-size: 22px; letter-spacing: -0.5px; color: var(--text); line-height: 1; display: block; }
  .logo-sub  { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted); margin-top: 4px; display: block; font-weight: 400; }
  .sidebar-section-label { font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-xmuted); padding: 0 28px 12px; font-weight: 500; }
  .tag-list { list-style: none; flex: 1; }
  .tag-item { display: flex; align-items: center; justify-content: space-between; padding: 9px 28px; cursor: pointer; font-size: 13.5px; font-weight: 400; color: var(--text-muted); border-left: 2px solid transparent; transition: all var(--transition); user-select: none; }
  .tag-item:hover { color: var(--text); background: var(--bg-subtle); }
  .tag-item.active { color: var(--text); font-weight: 500; border-left-color: var(--accent); background: var(--bg-subtle); }
  .tag-count { font-size: 11px; color: var(--text-xmuted); font-variant-numeric: tabular-nums; }
  .tag-item.active .tag-count { color: var(--text-muted); }
 
  .sidebar-footer {
    padding: 20px 20px 0;
    border-top: 1px solid var(--border);
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
 
  .icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 6px;
    border-radius: var(--radius);
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: color var(--transition), background var(--transition), border-color var(--transition);
    font-family: var(--font-sans); font-size: 11.5px; letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .icon-btn:hover { color: var(--text); background: var(--bg-subtle); }
 
  /* Settings button — pill style, clearly visible */
  .settings-btn {
    flex: 1;
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 2px;
    justify-content: flex-start;
  }
  .settings-btn:hover { border-color: var(--accent); background: var(--bg-subtle); color: var(--text); }
 
  /* Theme toggle */
  .theme-toggle {
    border: 1px solid var(--border);
    padding: 8px 10px;
    border-radius: 2px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--text); background: none; }
 
  /* ── SETTINGS OVERLAY ── */
  .drawer-overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.22);
    opacity: 0; pointer-events: none;
    transition: opacity 0.28s cubic-bezier(0.4,0,0.2,1);
    backdrop-filter: blur(2px);
  }
  .drawer-overlay.open { opacity: 1; pointer-events: all; }
  [data-theme="dark"] .drawer-overlay { background: rgba(0,0,0,0.52); }
 
  /* ── SETTINGS DRAWER ── */
  .settings-drawer {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 380px; max-width: 92vw;
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    box-shadow: var(--drawer-shadow);
    z-index: 101;
    display: flex; flex-direction: column;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    overflow: hidden;
  }
  .settings-drawer.open { transform: translateX(0); }
 
  .drawer-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 32px 32px 22px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .drawer-title { font-family: var(--font-serif); font-size: 24px; letter-spacing: -0.5px; font-weight: 400; color: var(--text); }
  .drawer-close {
    background: none; border: 1px solid var(--border); cursor: pointer;
    color: var(--text-muted); width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .drawer-close:hover { color: var(--text); border-color: var(--accent); background: var(--bg-subtle); }
 
  /* Tabs */
  .drawer-tabs {
    display: flex; border-bottom: 1px solid var(--border);
    padding: 0 32px; gap: 0; flex-shrink: 0;
    overflow-x: auto; scrollbar-width: none;
  }
  .drawer-tabs::-webkit-scrollbar { display: none; }
  .drawer-tab {
    background: none; border: none; cursor: pointer;
    font-family: var(--font-sans); font-size: 12px; font-weight: 400;
    color: var(--text-muted); padding: 14px 0;
    margin-right: 24px; letter-spacing: 0.04em;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
    transition: all var(--transition); white-space: nowrap;
  }
  .drawer-tab:hover { color: var(--text); }
  .drawer-tab.active { color: var(--text); font-weight: 500; border-bottom-color: var(--accent); }
 
  /* Body */
  .drawer-body { flex: 1; overflow-y: auto; padding: 28px 32px; display: flex; flex-direction: column; gap: 24px; }
 
  /* Section */
  .setting-section { display: flex; flex-direction: column; gap: 20px; }
  .setting-section-title { font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-xmuted); font-weight: 500; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .setting-row { display: flex; flex-direction: column; gap: 7px; }
  .setting-label { font-size: 13px; font-weight: 500; color: var(--text); }
  .setting-hint  { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
 
  /* Controls */
  .setting-select, .setting-input {
    width: 100%; padding: 10px 12px;
    background: var(--bg-subtle); border: 1px solid var(--border);
    border-radius: var(--radius); font-family: var(--font-sans); font-size: 13.5px;
    color: var(--text); outline: none; appearance: none;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .setting-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center;
    padding-right: 36px; cursor: pointer;
  }
  .setting-select:focus, .setting-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }
  [data-theme="dark"] .setting-select:focus, [data-theme="dark"] .setting-input:focus { box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }
 
  /* Toggle */
  .toggle-row { display: flex; align-items: center; justify-content: space-between; }
  .toggle-info { flex: 1; }
  .toggle-switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; margin-left: 16px; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .toggle-track {
    position: absolute; inset: 0; cursor: pointer;
    background: var(--bg-subtle); border: 1px solid var(--border);
    border-radius: 11px; transition: background var(--transition), border-color var(--transition);
  }
  .toggle-track::after {
    content: ''; position: absolute; left: 3px; top: 3px;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--text-xmuted);
    transition: transform var(--transition), background var(--transition);
  }
  .toggle-switch input:checked + .toggle-track { background: var(--accent); border-color: var(--accent); }
  .toggle-switch input:checked + .toggle-track::after { transform: translateX(16px); background: var(--bg); }
 
  /* Team list */
  .team-list { display: flex; flex-direction: column; gap: 6px; }
  .team-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border: 1px solid var(--border);
    border-radius: var(--radius); cursor: pointer;
    transition: all var(--transition);
  }
  .team-item:hover { border-color: var(--accent); background: var(--bg-subtle); }
  .team-item.active { border-color: var(--accent); background: var(--bg-subtle); }
  .team-avatar {
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--accent); color: var(--bg-card);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; flex-shrink: 0;
  }
  .team-name { font-size: 13px; font-weight: 500; color: var(--text); }
  .team-role { font-size: 11px; color: var(--text-muted); }
  .team-check { margin-left: auto; color: var(--accent); }
 
  /* Font size picker */
  .font-size-options { display: flex; gap: 8px; }
  .font-size-btn {
    flex: 1; padding: 9px 6px; background: var(--bg-subtle);
    border: 1px solid var(--border); border-radius: var(--radius);
    font-family: var(--font-sans); font-size: 12px; color: var(--text-muted);
    cursor: pointer; text-align: center; transition: all var(--transition);
  }
  .font-size-btn:hover { border-color: var(--accent); color: var(--text); }
  .font-size-btn.active { border-color: var(--accent); background: var(--accent); color: var(--bg-card); font-weight: 500; }
 
  /* Avatar */
  .avatar-row { display: flex; align-items: center; gap: 16px; }
  .profile-avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--accent); color: var(--bg-card); display: flex; align-items: center; justify-content: center; font-family: var(--font-serif); font-size: 22px; flex-shrink: 0; }
  .avatar-upload-btn { font-size: 12px; color: var(--text-muted); background: none; border: 1px solid var(--border); padding: 7px 14px; border-radius: 2px; cursor: pointer; font-family: var(--font-sans); transition: all var(--transition); }
  .avatar-upload-btn:hover { border-color: var(--accent); color: var(--text); }
 
  /* Footer */
  .drawer-footer { padding: 18px 32px; border-top: 1px solid var(--border); flex-shrink: 0; display: flex; gap: 10px; }
  .save-btn { flex: 1; background: var(--accent); color: var(--bg-card); border: none; padding: 11px; border-radius: var(--radius); font-family: var(--font-sans); font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity var(--transition), transform var(--transition); }
  .save-btn:hover { opacity: 0.82; transform: translateY(-1px); }
  .save-btn:active { transform: translateY(0); }
  .cancel-btn { background: none; border: 1px solid var(--border); color: var(--text-muted); padding: 11px 20px; border-radius: var(--radius); font-family: var(--font-sans); font-size: 13px; cursor: pointer; transition: all var(--transition); }
  .cancel-btn:hover { border-color: var(--accent); color: var(--text); }
 
  /* ── MAIN ── */
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; max-width: 860px; margin: 0 auto; padding: 0 48px; }
  .header { display: flex; align-items: flex-end; justify-content: space-between; padding: 48px 0 36px; border-bottom: 1px solid var(--border); margin-bottom: 36px; }
  .header-title { font-family: var(--font-serif); font-size: 36px; letter-spacing: -1px; line-height: 1; color: var(--text); font-weight: 400; }
  .header-title em { font-style: italic; color: var(--text-muted); }
  .header-meta { text-align: right; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
  .header-date { font-variant-numeric: tabular-nums; }
 
  .search-wrap { position: relative; margin-bottom: 28px; }
  .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-xmuted); pointer-events: none; }
  .search-input { width: 100%; padding: 13px 16px 13px 44px; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: var(--radius); font-family: var(--font-sans); font-size: 14px; color: var(--text); outline: none; transition: border-color var(--transition), background var(--transition), box-shadow var(--transition); }
  .search-input::placeholder { color: var(--text-xmuted); }
  .search-input:focus { border-color: var(--accent); background: var(--bg-card); box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }
  [data-theme="dark"] .search-input:focus { box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }
 
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .notes-count { font-size: 12px; color: var(--text-muted); letter-spacing: 0.04em; }
  .new-note-btn { display: flex; align-items: center; gap: 8px; background: var(--accent); color: var(--bg); border: none; padding: 10px 20px; border-radius: var(--radius); font-family: var(--font-sans); font-size: 13px; font-weight: 500; letter-spacing: 0.02em; cursor: pointer; transition: opacity var(--transition), transform var(--transition); }
  .new-note-btn:hover { opacity: 0.85; transform: translateY(-1px); }
  .new-note-btn:active { transform: translateY(0); }
 
  .note-list { display: flex; flex-direction: column; gap: 1px; padding-bottom: 80px; }
  .note-card { display: flex; align-items: flex-start; gap: 20px; padding: 22px 24px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; transition: box-shadow var(--transition), border-color var(--transition), transform var(--transition); animation: cardIn 0.28s cubic-bezier(0.4,0,0.2,1) both; }
  .note-card:hover { box-shadow: var(--shadow-hover); border-color: var(--border-strong); transform: translateY(-1px); }
  .note-card.pinned { border-left: 2px solid var(--accent); }
  @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .card-pin { background: none; border: none; cursor: pointer; padding: 2px; color: var(--text-xmuted); flex-shrink: 0; margin-top: 2px; transition: color var(--transition), transform var(--transition); display: flex; align-items: center; }
  .card-pin:hover { color: var(--text-muted); transform: scale(1.15); }
  .card-pin.active { color: var(--pin-active); }
  .card-body { flex: 1; min-width: 0; }
  .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
  .card-title { font-family: var(--font-serif); font-size: 18px; font-weight: 400; letter-spacing: -0.3px; color: var(--text); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 480px; }
  .card-tag { flex-shrink: 0; background: var(--tag-bg); color: var(--tag-text); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; padding: 3px 9px; border-radius: 2px; font-weight: 500; }
  .card-preview { font-size: 13.5px; color: var(--text-muted); line-height: 1.55; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 12px; }
  .card-footer { display: flex; align-items: center; gap: 16px; }
  .card-date { font-size: 11.5px; color: var(--text-xmuted); font-variant-numeric: tabular-nums; }
  .card-words { font-size: 11.5px; color: var(--text-xmuted); }
  .card-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; opacity: 0; transition: opacity var(--transition); }
  .note-card:hover .card-actions { opacity: 1; }
  .delete-btn { background: none; border: 1px solid var(--border); cursor: pointer; padding: 5px 10px; border-radius: 2px; font-size: 11px; color: var(--text-muted); letter-spacing: 0.06em; font-family: var(--font-sans); transition: all var(--transition); }
  .delete-btn:hover { border-color: #e53e3e; color: #e53e3e; background: rgba(229,62,62,0.06); }
 
  .empty-state { text-align: center; padding: 80px 0; }
  .empty-state-icon { width: 48px; height: 48px; border: 1.5px solid var(--border); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; color: var(--text-xmuted); }
  .empty-title { font-family: var(--font-serif); font-size: 22px; font-weight: 400; color: var(--text); margin-bottom: 8px; }
  .empty-sub { font-size: 13px; color: var(--text-muted); }
 
  .section-divider { display: flex; align-items: center; gap: 12px; margin: 8px 0 16px; }
  .section-divider span { font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-xmuted); white-space: nowrap; font-weight: 500; }
  .divider-line { flex: 1; height: 1px; background: var(--border); }
 
  /* Toast */
  .toast {
    position: fixed; bottom: 32px; left: 50%;
    transform: translateX(-50%) translateY(12px);
    background: var(--accent); color: var(--bg-card);
    padding: 10px 22px; border-radius: var(--radius);
    font-size: 13px; font-weight: 500; letter-spacing: 0.02em;
    opacity: 0; pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
    z-index: 200;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
 
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
 
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { padding: 0 20px; }
    .header { padding: 32px 0 24px; }
    .header-title { font-size: 28px; }
    .card-title { max-width: 200px; }
    .settings-drawer { width: 92vw; }
  }
`;
 
// ─── ICONS ────────────────────────────────────────────────────────────────────
 
const Icons = {
  Search:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  Pin:      ({ filled }) => <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v1.5l2.5 2.5v2H6.5v-2L9 6.5V5a3 3 0 0 1 3-3z"/><line x1="12" y1="11" x2="12" y2="22"/></svg>,
  Plus:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Settings: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Moon:     () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Sun:      () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Check:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Close:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  FileText: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
};
 
// ─── TOGGLE SWITCH ────────────────────────────────────────────────────────────
 
function Toggle({ checked, onChange, id }) {
  return (
    <label className="toggle-switch" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
    </label>
  );
}
 
// ─── SETTINGS DRAWER ─────────────────────────────────────────────────────────
 
const TABS = ["Team", "Language", "Appearance", "Account"];
 
function SettingsDrawer({ open, onClose, dark, onToggleTheme }) {
  const [activeTab, setActiveTab]   = useState("Team");
  const [selectedTeam, setTeam]     = useState("Personal Workspace");
  const [language, setLanguage]     = useState("en");
  const [timezone, setTimezone]     = useState("UTC+00:00 London");
  const [dateFormat, setDateFormat] = useState("MMM D, YYYY");
  const [fontSize, setFontSize]     = useState("Default");
  const [compactMode, setCompact]   = useState(false);
  const [spellcheck, setSpell]      = useState(true);
  const [autoSave, setAutoSave]     = useState(true);
  const [name, setName]             = useState("Alex Morgan");
  const [email, setEmail]           = useState("alex@aymonotebook.com");
  const [notifs, setNotifs]         = useState(true);
  const [digest, setDigest]         = useState(false);
 
  // Close on Escape
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape" && open) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
 
  const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
 
  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
 
      <div className={`settings-drawer${open ? " open" : ""}`} role="dialog" aria-label="Settings" aria-modal="true">
 
        {/* Header */}
        <div className="drawer-head">
          <h2 className="drawer-title">Settings</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close"><Icons.Close /></button>
        </div>
 
        {/* Tabs */}
        <div className="drawer-tabs" role="tablist">
          {TABS.map((tab) => (
            <button key={tab} role="tab" aria-selected={activeTab === tab}
              className={`drawer-tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </div>
 
        {/* Body */}
        <div className="drawer-body">
 
          {/* ── TEAM ── */}
          {activeTab === "Team" && (
            <div className="setting-section">
              <p className="setting-section-title">Team & Workspace</p>
              <div className="setting-row">
                <span className="setting-label">Active Workspace</span>
                <span className="setting-hint">Notes and uploads are scoped per workspace. Switch to collaborate with a different team.</span>
              </div>
              <div className="team-list">
                {TEAMS.map((team) => (
                  <div key={team} className={`team-item${selectedTeam === team ? " active" : ""}`} onClick={() => setTeam(team)}>
                    <div className="team-avatar">{initials(team)}</div>
                    <div>
                      <div className="team-name">{team}</div>
                      <div className="team-role">{team === "Personal Workspace" ? "Owner" : "Member"}</div>
                    </div>
                    {selectedTeam === team && <span className="team-check"><Icons.Check /></span>}
                  </div>
                ))}
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Shared notes by default</div>
                    <div className="setting-hint">New notes will be visible to all workspace members.</div>
                  </div>
                  <Toggle id="shared-notes" checked={false} onChange={() => {}} />
                </div>
              </div>
            </div>
          )}
 
          {/* ── LANGUAGE ── */}
          {activeTab === "Language" && (
            <div className="setting-section">
              <p className="setting-section-title">Language & Region</p>
              <div className="setting-row">
                <label className="setting-label" htmlFor="lang-select">Interface Language</label>
                <select id="lang-select" className="setting-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>
              <div className="setting-row">
                <label className="setting-label" htmlFor="tz-select">Timezone</label>
                <select id="tz-select" className="setting-select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="setting-row">
                <label className="setting-label" htmlFor="date-select">Date Format</label>
                <select id="date-select" className="setting-select" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                  {["MMM D, YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Spell Check</div>
                    <div className="setting-hint">Highlight misspelled words while typing.</div>
                  </div>
                  <Toggle id="spellcheck" checked={spellcheck} onChange={setSpell} />
                </div>
              </div>
            </div>
          )}
 
          {/* ── APPEARANCE ── */}
          {activeTab === "Appearance" && (
            <div className="setting-section">
              <p className="setting-section-title">Appearance</p>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Dark Mode</div>
                    <div className="setting-hint">Switch between light and dark interface.</div>
                  </div>
                  <Toggle id="dark-mode-toggle" checked={dark} onChange={onToggleTheme} />
                </div>
              </div>
              <div className="setting-row">
                <span className="setting-label">Font Size</span>
                <div className="font-size-options">
                  {["Small", "Default", "Large"].map((size) => (
                    <button key={size} className={`font-size-btn${fontSize === size ? " active" : ""}`} onClick={() => setFontSize(size)}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Compact Mode</div>
                    <div className="setting-hint">Reduce spacing between note cards for a denser view.</div>
                  </div>
                  <Toggle id="compact-mode" checked={compactMode} onChange={setCompact} />
                </div>
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Auto-save</div>
                    <div className="setting-hint">Save notes automatically as you type.</div>
                  </div>
                  <Toggle id="auto-save" checked={autoSave} onChange={setAutoSave} />
                </div>
              </div>
            </div>
          )}
 
          {/* ── ACCOUNT ── */}
          {activeTab === "Account" && (
            <div className="setting-section">
              <p className="setting-section-title">Account & Profile</p>
              <div className="setting-row">
                <span className="setting-label">Profile Photo</span>
                <div className="avatar-row">
                  <div className="profile-avatar">A</div>
                  <button className="avatar-upload-btn">Change photo</button>
                </div>
              </div>
              <div className="setting-row">
                <label className="setting-label" htmlFor="profile-name">Display Name</label>
                <input id="profile-name" type="text" className="setting-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="setting-row">
                <label className="setting-label" htmlFor="profile-email">Email Address</label>
                <input id="profile-email" type="email" className="setting-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Push Notifications</div>
                    <div className="setting-hint">Get notified when someone shares a note with you.</div>
                  </div>
                  <Toggle id="notifications" checked={notifs} onChange={setNotifs} />
                </div>
              </div>
              <div className="setting-row">
                <div className="toggle-row">
                  <div className="toggle-info">
                    <div className="setting-label">Weekly Digest</div>
                    <div className="setting-hint">Receive a summary of your note activity every Monday.</div>
                  </div>
                  <Toggle id="weekly-digest" checked={digest} onChange={setDigest} />
                </div>
              </div>
            </div>
          )}
        </div>
 
        {/* Footer */}
        <div className="drawer-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button className="save-btn" onClick={onClose}>Save Changes</button>
        </div>
      </div>
    </>
  );
}
 
// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
 
function Sidebar({ tags, activeTag, onTagSelect, dark, onToggleTheme, onOpenSettings }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">AYMO</span>
        <span className="logo-sub">Notebook</span>
      </div>
      <p className="sidebar-section-label">Filter</p>
      <ul className="tag-list">
        {tags.map((tag) => (
          <li key={tag.id} className={`tag-item${activeTag === tag.id ? " active" : ""}`} onClick={() => onTagSelect(tag.id)}>
            <span>{tag.label}</span>
            <span className="tag-count">{tag.count}</span>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        {/* Settings — fully visible labeled button */}
        <button className="icon-btn settings-btn" onClick={onOpenSettings} aria-label="Open Settings">
          <Icons.Settings /> Settings
        </button>
        <button className="icon-btn theme-toggle" onClick={onToggleTheme} aria-label="Toggle theme">
          {dark ? <><Icons.Sun /> Light</> : <><Icons.Moon /> Dark</>}
        </button>
      </div>
    </aside>
  );
}
 
// ─── HEADER ───────────────────────────────────────────────────────────────────
 
function Header({ noteCount }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return (
    <header className="header">
      <h1 className="header-title">My Notes<em>.</em></h1>
      <div className="header-meta">
        <div className="header-date">{today}</div>
        <div>{noteCount} note{noteCount !== 1 ? "s" : ""}</div>
      </div>
    </header>
  );
}
 
// ─── SEARCH BAR ───────────────────────────────────────────────────────────────
 
function SearchBar({ value, onChange }) {
  return (
    <div className="search-wrap">
      <span className="search-icon"><Icons.Search /></span>
      <input type="text" className="search-input" placeholder="Search notes by title or content…" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Search notes" />
    </div>
  );
}
 
// ─── NOTE CARD ────────────────────────────────────────────────────────────────
 
function NoteCard({ note, onPin, onDelete }) {
  return (
    <article className={`note-card${note.pinned ? " pinned" : ""}`}>
      <button className={`card-pin${note.pinned ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onPin(note.id); }} title={note.pinned ? "Unpin" : "Pin"}>
        <Icons.Pin filled={note.pinned} />
      </button>
      <div className="card-body">
        <div className="card-top">
          <span className="card-title">{note.title}</span>
          <span className="card-tag">{note.tag}</span>
        </div>
        <p className="card-preview">{note.preview}</p>
        <div className="card-footer">
          <span className="card-date">{note.date}</span>
          <span className="card-words">{note.words} words</span>
          <div className="card-actions">
            <button className="delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}>Delete</button>
          </div>
        </div>
      </div>
    </article>
  );
}
 
// ─── NOTE LIST ────────────────────────────────────────────────────────────────
 
function NoteList({ notes, onPin, onDelete, searchQuery, activeTag }) {
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return notes.filter((n) => {
      const matchesTag    = activeTag === "all" || n.tag === activeTag;
      const matchesSearch = !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
      return matchesTag && matchesSearch;
    });
  }, [notes, searchQuery, activeTag]);
 
  const pinned   = filtered.filter((n) => n.pinned);
  const unpinned = filtered.filter((n) => !n.pinned);
 
  if (!filtered.length) return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icons.FileText /></div>
      <p className="empty-title">No notes found</p>
      <p className="empty-sub">Try a different search term or tag filter.</p>
    </div>
  );
 
  return (
    <div className="note-list">
      {pinned.length > 0 && (
        <>
          <div className="section-divider"><span>Pinned</span><div className="divider-line" /></div>
          {pinned.map((n) => <NoteCard key={n.id} note={n} onPin={onPin} onDelete={onDelete} />)}
        </>
      )}
      {unpinned.length > 0 && (
        <>
          {pinned.length > 0 && <div className="section-divider" style={{ marginTop: 16 }}><span>All Notes</span><div className="divider-line" /></div>}
          {unpinned.map((n) => <NoteCard key={n.id} note={n} onPin={onPin} onDelete={onDelete} />)}
        </>
      )}
    </div>
  );
}
 
// ─── ROOT APP ─────────────────────────────────────────────────────────────────
 
export default function App() {
  const [notes, setNotes]           = useState(INITIAL_NOTES);
  const [searchQuery, setSearch]    = useState("");
  const [activeTag, setActiveTag]   = useState("all");
  const [dark, setDark]             = useState(false);
  const [settingsOpen, setSettings] = useState(false);
  const [toastVisible, setToast]    = useState(false);
  const toastTimer                  = useRef(null);
 
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
 
  const handleCloseSettings = () => {
    setSettings(false);
    setToast(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 2200);
  };
 
  const tags = useMemo(() => {
    const counts = notes.reduce((acc, n) => { acc[n.tag] = (acc[n.tag] || 0) + 1; return acc; }, {});
    return TAGS.map((t) => t.id === "all" ? { ...t, count: notes.length } : { ...t, count: counts[t.id] || 0 });
  }, [notes]);
 
  const togglePin  = (id) => setNotes((prev) => prev.map((n) => n.id === id ? { ...n, pinned: !n.pinned } : n));
  const deleteNote = (id) => setNotes((prev) => prev.filter((n) => n.id !== id));
  const createNote = () => setNotes((prev) => [{
    id: Date.now(), title: "Untitled Note",
    preview: "Start writing your thoughts here…",
    tag: "ideas", pinned: false,
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    words: 0,
  }, ...prev]);
 
  const visibleCount = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return notes.filter((n) => {
      const matchesTag    = activeTag === "all" || n.tag === activeTag;
      const matchesSearch = !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
      return matchesTag && matchesSearch;
    }).length;
  }, [notes, searchQuery, activeTag]);
 
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
 
      <div className="app-shell">
        <Sidebar
          tags={tags} activeTag={activeTag} onTagSelect={setActiveTag}
          dark={dark} onToggleTheme={() => setDark((d) => !d)}
          onOpenSettings={() => setSettings(true)}
        />
        <main className="main">
          <Header noteCount={visibleCount} />
          <SearchBar value={searchQuery} onChange={setSearch} />
          <div className="toolbar">
            <span className="notes-count">
              {visibleCount} {visibleCount === 1 ? "result" : "results"}
              {activeTag !== "all" ? ` in ${activeTag}` : ""}
              {searchQuery ? ` for "${searchQuery}"` : ""}
            </span>
            <button className="new-note-btn" onClick={createNote}><Icons.Plus /> New Note</button>
          </div>
          <NoteList notes={notes} onPin={togglePin} onDelete={deleteNote} searchQuery={searchQuery} activeTag={activeTag} />
        </main>
      </div>
 
      <SettingsDrawer open={settingsOpen} onClose={handleCloseSettings} dark={dark} onToggleTheme={() => setDark((d) => !d)} />
 
      <div className={`toast${toastVisible ? " show" : ""}`} role="status" aria-live="polite">
        Settings saved ✓
      </div>
    </>
  );
}
 