/* FitLife backend (runs in the browser, saves to localStorage).
   All app logic lives here so the UI never touches storage directly.
   To move to a real server later, keep this public API and swap the internals. */
(function () {
  'use strict';

  const FL = window.FitLife;
  const D = FL.data;
  const U = FL.util;
  const { dayKey, parseKey, addDays, uid } = U;

  const DB_KEY = 'fitlife:v1';
  const SESSION_KEY = 'fitlife:session';

  /* ---------- storage (never throws; falls back to memory if the browser blocks it) ---------- */
  const memory = {};
  const ls = {
    get(k) {
      try { return localStorage.getItem(k); } catch (e) { return memory[k] == null ? null : memory[k]; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); delete memory[k]; return true; } catch (e) { memory[k] = v; return false; }
    },
    del(k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
      delete memory[k];
    },
  };

  let onSaveError = function () {};
  const changeListeners = [];

  const blankData = () => ({ sessions: [], meals: [], water: {}, badges: {}, planId: null, reminder: { on: false, every: 60 } });

  /* The one admin account. Only a salted hash is kept here, never the password itself.
     Note: this file ships to the browser, so anyone can read the hash. Real protection
     needs a server; treat this as a browser-only gate. */
  const ADMIN_EMAIL = 'hallosaini3@gmail.com';
  const ADMIN_SEED = {
    salt: 'fl-admin-seed-v1',
    hash: 'e7ae6e256b68eaf8852d8a12bf24fc3bed5e0e7149e1e2372f102d6dd27a3717',
    hashAlt: 'x4c18b275', // same password hashed by the fallback used on non-secure origins
  };

  // Keep exactly one admin (the seeded email) and make sure it always exists.
  function normalize(d) {
    let changed = false;
    if (!d.videos || typeof d.videos !== 'object') { d.videos = {}; changed = true; }
      if (!d.exerciseImages || typeof d.exerciseImages !== 'object') { d.exerciseImages = {}; changed = true; }
    let admin = d.users.find((u) => u.email === ADMIN_EMAIL);
    if (!admin) {
      admin = { id: 'u-admin', name: 'Team Break Admin', email: ADMIN_EMAIL, occupation: 'other', goal: 'stay-active', level: 'beginner', activity: 'light', diet: 'any', age: null, sex: '', heightCm: null, weightKg: null, createdAt: new Date().toISOString() };
      d.users.unshift(admin);
      changed = true;
    }
    if (admin.role !== 'admin' || admin.hash !== ADMIN_SEED.hash) {
      admin.role = 'admin';
      admin.salt = ADMIN_SEED.salt;
      admin.hash = ADMIN_SEED.hash;
      admin.hashAlt = ADMIN_SEED.hashAlt;
      changed = true;
    }
    d.users.forEach((u) => { if (u !== admin && u.role !== 'member') { u.role = 'member'; changed = true; } });
    if (!d.data[admin.id]) { d.data[admin.id] = blankData(); changed = true; }
    return changed;
  }

    const emptyDb = () => ({ v: 1, users: [], data: {}, custom: [], videos: {}, exerciseImages: {} });
  function fresh() {
    const d = emptyDb();
    normalize(d);
    return d;
  }
  let dirty = false;
  function load() {
    try {
      const raw = ls.get(DB_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.users)) {
          const d = Object.assign(emptyDb(), p);
          if (normalize(d)) dirty = true;
          return d;
        }
      }
    } catch (e) { /* corrupted data: start clean instead of crashing the app */ }
    dirty = true;
    return fresh();
  }
  let db = load();

  function persist() {
    const ok = ls.set(DB_KEY, JSON.stringify(db));
    if (!ok) onSaveError();
    return ok;
  }

  if (dirty) { persist(); dirty = false; }

  // Another tab changed the data: reload and tell the UI.
  window.addEventListener('storage', (e) => {
    if (e.key === DB_KEY || e.key === SESSION_KEY || e.key === null) {
      db = load();
      changeListeners.forEach((fn) => fn());
    }
  });

  /* ---------- users and auth ---------- */
  async function hashPw(pw, salt) {
    const text = salt + ':' + pw;
    if (window.crypto && window.crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for non-secure origins (no crypto.subtle). Much weaker: fine for local use only.
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return 'x' + h.toString(16);
  }

  function getData(userId) {
    let d = db.data[userId];
    if (!d) d = db.data[userId] = blankData();
    const b = blankData();
    Object.keys(b).forEach((k) => { if (d[k] == null) d[k] = b[k]; });
    return d;
  }

  const publicUser = (u) => {
    if (!u) return null;
    const c = Object.assign({}, u);
    delete c.hash;
    delete c.salt;
    delete c.hashAlt;
    c.role = u.email === ADMIN_EMAIL ? 'admin' : 'member'; // derived from the account, never trusted from storage
    return c;
  };

  function currentUser() {
    const id = ls.get(SESSION_KEY);
    if (!id) return null;
    const u = db.users.find((x) => x.id === id);
    if (!u) { ls.del(SESSION_KEY); return null; }
    return publicUser(u);
  }

  async function signup(input) {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (name.length < 2) throw new Error('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (password.length < 6) throw new Error('Choose a password with at least 6 characters.');
    if (db.users.some((u) => u.email === email)) throw new Error('An account with this email already exists. Log in instead.');

    const salt = uid();
    const hash = await hashPw(password, salt);
    if (db.users.some((u) => u.email === email)) throw new Error('An account with this email already exists. Log in instead.');

    const occupation = D.OCCUPATIONS.some((o) => o.id === input.occupation) ? input.occupation : 'other';
    const user = {
      id: uid(), name, email, salt, hash, occupation,
      goal: 'stay-active', level: 'beginner', activity: 'light', diet: 'any', weeklyGoal: D.WEEKLY_GOAL_MIN,
      age: null, sex: '', heightCm: null, weightKg: null,
      role: 'member', // the admin is the seeded account; nobody can sign up as admin
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    db.data[user.id] = blankData();
    persist();
    ls.set(SESSION_KEY, user.id);
    return publicUser(user);
  }

  // Slows down password guessing through the UI: 5 wrong tries in a minute pauses that email for 30 seconds.
  // (Client-side only, so it stops casual guessing, not a determined attacker. A server is needed for real protection.)
  const attempts = {};
  function throttle(email) {
    const a = attempts[email];
    if (a && a.until && a.until > Date.now()) {
      throw new Error('Too many attempts. Try again in ' + Math.ceil((a.until - Date.now()) / 1000) + ' seconds.');
    }
  }
  function failed(email) {
    const now = Date.now();
    const a = attempts[email] || (attempts[email] = { times: [], until: 0 });
    a.times = a.times.filter((t) => now - t < 60000).concat(now);
    if (a.times.length >= 5) { a.until = now + 30000; a.times = []; }
  }

  // One login for everyone: the account itself decides admin vs member, so there is
  // nothing for the person to pick beforehand and nothing that can be picked wrong.
  async function login(emailIn, password) {
    const email = String(emailIn || '').trim().toLowerCase();
    throttle(email);
    const u = db.users.find((x) => x.email === email);
    const bad = new Error('Email or password is incorrect.');
    if (!u) { failed(email); throw bad; }
    const h = await hashPw(String(password || ''), u.salt);
    if (h !== u.hash && h !== u.hashAlt) { failed(email); throw bad; }
    delete attempts[email];
    ls.set(SESSION_KEY, u.id);
    return publicUser(u);
  }

  function logout() { ls.del(SESSION_KEY); }

  const num = (v, min, max, label) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!isFinite(n) || n < min || n > max) throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
    return Math.round(n * 10) / 10;
  };

  const int = (v, min, max, label) => {
    const n = num(v, min, max, label);
    return n == null ? null : Math.round(n);
  };

  function updateProfile(userId, p) {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw new Error('Account not found.');
    const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
    const inList = (list, v, fallback) => (list.some((x) => x.id === v) ? v : fallback);
    const next = {};
    if (has('name')) {
      next.name = String(p.name).trim().replace(/\s+/g, ' ');
      if (next.name.length < 2) throw new Error('Enter your name.');
    }
    if (has('occupation')) next.occupation = inList(D.OCCUPATIONS, p.occupation, u.occupation);
    if (has('goal')) next.goal = inList(D.GOALS, p.goal, u.goal);
    if (has('level')) next.level = inList(D.LEVELS, p.level, u.level);
    if (has('activity')) next.activity = inList(D.ACTIVITY, p.activity, u.activity);
    if (has('diet')) next.diet = inList(D.DIETS, p.diet, u.diet);
    if (has('sex')) next.sex = inList(D.SEX, p.sex, '');
    if (has('age')) next.age = int(p.age, 13, 100, 'Age');
    if (has('weeklyGoal')) next.weeklyGoal = int(p.weeklyGoal, 30, 1000, 'Weekly goal') || D.WEEKLY_GOAL_MIN;
    if (has('heightCm')) next.heightCm = num(p.heightCm, 100, 250, 'Height');
    if (has('weightKg')) next.weightKg = num(p.weightKg, 30, 300, 'Weight');
    Object.assign(u, next);
    persist();
    return publicUser(u);
  }

  /* ---------- exercises ---------- */
  const allExercises = () => D.EXERCISES.concat(db.custom);
  const findExercise = (id) => allExercises().find((e) => e.id === id) || null;

  /* ---------- sessions, stats, badges ---------- */
  function stats(userId) {
    const d = getData(userId);
    const S = d.sessions;
    const perDay = {};
    const catMin = {};
    let minutes = 0;
    let points = 0;
    S.forEach((s) => {
      perDay[s.day] = (perDay[s.day] || 0) + s.min;
      catMin[s.cat] = (catMin[s.cat] || 0) + s.min;
      minutes += s.min;
      points += s.pts;
    });

    // current streak: today counts if done, otherwise it survives until tonight
    let streak = 0;
    let cur = new Date();
    if (!perDay[dayKey(cur)]) cur = addDays(cur, -1);
    while (perDay[dayKey(cur)]) { streak++; cur = addDays(cur, -1); }

    const days = Object.keys(perDay).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    days.forEach((k) => {
      run = prev && dayKey(addDays(parseKey(prev), 1)) === k ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    });

    const now = new Date();
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const dt = addDays(now, -i);
      const key = dayKey(dt);
      week.push({ key, label: dt.toLocaleDateString('en-US', { weekday: 'narrow' }), min: perDay[key] || 0, today: i === 0 });
    }
    const weekMin = week.reduce((a, x) => a + x.min, 0);

    const todayKey = dayKey();
    const todaySessions = S.filter((s) => s.day === todayKey);

    const metrics = {
      sessions: S.length,
      deskSessions: S.filter((s) => s.cat === 'desk').length,
      yogaSessions: S.filter((s) => s.cat === 'yoga').length,
      longestStreak: longest,
      points,
      mealPlans: d.meals.length,
      hydrationDays: Object.keys(d.water).filter((k) => d.water[k] > 0).length,
    };

    return {
      minutes, sessions: S.length, points, streak, longestStreak: longest,
      level: 1 + Math.floor(points / 100), levelPct: points % 100,
      today: { min: todaySessions.reduce((a, s) => a + s.min, 0), pts: todaySessions.reduce((a, s) => a + s.pts, 0), sessions: todaySessions.length },
      week, weekMin, catMin, metrics,
    };
  }

  function badgeStates(userId) {
    const d = getData(userId);
    const m = stats(userId).metrics;
    return D.BADGES.map((b) => ({
      badge: b,
      value: Math.min(m[b.metric], b.target),
      unlocked: !!d.badges[b.id] || m[b.metric] >= b.target,
    }));
  }

  // Unlock any newly earned badges. Returns the ones unlocked just now.
  function syncBadges(userId) {
    const d = getData(userId);
    const m = stats(userId).metrics;
    const fresh = [];
    D.BADGES.forEach((b) => {
      if (!d.badges[b.id] && m[b.metric] >= b.target) {
        d.badges[b.id] = Date.now();
        fresh.push(b);
      }
    });
    if (fresh.length) persist();
    return fresh;
  }

  function recordSession(userId, exerciseId, opts) {
    const ex = findExercise(exerciseId);
    if (!ex) throw new Error('That exercise no longer exists.');
    // Never trust the caller for more than the exercise itself is worth.
    const minutes = Math.min(Math.round(Number(opts && opts.minutes)), ex.min);
    const points = Math.min(Math.round(Number(opts && opts.points)), ex.pts);
    if (!(minutes >= 1)) throw new Error('Session length is invalid.');
    if (!(points >= 0)) throw new Error('Points are invalid.');
    const d = getData(userId);
    d.sessions.push({ id: uid(), exId: ex.id, name: ex.name, cat: ex.cat, min: minutes, pts: points, partial: !!(opts && opts.partial), day: dayKey(), at: Date.now() });
    persist();
    return { newBadges: syncBadges(userId), stats: stats(userId) };
  }

  const recentSessions = (userId, n) => getData(userId).sessions.slice(-n).reverse();

  // Undo a session that was logged by mistake. Badges already earned stay earned.
  function deleteSession(userId, sessionId) {
    const d = getData(userId);
    const before = d.sessions.length;
    d.sessions = d.sessions.filter((s) => s.id !== sessionId);
    if (d.sessions.length === before) throw new Error('That session was already removed.');
    persist();
  }

  /* ---------- water ---------- */
  const getWater = (userId, key) => getData(userId).water[key || dayKey()] || 0;
  function addWater(userId, delta) {
    const d = getData(userId);
    const k = dayKey();
    const next = Math.max(0, Math.min(30, (d.water[k] || 0) + Number(delta)));
    if (next === 0) delete d.water[k]; else d.water[k] = next;
    persist();
    return { glasses: next, newBadges: syncBadges(userId) };
  }
  function waterTarget(user) {
    if (user && user.weightKg) return Math.max(6, Math.min(14, Math.round((user.weightKg * 35) / 250)));
    return 8;
  }

  /* ---------- plans and reminders ---------- */
  function setPlan(userId, planId) {
    if (planId && !D.PLANS.some((p) => p.id === planId)) throw new Error('Unknown plan.');
    getData(userId).planId = planId || null;
    persist();
  }
  function setReminder(userId, r) {
    const every = [30, 45, 60, 90, 120].includes(Number(r.every)) ? Number(r.every) : 60;
    getData(userId).reminder = { on: !!r.on, every };
    persist();
  }

  /* ---------- nutrition ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Same (diet, seed) always gives the same day, so what you see is what you save.
  function generateDayPlan(dietId, seed) {
    const max = (D.DIETS.find((x) => x.id === dietId) || D.DIETS[0]).max;
    const rnd = mulberry32(Number(seed) || 1);
    const items = D.SLOTS.map((slot) => {
      const pool = D.MEALS[slot.id].filter((m) => m.t <= max);
      const m = pool[Math.floor(rnd() * pool.length)];
      return { slot: slot.id, label: slot.label, name: m.n, kcal: m.k, g: m.g || [] };
    });
    return { items, total: items.reduce((a, i) => a + i.kcal, 0) };
  }

  // A 7-day plan built from generateDayPlan, one call per day with a decorrelated seed
  // so the week doesn't just repeat the same day. Same (diet, seed) always gives the
  // same week, so shuffling and re-shuffling is predictable and what you save is what you saw.
  function generateWeekPlan(dietId, seed) {
    const base = Number(seed) || 1;
    const days = [];
    for (let i = 0; i < 7; i++) days.push(generateDayPlan(dietId, base + i * 104729));
    return { days, total: days.reduce((a, d) => a + d.total, 0) };
  }

  // Estimates only (Mifflin-St Jeor). Returns null until the profile has what it needs.
  function nutritionTargets(user, dir) {
    if (!user || !user.age || !user.heightCm || !user.weightKg || !user.sex) return null;
    if (user.age < 18) dir = 'maintain'; // no weight-loss or weight-gain targets for under 18s
    const act = (D.ACTIVITY.find((a) => a.id === user.activity) || D.ACTIVITY[1]).f;
    const sexAdj = user.sex === 'male' ? 5 : user.sex === 'female' ? -161 : -78;
    const bmr = 10 * user.weightKg + 6.25 * user.heightCm - 5 * user.age + sexAdj;
    const mult = { lose: 0.85, maintain: 1, gain: 1.1 }[dir] || 1;
    const kcal = Math.max(1200, Math.round((bmr * act * mult) / 10) * 10);
    const protein = Math.round(user.weightKg * (dir === 'maintain' ? 1.2 : 1.6));
    const fat = Math.round((kcal * 0.27) / 9);
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, fat, carbs };
  }

  // Body mass index: weight(kg) / height(m)^2. Only needs height + weight, so it can be
  // shown even before a full calorie estimate (which also needs age, sex and activity).
  function bmi(user) {
    if (!user || !user.heightCm || !user.weightKg) return null;
    const m = user.heightCm / 100;
    const value = Math.round((user.weightKg / (m * m)) * 10) / 10;
    const category = value < 18.5 ? 'Underweight' : value < 25 ? 'Healthy range' : value < 30 ? 'Overweight' : 'Obese';
    return { value, category };
  }

  function saveMealPlan(userId, plan) {
    const d = getData(userId);
    d.meals.push({
      id: uid(), day: dayKey(), diet: plan.diet, kcal: Math.round(plan.kcal),
      items: plan.items.map((i) => ({
        day: Math.max(0, Math.min(6, Math.round(Number(i.day)) || 0)),
        slot: i.slot, label: i.label, name: i.name, kcal: Math.round(i.kcal), g: i.g || [],
      })),
    });
    if (d.meals.length > 20) d.meals = d.meals.slice(-20);
    persist();
    return syncBadges(userId);
  }
  function deleteMealPlan(userId, id) {
    const d = getData(userId);
    d.meals = d.meals.filter((m) => m.id !== id);
    persist();
  }

  /* ---------- leaderboard (real accounts on this device; the admin is not a player) ---------- */
  function leaderboard(range) {
    const me = currentUser();
    const cutoff = dayKey(addDays(new Date(), -6));
    const rows = db.users
      .filter((u) => u.email !== ADMIN_EMAIL)
      .map((u) => ({
        id: u.id,
        name: U.shortName(u.name),
        points: getData(u.id).sessions.filter((s) => range === 'all' || s.day >= cutoff).reduce((a, s) => a + s.pts, 0),
        me: !!me && me.id === u.id,
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return rows.map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  /* ---------- your data ---------- */
  function exportData(userId) {
    const u = db.users.find((x) => x.id === userId);
    return JSON.stringify({ exportedAt: new Date().toISOString(), profile: publicUser(u), data: getData(userId) }, null, 2);
  }
  // Restore progress from a file made by exportData. Everything is re-checked; nothing is trusted.
  function importData(userId, text) {
    let parsed;
    try { parsed = JSON.parse(String(text)); } catch (e) { throw new Error('That file is not a FitLife backup.'); }
    const src = parsed && parsed.data;
    if (!src || typeof src !== 'object' || !Array.isArray(src.sessions)) throw new Error('That file is not a FitLife backup.');
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const str = (v, max) => String(v == null ? '' : v).slice(0, max);
    const clean = blankData();
    src.sessions.slice(-5000).forEach((s) => {
      if (!s || !dayRe.test(s.day)) return;
      const min = Math.round(Number(s.min));
      const pts = Math.round(Number(s.pts));
      if (!(min >= 1 && min <= 600) || !(pts >= 0 && pts <= 1000)) return;
      clean.sessions.push({ id: uid(), exId: str(s.exId, 60), name: str(s.name, 80), cat: str(s.cat, 20), min, pts, partial: !!s.partial, day: s.day, at: Number(s.at) || 0 });
    });
    (Array.isArray(src.meals) ? src.meals : []).slice(-20).forEach((m) => {
      if (!m || !dayRe.test(m.day) || !Array.isArray(m.items)) return;
      clean.meals.push({
        id: uid(), day: m.day, diet: D.DIETS.some((x) => x.id === m.diet) ? m.diet : 'any', kcal: Math.max(0, Math.round(Number(m.kcal)) || 0),
        items: m.items.slice(0, 30).map((i) => ({
          day: Math.max(0, Math.min(6, Math.round(Number(i && i.day)) || 0)),
          slot: str(i && i.slot, 20), label: str(i && i.label, 20), name: str(i && i.name, 100),
          kcal: Math.max(0, Math.round(Number(i && i.kcal)) || 0),
          g: Array.isArray(i && i.g) ? i.g.filter((t) => typeof t === 'string').slice(0, 3).map((t) => str(t, 20)) : [],
        })),
      });
    });
    if (src.water && typeof src.water === 'object') {
      Object.keys(src.water).forEach((k) => {
        const n = Math.round(Number(src.water[k]));
        if (dayRe.test(k) && n > 0 && n <= 30) clean.water[k] = n;
      });
    }
    clean.planId = D.PLANS.some((p) => p.id === src.planId) ? src.planId : null;
    if (src.reminder && typeof src.reminder === 'object') {
      clean.reminder = { on: !!src.reminder.on, every: [30, 45, 60, 90, 120].includes(Number(src.reminder.every)) ? Number(src.reminder.every) : 60 };
    }
    db.data[userId] = clean;
    persist();
    syncBadges(userId);
    return { sessions: clean.sessions.length, meals: clean.meals.length };
  }

  function resetProgress(userId) {
    const old = getData(userId);
    const b = blankData();
    b.reminder = old.reminder;
    db.data[userId] = b;
    persist();
  }
  function deleteAccount(userId) {
    const target = db.users.find((u) => u.id === userId);
    if (target && target.email === ADMIN_EMAIL) throw new Error('The admin account cannot be deleted.');
    db.users = db.users.filter((u) => u.id !== userId);
    delete db.data[userId];
    if (ls.get(SESSION_KEY) === userId) ls.del(SESSION_KEY);
    persist();
  }

  /* ---------- exercise videos (links in db.videos, uploaded files in IndexedDB) ---------- */
  const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
  const EXERCISE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

  const idb = (function () {
    let opening = null;
    const open = () => opening || (opening = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('This browser cannot store video files. Use a video link instead.')); return; }
      const req = indexedDB.open('fitlife-media', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('videos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { opening = null; reject(req.error || new Error('Could not open video storage.')); };
    }));
    const run = (mode, fn) => open().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction('videos', mode);
      const r = fn(t.objectStore('videos'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
    return {
      put: (k, blob) => run('readwrite', (s) => s.put(blob, k)),
      get: (k) => run('readonly', (s) => s.get(k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      clear: () => run('readwrite', (s) => s.clear()),
    };
  })();

  function parseVideoLink(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { throw new Error('Enter the full video link, starting with https://'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Enter the full video link, starting with https://');
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/); if (m) id = m[1]; }
    }
    if (id && /^[\w-]{11}$/.test(id)) return { kind: 'youtube', url: u.href, embed: 'https://www.youtube-nocookie.com/embed/' + id };
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = u.pathname.match(/^\/(?:video\/)?(\d+)/);
      if (m) return { kind: 'vimeo', url: u.href, embed: 'https://player.vimeo.com/video/' + m[1] };
    }
    if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(u.pathname)) return { kind: 'direct', url: u.href, embed: u.href };
    throw new Error('Use a YouTube or Vimeo link, or a direct link ending in .mp4 or .webm.');
  }

  // Forget an exercise's video. Returns a promise for the file cleanup, which callers may ignore.
  function dropVideo(exId) {
    const v = db.videos[exId];
    delete db.videos[exId];
    return v && v.type === 'file' ? idb.del(v.key).catch(() => {}) : Promise.resolve();
  }
  const cleanTitle = (t) => String(t || '').trim().slice(0, 80);
  // When a video is replaced, delete the old uploaded file (if it was one) in the background.
  const dropOldFile = (old) => { if (old && old.type === 'file') idb.del(old.key).catch(() => {}); };
  const videoFor = (exId) => (db.videos[exId] ? Object.assign({}, db.videos[exId]) : null);

  async function getVideoBlob(exId) {
    const v = db.videos[exId];
    if (!v || v.type !== 'file') return null;
    return (await idb.get(v.key)) || null;
  }

  async function adminSetVideoLink(exId, url, title) {
    requireAdmin();
    if (!findExercise(exId)) throw new Error('Pick an exercise.');
    const p = parseVideoLink(url);
    const old = db.videos[exId];
    db.videos[exId] = { type: 'link', kind: p.kind, url: p.url, embed: p.embed, title: cleanTitle(title), addedAt: Date.now() };
    persist();
    dropOldFile(old);
    return videoFor(exId);
  }

  async function adminSetVideoFile(exId, file, title) {
    requireAdmin();
    if (!findExercise(exId)) throw new Error('Pick an exercise.');
    if (!file || !file.size) throw new Error('Choose a video file first.');
    if (!/^video\//.test(file.type)) throw new Error('That file is not a video. Use MP4 or WebM.');
    if (file.size > VIDEO_MAX_BYTES) throw new Error('That video is over 200 MB. Compress it or use a link instead.');
    const key = 'v-' + uid();
    // Ask the browser not to evict uploaded videos when it is short on disk space.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    try {
      await idb.put(key, file);
    } catch (e) {
      throw new Error(e && e.name === 'QuotaExceededError' ? 'Not enough browser storage left for this video.' : (e && e.message) || 'Could not save the video.');
    }
    const old = db.videos[exId];
    db.videos[exId] = { type: 'file', key, name: String(file.name || 'video').slice(0, 120), mime: file.type, size: file.size, title: cleanTitle(title), addedAt: Date.now() };
    persist();
    dropOldFile(old);
    return videoFor(exId);
  }

  function adminRemoveVideo(exId) {
    requireAdmin();
    dropVideo(exId);
    persist();
  }

  function dropExerciseImage(exId) {
    const image = db.exerciseImages[exId];
    delete db.exerciseImages[exId];
    return image ? idb.del(image.key).catch(() => {}) : Promise.resolve();
  }
  const exerciseImageFor = (exId) => (db.exerciseImages[exId] ? Object.assign({}, db.exerciseImages[exId]) : null);
  async function getExerciseImageBlob(exId) {
    const image = db.exerciseImages[exId];
    return image ? (await idb.get(image.key)) || null : null;
  }
  async function adminSetExerciseImage(exId, file) {
    requireAdmin();
    if (!findExercise(exId)) throw new Error('Pick an exercise.');
    if (!file || !file.size) throw new Error('Choose an image file first.');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF image.');
    if (file.size > EXERCISE_IMAGE_MAX_BYTES) throw new Error('That image is over 5 MB. Resize it or choose another image.');
    const key = 'i-' + uid();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* ignore */ }
    try {
      await idb.put(key, file);
    } catch (e) {
      throw new Error(e && e.name === 'QuotaExceededError' ? 'Not enough browser storage left for this image.' : (e && e.message) || 'Could not save the image.');
    }
    const old = db.exerciseImages[exId];
    db.exerciseImages[exId] = { key, name: String(file.name || 'image').slice(0, 120), mime: file.type, size: file.size, addedAt: Date.now() };
    persist();
    if (old) idb.del(old.key).catch(() => {});
    return exerciseImageFor(exId);
  }
  function adminRemoveExerciseImage(exId) {
    requireAdmin();
    dropExerciseImage(exId);
    persist();
  }

  /* ---------- admin (one seeded account) ---------- */
  function requireAdmin() {
    const u = currentUser();
    if (!u || u.role !== 'admin') throw new Error('Only the admin can do this.');
    return u;
  }
  function adminSummary() {
    requireAdmin();
    const users = db.users.map((u) => {
      const s = stats(u.id);
      return { id: u.id, name: U.displayName(u.name), email: u.email, role: u.email === ADMIN_EMAIL ? 'admin' : 'member', occupation: u.occupation, createdAt: u.createdAt, sessions: s.sessions, minutes: s.minutes, points: s.points };
    });
    return {
      users,
      totals: { users: users.length, sessions: users.reduce((a, u) => a +
        u.sessions, 0), minutes: users.reduce((a, u) => a + u.minutes, 0) },
      custom: db.custom.slice(),
    };
  }
  function adminRemoveUser(id) {
    const me = requireAdmin();
    if (id === me.id) throw new Error('You cannot remove your own account here. Use Profile instead.');
    deleteAccount(id);
  }
  function adminAddExercise(x) {
    requireAdmin();
    const name = String(x.name || '').trim();
    const steps = String(x.steps || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    const min = Math.round(Number(x.min));
    const pts = Math.round(Number(x.pts));
    if (name.length < 2 || name.length > 60) throw new Error('Name must be 2 to 60 characters.');
    if (!D.CATEGORIES.some((c) => c.id === x.cat)) throw new Error('Pick a category.');
    if (!D.LEVELS.some((l) => l.id === x.level)) throw new Error('Pick a level.');
    if (!(min >= 1 && min <= 120)) throw new Error('Minutes must be between 1 and 120.');
    if (!(pts >= 0 && pts <= 500)) throw new Error('Points must be between 0 and 500.');
    if (!steps.length) throw new Error('Add at least one step.');
    const ex = { id: 'c-' + uid(), name, cat: x.cat, level: x.level, min, pts, icon: '⭐', focus: String(x.focus || '').trim().slice(0, 80) || 'Custom exercise', steps, custom: true };
    db.custom.push(ex);
    persist();
    return ex;
  }
  function adminRemoveExercise(id) {
    requireAdmin();
    db.custom = db.custom.filter((e) => e.id !== id);
    dropVideo(id);
    dropExerciseImage(id);
    persist();
  }
  function adminResetAll() {
    requireAdmin();
    db = fresh();
    ls.del(SESSION_KEY);
    persist();
    idb.clear().catch(() => {});
  }

  FL.backend = {
    onSaveError(fn) { onSaveError = fn; },
    onExternalChange(fn) { changeListeners.push(fn); },
    signup, login, logout, currentUser, updateProfile,
    allExercises, findExercise,
    getData, stats, badgeStates, recordSession, recentSessions,
    getWater, addWater, waterTarget,
    setPlan, setReminder,
    generateDayPlan, generateWeekPlan, nutritionTargets, bmi, saveMealPlan, deleteMealPlan,
    leaderboard,
    exportData, importData, resetProgress, deleteAccount, deleteSession,
    adminSummary, adminRemoveUser, adminAddExercise, adminRemoveExercise, adminResetAll,
    videoFor, getVideoBlob, adminSetVideoLink, adminSetVideoFile, adminRemoveVideo, VIDEO_MAX_BYTES,
    exerciseImageFor, getExerciseImageBlob, adminSetExerciseImage, adminRemoveExerciseImage, EXERCISE_IMAGE_MAX_BYTES,
  };
})();
