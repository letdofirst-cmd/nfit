/* FitLife UI. Needs data.js and backend.js loaded first. */
(function () {
  'use strict';

  const FL = window.FitLife;
  const D = FL.data;
  const B = FL.backend;
  const U = FL.util;
  const { esc, dayKey } = U;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = (n) => Number(n || 0).toLocaleString();
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const RANK = { beginner: 0, intermediate: 1, advanced: 2 };

  const state = {
    user: null,
    route: 'home',
    lastRoute: null,
    nudge: 0,
    ui: { cat: 'all', level: 'all', q: '', lb: 'week', diet: null, dir: null, seed: 1, mealDay: 0, bmiHeight: null, bmiWeight: null },
  };

  /* ---------- small helpers ---------- */
  const labelOf = (list, id) => (list.find((x) => x.id === id) || {}).label || '';
  const catLabel = (id) => labelOf(D.CATEGORIES, id) || id;
  const todayIdx = () => (new Date().getDay() + 6) % 7; // Monday = 0
  const goalOf = (u) => u.weeklyGoal || D.WEEKLY_GOAL_MIN;
  const sumOf = (list, k) => list.reduce((a, x) => a + x[k], 0);
  const sizeLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const mmss = (s) => U.pad(Math.floor(s / 60)) + ':' + U.pad(s % 60);
  const firstName = (u) => U.displayName(u.name).split(' ')[0];
  const opts = (list, selected) =>
    list.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
  const chips = (items, current, action) =>
    '<div class="chips">' +
    items.map((i) => '<button type="button" class="chip' + (current === i.id ? ' active' : '') + '" data-action="' +
      action + '" data-value="' + esc(i.id) + '">' + esc(i.label) + '</button>').join('') +
    '</div>';

  function relDay(key) {
    if (key === dayKey()) return 'Today';
    if (key === dayKey(U.addDays(new Date(), -1))) return 'Yesterday';
    return U.parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    $('#toast-region').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
    }, ms || 3200);
  }

  const announceBadges = (badges) => badges.forEach((b) => toast('Badge unlocked: ' + b.icon + ' ' + b.name, 'gold', 4500));

  // Run an action, refresh the screen, and report success or the error message.
  function attempt(fn, okMessage) {
    try {
      fn();
      render();
      if (okMessage) toast(okMessage, 'ok');
    } catch (e) {
      toast(e.message, 'warn');
    }
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const pageHead = (title, sub, right) =>
    '<div class="page-heading"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p class="muted">' + esc(sub) +
      '</p>' : '') + '</div>' + (right || '') + '</div>';
  const metric = (label, value, unit) =>
    '<div class="card metric-card"><span class="kicker">' + esc(label) + '</span><p class="metric">' + value +
      (unit ? ' <small>' + esc(unit) + '</small>' : '') + '</p></div>';

  /* ---------- modal ---------- */
  let activeModal = null;
  function openModal(html, o) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = '<div class="modal-backdrop"><div class="modal' + (o && o.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button type="button" class="modal-close" data-close aria-label="Close">×</button>' + html + '</div></div>';
    activeModal = { onClose: o && o.onClose, prevFocus: document.activeElement };
    const m = $('.modal', root);
    m.focus();
    return m;
  }
  function closeModal() {
    if (!activeModal) return;
    const m = activeModal;
    activeModal = null;
    $('#modal-root').innerHTML = '';
    if (m.onClose) m.onClose();
    if (m.prevFocus && m.prevFocus.focus) m.prevFocus.focus();
  }

  /* ---------- recommendations ---------- */
  function recommend(u) {
    const d = B.getData(u.id);
    const rank = RANK[u.level] == null ? 0 : RANK[u.level];
    const all = B.allExercises();
    const seed = U.dayNumber();
    const pick = (cats, off) => {
      let pool = all.filter((e) => cats.includes(e.cat) && RANK[e.level] <= rank);
      if (!pool.length) pool = all.filter((e) => cats.includes(e.cat));
      if (!pool.length) pool = all;
      return pool[(seed + off) % pool.length];
    };
    const plan = D.PLANS.find((p) => p.id === d.planId);
    if (plan) {
      const day = plan.days[todayIdx()];
      const items = day.ex.map(B.findExercise).filter(Boolean);
      if (items.length) return { label: plan.name + ': ' + day.t, items, quick: items[0] };
      const gentle = pick(['stretch'], 0);
      return { label: plan.name + ': rest day, so keep it gentle', items: [gentle], quick: gentle };
    }
    const seated = D.SEATED.includes(u.occupation);
    const items = seated
      ? [pick(['desk'], 0), pick(['cardio'], 1), pick(['stretch', 'yoga'], 2)]
      : [pick(['strength'], 0), pick(['cardio'], 1), pick(['yoga', 'stretch'], 2)];
    return { label: 'Picked for your level', items, quick: seated ? items[0] : pick(['desk'], 3) };
  }

  /* ---------- shared pieces ---------- */
  const poseFigure = (ex) => D.POSES[ex.pose] || D.POSES.standing;
  // Colours the pose illustration and its card background by exercise category,
  // so each picture reads as a small themed illustration rather than a flat icon.
  const poseStyle = (ex) => {
    const c = D.CATEGORY_COLORS[ex.cat] || D.CATEGORY_COLORS.strength;
    return 'style="--pose-body:' + c.body + ';--pose-skin:' + c.skin +
      ';--pose-bg1:' + c.bg1 + ';--pose-bg2:' + c.bg2 + '"';
  };

  const exerciseImageUrls = new Map();
  const exerciseImageLoads = new Map();
  function clearExerciseImageUrl(exId) {
    const url = exerciseImageUrls.get(exId);
    if (url) URL.revokeObjectURL(url);
    exerciseImageUrls.delete(exId);
    exerciseImageLoads.delete(exId);
  }
  function mountExerciseImage(exId, url) {
    $$('[data-exercise-image]').filter((el) => el.dataset.exerciseImage === exId).forEach((el) => {
      const img = document.createElement('img');
      img.className = 'exercise-picture';
      img.alt = '';
      img.src = url;
      el.replaceChildren(img);
      el.classList.add('has-picture');
    });
  }
  function hydrateExerciseImages(root) {
    const ids = new Set($$('[data-exercise-image]', root).map((el) => el.dataset.exerciseImage));
    ids.forEach((exId) => {
      if (!B.exerciseImageFor(exId)) return;
      const url = exerciseImageUrls.get(exId);
      if (url) { mountExerciseImage(exId, url); return; }
      if (exerciseImageLoads.has(exId)) return;
      const request = B.getExerciseImageBlob(exId).then((blob) => {
        if (!blob || exerciseImageLoads.get(exId) !== request) return;
        const imageUrl = URL.createObjectURL(blob);
        exerciseImageUrls.set(exId, imageUrl);
        mountExerciseImage(exId, imageUrl);
      }).catch(() => {}).finally(() => {
        if (exerciseImageLoads.get(exId) === request) exerciseImageLoads.delete(exId);
      });
      exerciseImageLoads.set(exId, request);
    });
  }

  function exerciseCard(ex) {
    return '<article class="card ex-card">' +
      '<div class="ex-pose-thumb" aria-hidden="true" data-exercise-image="' + esc(ex.id) + '" ' + poseStyle(ex) + '>' + poseFigure(ex) + '</div>' +
      '<div class="ex-top"><span class="ex-icon" aria-hidden="true">' + esc(ex.icon) + '</span><span class="tags">' +
        (B.videoFor(ex.id) ? '<span class="tag tag-video">▶ Video</span>' : '') + '<span class="tag">' +
        esc(catLabel(ex.cat)) + '</span></span></div>' +
      '<h4>' + esc(ex.name) + '</h4><p class="muted small">' + esc(ex.focus) + '</p>' +
      '<div class="ex-meta"><span>' + ex.min + ' min</span><span>' + ex.pts + ' pts</span><span>' +
        esc(labelOf(D.LEVELS, ex.level)) + '</span></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="start-ex" data-id="' + esc(ex.id) + '">Start</button></article>';
  }

  // A group of exercises that plays back to back.
  const playAll = (ids, name, label, cls) =>
    '<button type="button" class="btn ' + (cls || 'btn-ghost') + ' btn-sm" data-action="start-list" data-ids="' +
      esc(ids.join(',')) + '" data-name="' + esc(name) + '">' + esc(label) + '</button>';

  function routineCard(r) {
    const ex = r.ex.map(B.findExercise).filter(Boolean);
    return '<article class="card routine-card"><div class="ex-top"><h4>' + esc(r.name) + '</h4><span class="tag">' +
      sumOf(ex, 'min') + ' min</span></div>' +
      '<p class="muted small">' + esc(r.blurb) + '</p>' +
      '<ol class="routine-steps">' + ex.map((e) => '<li>' + esc(e.name) + '</li>').join('') + '</ol>' +
      playAll(ex.map((e) => e.id), r.name, 'Start routine · ' + sumOf(ex, 'pts') + ' pts', 'btn-primary') + '</article>';
  }
  function routinesSection(cat) {
    const list = D.ROUTINES.filter((r) => !cat || cat === 'all' || r.cat === cat);
    if (!list.length) return '';
    return '<div class="section-title"><h3>Guided routines</h3>' +
      '<span class="muted small">Play several exercises back to back</span></div>' +
      '<div class="grid grid-3 routine-grid">' + list.map(routineCard).join('') + '</div>' +
      '<div class="section-title"><h3>All exercises</h3></div>';
  }

  function hydrationCard() {
    const u = state.user;
    const n = B.getWater(u.id);
    const target = B.waterTarget(u);
    let cups = '';
    for (let i = 0; i < Math.max(target, n); i++) cups += '<span class="cup' + (i < n ? ' on' : '') + '"></span>';
    return '<section class="card"><div class="section-title"><h3>Water today</h3><b>' + n + ' of ' + target + ' glasses</b></div>' +
      '<div class="cups" role="img" aria-label="' + n + ' of ' + target + ' glasses">' + cups + '</div>' +
      '<div class="row"><button type="button" class="btn btn-ghost btn-sm" data-action="water" data-delta="-1"' +
        (n ? '' : ' disabled') + '>Remove one</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="water" data-delta="1">Add a glass</button>' +
        '</div></section>';
  }

  /* ---------- views ---------- */
  function viewHome() {
    const u = state.user;
    const s = B.stats(u.id);
    const rec = recommend(u);
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const line = s.today.min
      ? 'You have moved for ' + s.today.min + ' minute' + (s.today.min === 1 ? '' : 's') + ' today. Keep it going.'
      : 'Nothing logged yet today. A two-minute reset counts.';
    const tip = D.TIPS[U.dayNumber() % D.TIPS.length];
    const shortcuts = [
      { route: 'dashboard', icon: '◈', name: 'Dashboard', blurb: 'Your rhythm' },
      { route: 'exercises', icon: '◉', name: 'Exercises', blurb: 'Pick a move' },
      { route: 'desk', icon: '⌁', name: 'Desk fitness', blurb: 'Quick reset' },
      { route: 'yoga', icon: '◌', name: 'Yoga', blurb: 'Stretch' },
      { route: 'plans', icon: '▦', name: 'Plans', blurb: 'Weekly flow' },
      { route: 'nutrition', icon: '◒', name: 'Nutrition', blurb: 'Fuel up' },
      { route: 'progress', icon: '↗', name: 'Progress', blurb: 'See gains' },
      { route: 'leaderboard', icon: '♜', name: 'Leaderboard', blurb: 'Keep pace' }
    ];
    const focusPills = [
      { label: 'Move', value: s.today.min + ' min', tone: 'green' },
      { label: 'Water', value: B.getWater(u.id) + '/' + B.waterTarget(u) + ' cups', tone: 'blue' },
      { label: 'Streak', value: s.streak + ' days', tone: 'amber' }
    ];
    return '<section class="home-hero">' +
      '<div><span class="hero-badge">Today</span><h2>' + greet + ', ' + esc(firstName(u)) + '.</h2><p class="lead">' + esc(line) + '</p>' +
      '<div class="hero-actions"><button type="button" class="btn btn-accent" data-action="start-ex" data-id="' +
        esc(rec.quick.id) + '">Start my reset</button>' +
      '<button type="button" class="btn btn-ghost" data-route="exercises">Browse moves</button></div></div>' +
      '<div class="streak-block"><span class="streak-num">' + s.streak + '</span><span>day streak</span></div></section>' +
      '<div class="friendly-strip">' + focusPills.slice(1).map((pill) =>
        '<div class="friendly-pill ' + pill.tone + '"><span>' + esc(pill.label) + '</span><strong>' + esc(pill.value) + '</strong></div>').join('') +
      '</div>' +
      '<div class="grid grid-3">' +
      metric('This week', fmt(s.weekMin), 'of ' + goalOf(u) + ' min') +
      metric('Level ' + s.level, fmt(s.points), 'points') +
      metric('Water today', B.getWater(u.id), 'of ' + B.waterTarget(u) + ' glasses') + '</div>' +
      '<div class="section-title"><div><h3>Quick shortcuts</h3><p class="muted small">Jump to the part of your routine you need most.</p></div></div>' +
      '<div class="shortcut-grid">' + shortcuts.map((item) =>
        '<button type="button" class="shortcut-card" data-route="' + esc(item.route) + '">' +
        '<span class="shortcut-icon" aria-hidden="true">' + esc(item.icon) + '</span>' +
        '<span class="shortcut-name">' + esc(item.name) + '</span>' +
        '<span class="shortcut-blurb">' + esc(item.blurb) + '</span>' +
        '</button>').join('') + '</div>' +
      '<div class="section-title"><div><h3>Today’s suggestion</h3>' +
        '<p class="muted small">' + esc(rec.label) + '</p></div>' +
      (rec.items.length > 1 ? playAll(rec.items.map((e) => e.id), 'Today’s suggestion', 'Start all · ' +
        sumOf(rec.items, 'min') + ' min') : '') + '</div>' +
      '<div class="grid grid-3">' + rec.items.map(exerciseCard).join('') + '</div>' +
      '<section class="card tip-card"><h4>Tip of the day</h4><p>' + esc(tip) + '</p></section>';
  }

  function viewDashboard() {
    const u = state.user;
    const d = B.getData(u.id);
    const s = B.stats(u.id);
    const goal = goalOf(u);
    const pct = Math.min(100, Math.round((s.weekMin / goal) * 100));
    const plan = D.PLANS.find((p) => p.id === d.planId);
    const recent = B.recentSessions(u.id, 6);

    let planCard;
    if (plan) {
      const day = plan.days[todayIdx()];
      planCard = '<section class="card"><div class="section-title"><h3>Today in ' + esc(plan.name) +
        '</h3></div><p class="lead-sm">' + esc(day.t) + '</p>' +
        (day.ex.length
          ? '<div class="chip-row">' +
            day.ex.map((id) => { const ex = B.findExercise(id); return ex ? '<button type="button" class="chip" data-action="start-ex" data-id="' +
            esc(id) + '">' + esc(ex.name) + '</button>' : ''; }).join('') + '</div>' +
            (day.ex.length > 1 ? '<div class="gap-top">' + playAll(day.ex, plan.name + ': ' +
            day.t, 'Start all', 'btn-primary') + '</div>' : '')
          : '<p class="muted">Rest day. Light stretching is optional.</p>') + '</section>';
    } else {
      planCard = '<section class="card"><div class="section-title"><h3>Workout plan</h3></div>' +
        '<p class="muted">Pick a weekly plan and FitLife will tell you what to do each day.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-route="plans">Choose a plan</button>' +
        '</section>';
    }

    const activity = recent.length
      ? '<ul class="activity-list">' + recent.map((r) => '<li><span class="ex-dot cat-' + esc(r.cat) +
        '"></span><div><b>' + esc(r.name) + '</b><small>' + esc(relDay(r.day)) + (r.partial ? ' · partial' : '') +
        '</small></div><span>' + r.min + ' min · +' + r.pts + '</span></li>').join('') + '</ul>'
      : '<p class="muted">No sessions yet. Your activity will show up here.</p>';

    return pageHead('Dashboard', 'Your day and week at a glance.') +
      '<div class="grid grid-4">' + metric('Today', s.today.min, 'min') + metric('Points today', s.today.pts) +
        metric('Current streak', s.streak, 'days') + metric('Level', s.level) + '</div>' +
      '<div class="grid grid-2 gap-top">' +
      '<section class="card goal-card"><div class="ring" style="--p:' + pct + '"><strong>' + s.weekMin +
        '</strong><small>of ' + goal + ' min</small></div>' +
      '<div><h3>Weekly goal</h3><p class="muted">' +
        (s.weekMin >= goal ? 'Goal reached. Nice work.' : (goal - s.weekMin) + ' minutes to go this week.') + ' Counts the last 7 days. Adults are advised to aim for about 150 minutes a week; you can change your goal in Profile.</p>' +
      '<div class="level-bar" title="Progress to level ' + (s.level + 1) + '"><i style="width:' + s.levelPct +
        '%"></i></div><small class="muted">' + (100 - s.levelPct) + ' points to level ' + (s.level + 1) + '</small></div></section>' +
      hydrationCard() + '</div>' +
      bodyMetricsCard(u) +
      '<div class="grid grid-2 gap-top">' + planCard +
        '<section class="card"><div class="section-title"><h3>Recent activity</h3>' +
          '</div>' + activity + '</section></div>';
  }

  // BMI + calorie snapshot for the dashboard. Only shown once height/weight (and, for
  // calories, age + sex + activity) are on the profile — a fresh login prompts for these.
  function bodyMetricsCard(u) {
    const bmiInfo = B.bmi(u);
    const targets = B.nutritionTargets(u, defaultDir(u));
    if (!bmiInfo && !targets) return '';
    return '<div class="grid grid-2 gap-top">' +
      '<section class="card"><div class="section-title"><h3>BMI</h3></div>' +
        (bmiInfo ? bmiMeterHtml(u.heightCm, u.weightKg) : '<p class="muted">Add your height and weight in Profile to see your BMI.</p>') +
      '</section>' +
      '<section class="card"><div class="section-title"><h3>Daily calories</h3></div>' +
        (targets ? calorieMeterHtml(targets) : '<p class="muted">Add your age, sex, height and weight in Profile to see a calorie estimate.</p>') +
      '</section></div>';
  }

  function fixedCat() { return state.route === 'desk' || state.route === 'yoga' ? state.route : null; }
  function filteredExercises() {
    const q = state.ui.q.trim().toLowerCase();
    const cat = fixedCat() || state.ui.cat;
    return B.allExercises().filter((e) =>
      (cat === 'all' || e.cat === cat) &&
      (state.ui.level === 'all' || e.level === state.ui.level) &&
      (!q || (e.name + ' ' + e.focus).toLowerCase().includes(q)));
  }
  const exGrid = (list) => list.length
    ? list.map(exerciseCard).join('')
    : '<div class="card empty"><p>No exercises match those filters.</p></div>';

  function viewLibrary() {
    const fc = fixedCat();
    const meta = {
      all: ['Exercises', 'Pick one, start the timer, and log it when you finish.'],
      desk: ['Desk fitness', 'Two-to-five-minute resets you can do without leaving your chair.'],
      yoga: ['Yoga', 'Slow flows and breathing to loosen up and settle down.'],
    }[fc || 'all'];
    const list = filteredExercises();
    return pageHead(meta[0], meta[1]) + routinesSection(fc || state.ui.cat) +
      '<div class="filters">' +
      (fc ? '' : '<div class="filter-group"><span class="filter-label">Type</span>' +
        chips([{ id: 'all', label: 'All' }].concat(D.CATEGORIES), state.ui.cat, 'filter-cat') + '</div>') +
      '<div class="filter-group"><span class="filter-label">Level</span>' +
        chips([{ id: 'all', label: 'Any' }].concat(D.LEVELS), state.ui.level, 'filter-level') + '</div>' +
      '<label class="search"><span class="sr-only">Search exercises</span>' +
        '<input id="ex-search" type="search" placeholder="Search exercises" value="' +
        esc(state.ui.q) + '" autocomplete="off"></label></div>' +
      '<p class="muted small" id="ex-count">' + list.length + ' exercise' + (list.length === 1 ? '' : 's') + '</p>' +
      '<div class="grid grid-3" id="ex-grid">' + exGrid(list) + '</div>';
  }

  function viewPlans() {
    const u = state.user;
    const d = B.getData(u.id);
    const active = D.PLANS.find((p) => p.id === d.planId);
    const ti = todayIdx();
    const doneToday = new Set(d.sessions.filter((s) => s.day === dayKey()).map((s) => s.exId));

    const activeHTML = active
      ? '<section class="card plan-active"><div class="section-title"><div><h3>' + esc(active.name) + '</h3><p class="muted">Your current plan. The week repeats.</p></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="plan-stop">Stop plan</button></div>' +
        '<div class="week-grid">' + active.days.map((day, i) =>
          '<div class="day-cell' + (i === ti ? ' today' : '') + '"><b>' + DAYS[i] + '</b><span>' + esc(day.t) + '</span>' +
          (day.ex.length
            ? '<div class="chip-row">' + day.ex.map((id) => {
                const ex = B.findExercise(id);
                if (!ex) return '';
                const done = i === ti && doneToday.has(id);
                return '<button type="button" class="chip chip-sm' + (done ? ' done' : '') +
                  '" data-action="start-ex" data-id="' + esc(id) + '">' + (done ? '✓ ' : '') + esc(ex.name) + '</button>';
              }).join('') + '</div>' + (day.ex.length > 1 ? playAll(day.ex, active.name + ': ' + day.t, 'Play all', 'btn-ghost') : '')
            : '<em class="muted">Rest and recover</em>') + '</div>').join('') + '</div></section>'
      : '';

    const cards = D.PLANS.map((p) => {
      const days = p.days.filter((x) => x.ex.length).length;
      const isActive = active && active.id === p.id;
      return '<article class="card plan-card"><div class="ex-top"><h4>' + esc(p.name) + '</h4><span class="tag">' +
        esc(labelOf(D.LEVELS, p.level)) + '</span></div>' +
        '<p class="muted">' + esc(p.blurb) + '</p><p class="small">' + days + ' active days a week</p>' +
        '<button type="button" class="btn ' + (isActive ? 'btn-ghost' : 'btn-primary') +
          ' btn-sm" data-action="plan-set" data-id="' + esc(p.id) + '"' + (isActive ? ' disabled' : '') + '>' +
          (isActive ? 'Current plan' : 'Use this plan') + '</button></article>';
    }).join('');

    return pageHead('Workout plans', 'Choose a weekly rhythm. You can switch any time.') + activeHTML +
      '<div class="section-title"><h3>' + (active ? 'Other plans' : 'All plans') +
        '</h3></div><div class="grid grid-2">' + cards + '</div>';
  }

  function defaultDir(u) {
    return u.goal === 'lose-weight' ? 'lose' : u.goal === 'build-strength' ? 'gain' : 'maintain';
  }
  function mealDraft() {
    const u = state.user;
    const diet = state.ui.diet || u.diet || 'any';
    const dir = u.age && u.age < 18 ? 'maintain' : state.ui.dir || defaultDir(u);
    const week = B.generateWeekPlan(diet, state.ui.seed);
    const targets = B.nutritionTargets(u, dir);
    const avgDayTotal = week.total / week.days.length;
    const mult = targets ? Math.min(1.5, Math.max(0.7, Math.round((targets.kcal / avgDayTotal) * 20) / 20)) : 1;
    const days = week.days.map((day) => {
      const items = day.items.map((i) => Object.assign({}, i, { kcal: Math.round(i.kcal * mult) }));
      return { items, total: items.reduce((a, i) => a + i.kcal, 0) };
    });
    return { diet, dir, targets, mult, days, total: days.reduce((a, day) => a + day.total, 0) };
  }

  // Visual BMI gauge: WHO bands (underweight / healthy / overweight / obese) laid out
  // on a 15-40 scale, with a pointer at the person's own value.
  function bmiMeterHtml(heightCm, weightKg) {
    const info = B.bmi({ heightCm: Number(heightCm), weightKg: Number(weightKg) });
    if (!info) return '<p class="muted small">Enter your height and weight to see your BMI.</p>';
    const MIN = 15, MAX = 40;
    const pct = Math.max(0, Math.min(100, ((info.value - MIN) / (MAX - MIN)) * 100));
    return '<div class="meter bmi-meter">' +
      '<div class="meter-readout"><strong>' + info.value + '</strong><span class="tag tag-guide">' + esc(info.category) + '</span></div>' +
      '<div class="meter-track">' +
        '<span class="meter-zone meter-zone-under" style="width:14%"></span>' +
        '<span class="meter-zone meter-zone-healthy" style="width:26%"></span>' +
        '<span class="meter-zone meter-zone-over" style="width:20%"></span>' +
        '<span class="meter-zone meter-zone-obese" style="width:40%"></span>' +
        '<span class="meter-pointer" style="left:' + pct + '%"></span>' +
      '</div>' +
      '<div class="meter-scale"><span>Underweight</span><span>Healthy</span><span>Overweight</span><span>Obese</span></div>' +
    '</div>';
  }

  // Visual calorie gauge: shows the day's kcal estimate against a rough 1200-3200 range
  // so it reads at a glance rather than as a bare number.
  function calorieMeterHtml(targets) {
    if (!targets) return '';
    const MIN = 1200, MAX = 3200;
    const pct = Math.max(0, Math.min(100, ((targets.kcal - MIN) / (MAX - MIN)) * 100));
    return '<div class="meter calorie-meter">' +
      '<div class="meter-readout"><strong>' + fmt(targets.kcal) + '</strong><small>kcal / day</small></div>' +
      '<div class="meter-track"><span class="meter-pointer" style="left:' + pct + '%"></span></div>' +
      '<div class="meter-scale"><span>Lower</span><span>Typical</span><span>Higher</span></div>' +
    '</div>';
  }

  function viewNutrition() {
    const u = state.user;
    const m = mealDraft();
    const d = B.getData(u.id);
    const minor = !!(u.age && u.age < 18);

    const target = m.targets
      ? '<section class="card"><div class="section-title"><h3>Your daily estimate</h3></div>' +
        calorieMeterHtml(m.targets) +
        '<div class="macro-row gap-top"><div><strong>' + fmt(m.targets.kcal) +
          '</strong><small>kcal</small></div><div><strong>' + m.targets.protein +
          ' g</strong><small>protein</small></div><div><strong>' + m.targets.carbs +
          ' g</strong><small>carbs</small></div><div><strong>' + m.targets.fat + ' g</strong><small>fat</small></div></div>' +
        '<p class="muted small">Based on your age, height, weight and activity. It is a starting point, not medical advice.' +
          (minor ? ' Because you are under 18, this estimate is for maintaining your weight only. Please talk to a doctor or dietitian before changing how you eat.' : '') + '</p></section>'
      : '<section class="card"><div class="section-title"><h3>Your daily estimate</h3>' +
        '</div>' +
        '<p class="muted">Add your age, sex, height and weight in your profile to see a calorie and protein estimate.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-route="profile">Open profile</button>' +
        '</section>';

    // BMI calculator: its own height/weight fields (prefilled from the profile when set),
    // recalculated live as you type — not dependent on saving a full profile first.
    const bh = state.ui.bmiHeight != null ? state.ui.bmiHeight : (u.heightCm || '');
    const bw = state.ui.bmiWeight != null ? state.ui.bmiWeight : (u.weightKg || '');
    const bmiCard = '<section class="card gap-top"><div class="section-title"><h3>BMI calculator</h3></div>' +
      '<div class="controls">' +
        '<label class="field-inline">Height (cm)<input id="bmi-height" type="number" inputmode="decimal" min="100" max="250" value="' + esc(bh) + '"></label>' +
        '<label class="field-inline">Weight (kg)<input id="bmi-weight" type="number" inputmode="decimal" min="30" max="300" value="' + esc(bw) + '"></label>' +
      '</div>' +
      '<div id="bmi-result">' + bmiMeterHtml(bh, bw) + '</div>' +
      '<p class="muted small">BMI does not account for muscle, frame or age, so treat it as a rough guide, not a diagnosis.</p></section>';

    const guideChip = (id) => {
      const t = D.GUIDE_TAGS[id];
      return t ? '<span class="tag tag-guide">' + t.icon + ' ' + esc(t.label) + '</span>' : '';
    };
    const dayTabs = Array.from({ length: 7 }, (_, i) => ({ id: String(i), label: DAYS[(todayIdx() + i) % 7] }));
    const activeDay = Math.min(m.days.length - 1, Math.max(0, Number(state.ui.mealDay) || 0));
    const dayPlan = m.days[activeDay];
    const meals = dayPlan.items.map((i) =>
      '<article class="card meal-card"><span class="kicker">' + esc(i.label) + '</span><h4>' + esc(i.name) +
        '</h4><p class="muted small">about ' + i.kcal + ' kcal</p>' +
        (i.g && i.g.length ? '<div class="tags">' + i.g.map(guideChip).join('') + '</div>' : '') +
        '</article>').join('');
    const weekItems = m.days.reduce((a, day) => a.concat(day.items), []);
    const coverage = Object.keys(D.GUIDE_TAGS).filter((id) => weekItems.some((i) => (i.g || []).includes(id)));
    const coverageNote = coverage.length
      ? 'This week\'s plan leans on ' + coverage.map((id) => D.GUIDE_TAGS[id].label.toLowerCase()).join(', ') +
        ', in line with WHO\'s daily eating guidance on fruit, vegetables, whole grains and protein.'
      : 'Shuffle for a mix that covers fruit & veg, whole grains and protein through the week.';

    const saved = d.meals.length
      ? '<ul class="saved-list">' + d.meals.slice().reverse().slice(0, 5).map((p) => {
          const dayCount = new Set(p.items.map((i) => i.day || 0)).size;
          return '<li><div><b>' + esc(relDay(p.day)) + ' · ' + dayCount + '-day plan · ' + fmt(p.kcal) + ' kcal total</b><small>' +
            esc(labelOf(D.DIETS, p.diet)) + '</small></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="meal-delete" data-id="' + esc(p.id) +
            '">Delete</button></li>';
        }).join('') + '</ul>'
      : '<p class="muted">Saved plans appear here.</p>';

    return pageHead('Nutrition', 'A full week of day plans you can shuffle, adjust and save.') +
      '<div class="grid grid-2">' + target + hydrationCard() + '</div>' +
      bmiCard +
      '<div class="section-title gap-top"><h3>A week of meals</h3></div>' +
      '<div class="controls">' +
        '<label class="field-inline">Eating style<select data-ui="diet">' + opts(D.DIETS, m.diet) + '</select></label>' +
      '<label class="field-inline">Goal<select data-ui="dir"' + (minor ? ' disabled' : '') + '>' +
        opts(D.WEIGHT_DIRS, m.dir) + '</select></label>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="meal-shuffle">Shuffle week</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="meal-save">Save this week</button></div>' +
      '<div class="gap-top">' + chips(dayTabs, String(activeDay), 'meal-day') + '</div>' +
      '<div class="grid grid-4">' + meals + '</div>' +
      '<p class="muted small">Day total about ' + fmt(dayPlan.total) + ' kcal' + (m.targets ? '. Portions are scaled ×' +
        m.mult.toFixed(2) + ' to match your estimate of ' + fmt(m.targets.kcal) + ' kcal.' : '.') + '</p>' +
      '<p class="muted small">Week total about ' + fmt(m.total) + ' kcal across 7 days.</p>' +
      '<p class="muted small">' + esc(coverageNote) + '</p>' +
      '<section class="card gap-top"><div class="section-title"><h3>Saved plans</h3></div>' + saved + '</section>';
  }

  function viewProgress() {
    const u = state.user;
    const s = B.stats(u.id);
    const max = Math.max.apply(null, s.week.map((x) => x.min).concat([0]));
    const chart = s.week.map((x) => {
      const h = x.min > 0 && max > 0 ? Math.max(6, Math.round((x.min / max) * 100)) : 0;
      return '<div class="chart-col' + (x.today ? ' today' : '') + '"><span>' + x.min +
        'm</span><div class="bar-slot"><i style="height:' + h + '%"></i></div><b>' + esc(x.label) + '</b></div>';
    }).join('');
    const totalCat = Object.keys(s.catMin).reduce((a, k) => a + s.catMin[k], 0);
    const cats = Object.keys(s.catMin).sort((a, b) => s.catMin[b] - s.catMin[a]);
    const mix = cats.length
      ? '<div class="bar-list">' + cats.map((k) => '<div class="bar-line"><span>' + esc(catLabel(k)) +
        '</span><div class="bar-track"><i style="width:' + Math.round((s.catMin[k] / totalCat) * 100) +
        '%"></i></div><b>' + s.catMin[k] + 'm</b></div>').join('') + '</div>'
      : '<p class="muted">Your category mix appears after your first session.</p>';
    const badgeList = B.badgeStates(u.id);
    const badges = badgeList.map((x) =>
      '<div class="badge-card' + (x.unlocked ? ' unlocked' : '') + '"><div class="badge-icon" aria-hidden="true">' +
        x.badge.icon + '</div><strong>' + esc(x.badge.name) + '</strong>' +
      (x.unlocked
        ? '<small>Unlocked</small>'
        : '<small>' + esc(x.badge.desc) + '</small><div class="mini-bar"><i style="width:' +
          Math.round((x.value / x.badge.target) * 100) + '%"></i></div><small>' + fmt(x.value) + ' of ' +
          fmt(x.badge.target) + '</small>') + '</div>').join('');
    const recent = B.recentSessions(u.id, 12);
    const history = recent.length
      ? '<ul class="activity-list history">' + recent.map((r) => '<li><span class="ex-dot cat-' + esc(r.cat) +
        '"></span><div><b>' + esc(r.name) + '</b><small>' + esc(relDay(r.day)) + (r.partial ? ' · partial' : '') +
        '</small></div><span>' + r.min + ' min · +' + r.pts +
        '</span><button type="button" class="btn btn-ghost btn-sm" data-action="session-delete" data-id="' + esc(r.id) +
        '" aria-label="Undo ' + esc(r.name) + '">Undo</button></li>').join('') + '</ul>'
      : '<p class="muted">Nothing logged yet.</p>';
    const empty = s.sessions
      ? ''
      : '<section class="card empty gap-bottom">' +
        '<p>You have not logged a session yet. Every chart here is built from sessions you complete.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-route="exercises">Find a session</button>' +
        '</section>';

    return pageHead('Progress', 'Every chart is built from sessions you actually completed.') + empty +
      '<div class="grid grid-4">' + metric('Total minutes', fmt(s.minutes)) + metric('Sessions', fmt(s.sessions)) +
        metric('Points earned', fmt(s.points)) + metric('Current streak', s.streak, 'days') + '</div>' +
      '<div class="grid grid-2 gap-top"><section class="card">' +
        '<div class="section-title"><h3>Minutes in the last 7 days</h3>' +
        '<span class="muted small">' +
        s.weekMin + ' total</span></div><div class="chart-area">' + chart + '</div></section>' +
      '<section class="card"><div class="section-title"><h3>Category mix</h3></div>' + mix + '</section></div>' +
      '<section class="card gap-top"><div class="section-title">' +
        '<h3>Session history</h3>' +
        '<span class="muted small">Logged one by mistake? Undo it here.</span></div>' +
        history + '</section>' +
      '<div class="section-title"><h3>Badges</h3><span class="muted small">' +
        badgeList.filter((x) => x.unlocked).length + ' of ' + D.BADGES.length + ' unlocked</span></div>' +
      '<div class="card badge-grid">' + badges + '</div>';
  }

  function viewLeaderboard() {
    const range = state.ui.lb;
    const rows = B.leaderboard(range);
    const medal = (rank) => (rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank);
    const list = rows.map((r) =>
      '<li class="lb-row' + (r.me ? ' me' : '') + '"><span class="lb-rank">' + medal(r.rank) + '</span>' +
      '<span class="lb-name">' + esc(r.name) + (r.me ? ' <em>you</em>' : '') + '</span>' +
      '<strong>' + fmt(r.points) + ' pts</strong></li>').join('');
    const note = rows.length > 1
      ? 'Names are shortened to protect privacy.'
      : 'You are the only player so far. Anyone who creates an account on this device joins the board.';
    return pageHead('Leaderboard', 'Points come from sessions you finish. Weekly covers the last 7 days.') +
      chips([{ id: 'week', label: 'This week' }, { id: 'all', label: 'All time' }], range, 'lb-range') +
      '<ol class="card lb-list">' + list + '</ol>' +
      '<p class="muted small">' + note + '</p>';
  }

  function viewProfile() {
    const u = state.user;
    return pageHead('Profile', 'These details tune your suggestions and nutrition estimates.') +
      '<form id="profile-form" class="card form-grid" novalidate>' +
      '<label class="field">Name<input name="name" required value="' + esc(u.name) + '"></label>' +
      '<label class="field">Email<input value="' + esc(u.email) + '" disabled></label>' +
      '<label class="field">What describes you best?<select name="occupation">' + opts(D.OCCUPATIONS, u.occupation) + '</select></label>' +
      '<label class="field">Main goal<select name="goal">' + opts(D.GOALS, u.goal) + '</select></label>' +
      '<label class="field">Fitness level<select name="level">' + opts(D.LEVELS, u.level) + '</select></label>' +
      '<label class="field">Daily activity<select name="activity">' + opts(D.ACTIVITY, u.activity) + '</select></label>' +
      '<label class="field">Weekly activity goal (minutes)<input name="weeklyGoal" type="number" inputmode="numeric" min="30" max="1000" value="' +
        esc(goalOf(u)) + '"></label>' +
      '<label class="field">Age<input name="age" type="number" inputmode="numeric" min="13" max="100" value="' +
        esc(u.age == null ? '' : u.age) + '"></label>' +
      '<label class="field">Sex (used for the calorie estimate)<select name="sex">' + opts(D.SEX, u.sex) + '</select></label>' +
      '<label class="field">Height (cm)<input name="heightCm" type="number" inputmode="decimal" min="100" max="250" value="' +
        esc(u.heightCm == null ? '' : u.heightCm) + '"></label>' +
      '<label class="field">Weight (kg)<input name="weightKg" type="number" inputmode="decimal" min="30" max="300" value="' +
        esc(u.weightKg == null ? '' : u.weightKg) + '"></label>' +
      '<label class="field">Eating style<select name="diet">' + opts(D.DIETS, u.diet) + '</select></label>' +
      '<div class="form-actions">' +
        '<p id="profile-error" class="form-error" role="alert"></p>' +
        '<button class="btn btn-primary" type="submit">Save profile</button></div>' +
        '</form>' +
      '<section class="card gap-top"><div class="section-title"><h3>Your data</h3>' +
        '</div>' +
        '<p class="muted">Everything is stored in this browser only. Download a backup now and then; if you clear your browser data, it is gone.</p>' +
      '<div class="row">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="export">Download my data</button>' +
      '<label class="btn btn-ghost btn-sm file-btn">Restore from backup<input type="file" id="import-file" accept="application/json,.json" class="sr-only">' +
        '</label>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="reset-progress">Reset my progress</button>' +
      (u.role === 'admin' ? '' : '<button type="button" class="btn btn-danger btn-sm" data-action="delete-account">Delete my account</button>') + '</div></section>';
  }

  function adminParts() {
    let s;
    try { s = B.adminSummary(); } catch (e) { return null; }
    const me = state.user.id;
    const users = s.users.map((u) =>
      '<tr><td>' + esc(u.name) + (u.role === 'admin' ? ' <span class="tag tag-muted">admin</span>' : '') + '</td><td>' +
        esc(u.email) + '</td><td>' + esc(labelOf(D.OCCUPATIONS, u.occupation)) + '</td><td>' + u.sessions +
        '</td><td>' + fmt(u.points) + '</td><td>' +
      (u.id === me ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-action="admin-remove-user" data-id="' +
        esc(u.id) + '">Remove</button>') + '</td></tr>').join('');
    const videoRows = B.allExercises().map((e) => {
      const v = B.videoFor(e.id);
      const status = !v
        ? '<span class="muted">No video</span>'
        : v.type === 'file'
          ? 'File: ' + esc(v.name) + ' <small class="muted">(' + esc(sizeLabel(v.size)) + ')</small>'
          : 'Link: ' + esc(v.kind === 'direct' ? 'video file' : v.kind);
      return '<tr><td>' + esc(e.name) + '</td><td>' + esc(catLabel(e.cat)) + '</td><td>' + status + '</td><td><div class="actions-cell">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="video-edit" data-id="' + esc(e.id) + '">' +
          (v ? 'Change' : 'Add video') + '</button>' +
        (v ? '<button type="button" class="btn btn-ghost btn-sm" data-action="start-ex" data-id="' + esc(e.id) +
          '">Preview</button><button type="button" class="btn btn-ghost btn-sm" data-action="video-remove" data-id="' +
          esc(e.id) + '">Remove</button>' : '') +
        '</div></td></tr>';
    }).join('');
    const imageRows = B.allExercises().map((e) => {
      const image = B.exerciseImageFor(e.id);
      const status = image
        ? 'File: ' + esc(image.name) + ' <small class="muted">(' + esc(sizeLabel(image.size)) + ')</small>'
        : '<span class="muted">Animated character</span>';
      return '<tr><td>' + esc(e.name) + '</td><td>' + esc(catLabel(e.cat)) + '</td><td>' + status + '</td><td><div class="actions-cell">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="image-edit" data-id="' + esc(e.id) + '">' +
          (image ? 'Change picture' : 'Add picture') + '</button>' +
        (image ? '<button type="button" class="btn btn-ghost btn-sm" data-action="image-remove" data-id="' + esc(e.id) + '">Remove</button>' : '') +
        '</div></td></tr>';
    }).join('');
    const custom = s.custom.length
      ? '<ul class="saved-list">' + s.custom.map((e) => '<li><div><b>' + esc(e.name) + '</b><small>' +
        esc(catLabel(e.cat)) + ' · ' + e.min + ' min · ' + e.pts +
        ' pts</small></div><button type="button" class="btn btn-ghost btn-sm" data-action="admin-remove-ex" data-id="' +
        esc(e.id) + '">Delete</button></li>').join('') + '</ul>'
      : '<p class="muted">No custom exercises yet.</p>';
    return { s, users, videoRows, imageRows, custom };
  }

  const adminDenied = () => pageHead('Admin', 'Only the admin login can open this page.');

  function viewAdminOverview() {
    const p = adminParts();
    if (!p) return adminDenied();
    const { s, users } = p;
    return pageHead('Admin overview', 'Accounts and activity in this browser.') +
      '<div class="grid grid-3">' + metric('Accounts', s.totals.users) +
        metric('Sessions logged', fmt(s.totals.sessions)) + metric('Minutes logged', fmt(s.totals.minutes)) + '</div>' +
      '<section class="card gap-top"><div class="section-title"><h3>Accounts</h3>' +
        '</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th>' +
        '<th>Occupation</th><th>Sessions</th><th>Points</th><th></th></tr></thead>' +
        '<tbody>' +
        users + '</tbody></table></div></section>' +
      '<section class="card gap-top"><div class="section-title"><h3>Danger zone</h3>' +
        '</div>' +
        '<p class="muted">Removes every account and all saved data, videos included, from this browser.</p>' +
        '<div class="gap-top">' +
        '<button type="button" class="btn btn-danger btn-sm" data-action="admin-reset-all">Erase everything</button>' +
        '</div></section>';
  }

  function viewAdminVideos() {
    const p = adminParts();
    if (!p) return adminDenied();
    return pageHead('Exercise videos', 'Add a video to any exercise. It plays at the top when someone starts that exercise.') +
      '<section class="card"><div class="table-wrap tall"><table><thead><tr>' +
        '<th>Exercise</th><th>Type</th><th>Video</th><th></th></tr></thead><tbody>' +
        p.videoRows + '</tbody></table></div></section>';
  }

  function viewAdminExercises() {
    const p = adminParts();
    if (!p) return adminDenied();
    return pageHead('Manage exercises', 'Add exercises and choose pictures to replace the illustrated characters.') +
      '<div class="grid grid-2"><section class="card"><div class="section-title"><h3>Add an exercise</h3></div>' +
      '<form id="exercise-form" class="form-stack" novalidate>' +
      '<label>Name<input name="name" required maxlength="60"></label>' +
      '<label>Focus (optional)<input name="focus" maxlength="80" placeholder="Legs and core"></label>' +
      '<div class="two-col"><label>Type<select name="cat">' + opts(D.CATEGORIES, 'strength') +
        '</select></label><label>Level<select name="level">' + opts(D.LEVELS, 'beginner') + '</select></label></div>' +
      '<div class="two-col">' +
        '<label>Minutes<input name="min" type="number" min="1" max="120" value="5" required>' +
        '</label>' +
        '<label>Points<input name="pts" type="number" min="0" max="500" value="15" required>' +
        '</label></div>' +
      '<label>Steps (one per line)<textarea name="steps" rows="4" required></textarea></label>' +
      '<label>Video file (optional)<input type="file" name="file" accept="video/*"></label>' +
      '<label>or video link (optional)<input name="url" type="url" placeholder="https://youtu.be/…"></label>' +
      '<p id="exercise-error" class="form-error" role="alert"></p>' +
        '<button class="btn btn-primary" type="submit">Add exercise</button></form>' +
        '</section>' +
      '<section class="card"><div class="section-title"><h3>Custom exercises</h3>' +
        '</div>' + p.custom + '</section></div>' +
      '<section class="card gap-top"><div class="section-title"><h3>Exercise pictures</h3></div>' +
        '<p class="muted small">Upload a PNG, JPEG, WebP, or GIF up to ' + Math.round(B.EXERCISE_IMAGE_MAX_BYTES / 1048576) +
        ' MB. Pictures replace the animated character on exercise cards and in the player.</p>' +
        '<div class="table-wrap tall"><table><thead><tr><th>Exercise</th><th>Type</th><th>Picture</th><th></th></tr></thead><tbody>' +
        p.imageRows + '</tbody></table></div></section>';
  }

  const ROUTES = {
    home: { title: 'Home', view: viewHome },
    dashboard: { title: 'Dashboard', view: viewDashboard },
    exercises: { title: 'Exercises', view: viewLibrary },
    desk: { title: 'Desk Fitness', view: viewLibrary },
    yoga: { title: 'Yoga', view: viewLibrary },
    plans: { title: 'Workout Plans', view: viewPlans },
    nutrition: { title: 'Nutrition', view: viewNutrition },
    progress: { title: 'Progress', view: viewProgress },
    leaderboard: { title: 'Leaderboard', view: viewLeaderboard },
    profile: { title: 'Profile', view: viewProfile },
    admin: { title: 'Admin overview', view: viewAdminOverview, admin: true },
    'admin-videos': { title: 'Exercise videos', view: viewAdminVideos, admin: true },
    'admin-exercises': { title: 'Manage exercises', view: viewAdminExercises, admin: true },
  };

  /* ---------- exercise player ---------- */
  // run (optional): { queue: [ids], index, name, acc: { n, min, pts } } when playing a routine.
  function openPlayer(id, run) {
    const ex = B.findExercise(id);
    if (!ex) { toast('That exercise is no longer available.', 'warn'); return; }
    const preview = state.user.role === 'admin'; // admins can watch, but their previews are never logged
    const total = ex.min * 60;
    let running = false;
    let startedAt = 0;
    let accum = 0;
    let tick = null;
    const elapsed = () => Math.floor((accum + (running ? Date.now() - startedAt : 0)) / 1000);

    const vmeta = B.videoFor(ex.id);
    let objectUrl = null;
    let wake = null;
    let audio = null;
    let videoStallTimer = null;
    const releaseWake = () => { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; };
    const keepAwake = async () => { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed: fine */ } };
    const cue = () => {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.07;
        o.connect(g);
        g.connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + 0.3);
      } catch (e) { /* no audio */ }
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* no vibration */ }
    };
    const stepLabel = run ? '<span class="tag tag-step">Step ' + (run.index + 1) + ' of ' + run.queue.length + ' · ' +
      esc(run.name) + '</span> ' : '';

    const playerModal = openModal(
      stepLabel + '<span class="tag">' + esc(catLabel(ex.cat)) + '</span><h3>' + esc(ex.name) +
        '</h3><p class="muted">' + esc(ex.focus) + '</p>' +
      (vmeta ? '<div class="video-wrap" id="pl-video"><p class="video-msg">Loading video…</p></div>' +
        (vmeta.title ? '<p class="small muted">' + esc(vmeta.title) + '</p>' : '') : '') +
      (preview ? '' : '<div class="timer"><div class="ring" id="pl-ring" style="--p:0"><strong id="pl-time">' +
        mmss(total) + '</strong><small>left</small></div></div>') +
      '<div class="howto"><div class="pose-panel" aria-hidden="true" data-exercise-image="' + esc(ex.id) + '" ' + poseStyle(ex) + '>' + poseFigure(ex) + '</div>' +
      '<ol class="steps">' + ex.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></div>' +
      (preview
        ? '<p class="muted small">Admin preview. Nothing is logged from here.</p>'
        : '<div class="modal-actions"><button type="button" class="btn btn-ghost" id="pl-toggle">Start timer</button>' +
          '<button type="button" class="btn btn-ghost" id="pl-stop" disabled>Stop early</button>' +
          (run ? '<button type="button" class="btn btn-ghost" id="pl-skip">Skip</button>' : '') +
          '<button type="button" class="btn btn-primary" id="pl-done">Mark complete</button></div>' +
          '<p class="muted small">Marking complete logs ' + ex.min + ' min and ' + ex.pts + ' points. Stopping early logs the time you spent, once you pass 30 seconds.</p>'),
      { wide: true, onClose: () => { clearInterval(tick); releaseWake(); if (audio && audio.close) { try { audio.close(); } catch (e) { /* ignore */ } } if (objectUrl) URL.revokeObjectURL(objectUrl); clearTimeout(videoStallTimer); } }
    );
    hydrateExerciseImages(playerModal);

    if (vmeta) {
      const box = $('#pl-video');
      const alive = () => document.body.contains(box);
      const clearStall = () => { clearTimeout(videoStallTimer); videoStallTimer = null; };
      const say = (html) => { clearStall(); if (alive()) box.innerHTML = '<p class="video-msg">' + html + '</p>'; };
      // Show a spinner (not just bare text) so a slow connection still feels like it's doing something.
      const showLoading = () => { box.innerHTML = '<p class="video-msg"><span class="spinner" aria-hidden="true"></span>Loading video…</p>'; };
      const mountVideo = (src, failHtml) => {
        const v = document.createElement('video');
        v.controls = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.setAttribute('controlslist', 'nodownload');
        v.addEventListener('error', () => say(failHtml));
        v.addEventListener('loadedmetadata', clearStall);
        v.src = src;
        box.innerHTML = '';
        box.appendChild(v);
        // Some files never fire 'error' (e.g. a broken CDN link that hangs); back it up with a timeout.
        videoStallTimer = setTimeout(() => { if (v.readyState === 0) say(failHtml); }, 12000);
      };
      if (vmeta.type === 'file') {
        showLoading();
        B.getVideoBlob(ex.id).then((blob) => {
          if (!alive()) return;
          if (!blob) { say('This video file is saved in another browser or on another device, so it cannot play here.'); return; }
          objectUrl = URL.createObjectURL(blob);
          mountVideo(objectUrl, 'Your browser could not play this file. MP4 (H.264) and WebM work best.');
        }).catch(() => say('Could not load the video from storage.'));
      } else if (vmeta.kind === 'direct') {
        showLoading();
        mountVideo(vmeta.embed, 'Could not play this video. <a href="' + esc(vmeta.url) + '" target="_blank" rel="noopener noreferrer">Open it in a new tab</a>.');
      } else {
        // YouTube/Vimeo: a blocked or slow embed just sits blank with no error event, which reads as
        // "broken". Mount it immediately (so it starts loading right away) under a spinner overlay,
        // and fall back to a real link if it never loads (ad blockers and some networks block the
        // embed domains outright, silently).
        const openLink = 'Having trouble playing this here? <a href="' + esc(vmeta.url) + '" target="_blank" rel="noopener noreferrer">Open it on ' +
          (vmeta.kind === 'vimeo' ? 'Vimeo' : 'YouTube') + '</a>.';
        const f = document.createElement('iframe');
        f.src = vmeta.embed;
        f.title = 'Video: ' + ex.name;
        f.loading = 'eager';
        f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true;
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        // allow-popups-to-escape-sandbox lets links inside the embed (e.g. "Watch on YouTube") open as
        // normal tabs instead of staying trapped in the sandbox.
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
        const overlay = document.createElement('p');
        overlay.className = 'video-msg video-overlay';
        overlay.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading video…';
        f.addEventListener('load', () => { clearStall(); overlay.remove(); });
        box.innerHTML = '';
        box.appendChild(f);
        box.appendChild(overlay);
        videoStallTimer = setTimeout(() => { if (alive()) say(openLink); }, 10000);
      }
    }

    if (preview) return;

    const $time = $('#pl-time');
    const $ring = $('#pl-ring');
    const $toggle = $('#pl-toggle');
    const $stop = $('#pl-stop');
    const $done = $('#pl-done');

    const pause = () => {
      if (!running) return;
      accum += Date.now() - startedAt;
      running = false;
      clearInterval(tick);
      releaseWake();
      $toggle.textContent = 'Resume';
    };
    const paint = () => {
      const e = elapsed();
      const left = Math.max(0, total - e);
      $time.textContent = mmss(left);
      $ring.style.setProperty('--p', Math.min(100, (e / total) * 100));
      $stop.disabled = e < 30;
      if (left === 0 && running) {
        pause();
        $toggle.disabled = true;
        $toggle.textContent = 'Time is up';
        cue();
        toast('Time is up. Tap Mark complete to log it.', 'info', 5000);
      }
    };
    $toggle.addEventListener('click', () => {
      if (running) { pause(); paint(); return; }
      running = true;
      startedAt = Date.now();
      tick = setInterval(paint, 250);
      $toggle.textContent = 'Pause';
      keepAwake();
      try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.resume) audio.resume(); } catch (e) { /* no audio */ } // unlock sound while we have a tap
    });
    // After a routine step: open the next exercise, or show the routine total.
    const nextStep = (logged) => {
      if (!run) return;
      if (logged) { run.acc.n += 1; run.acc.min += logged.minutes; run.acc.pts += logged.points; }
      if (run.index + 1 < run.queue.length) openPlayer(run.queue[run.index +
        1], Object.assign({}, run, { index: run.index + 1 }));
      else if (run.acc.n) toast('Routine complete: ' + run.acc.n + ' exercise' + (run.acc.n === 1 ? '' : 's') + ', ' +
        run.acc.min + ' min, +' + run.acc.pts + ' points', 'gold', 6000);
    };
    const $skip = $('#pl-skip');
    if ($skip) $skip.addEventListener('click', () => { closeModal(); nextStep(null); });
    const finish = (minutes, points, partial) => {
      $done.disabled = true;
      $stop.disabled = true;
      try {
        const res = B.recordSession(state.user.id, ex.id, { minutes, points, partial });
        closeModal();
        toast('+' + points + ' points · ' + minutes + ' min logged', 'ok');
        announceBadges(res.newBadges);
        render();
        nextStep({ minutes, points });
      } catch (err) {
        $done.disabled = false;
        toast(err.message, 'warn');
      }
    };
    $done.addEventListener('click', () => finish(ex.min, ex.pts, false));
    $stop.addEventListener('click', () => {
      const e = elapsed();
      if (e < 30) return;
      pause();
      finish(Math.min(ex.min, Math.max(1, Math.round(e / 60))), Math.max(1, Math.round(ex.pts * Math.min(1, e / total))), true);
    });
  }

  /* ---------- admin: attach a video to an exercise ---------- */
  function openVideoModal(exId) {
    const ex = B.findExercise(exId);
    if (!ex) return;
    const cur = B.videoFor(exId);
    openModal(
      '<h3>Video for ' + esc(ex.name) + '</h3>' +
        '<p class="muted">Upload a file or paste a link. Saving replaces the current video.</p>' +
      '<form id="video-form" class="form-stack" data-id="' + esc(exId) + '" novalidate>' +
      '<label>Title (optional)<input name="title" maxlength="80" placeholder="Form guide" value="' +
        esc(cur && cur.title ? cur.title : '') + '"></label>' +
      '<label>Upload a video file<input type="file" name="file" accept="video/*"></label>' +
      '<p class="muted small">MP4 or WebM, up to ' + Math.round(B.VIDEO_MAX_BYTES / 1048576) + ' MB. Files are stored in this browser.</p>' +
      '<p class="or">or</p>' +
      '<label>Paste a link<input name="url" type="url" placeholder="https://youtu.be/…"></label>' +
      '<p class="muted small">YouTube, Vimeo, or a direct link ending in .mp4 or .webm.</p>' +
      '<p id="video-error" class="form-error" role="alert"></p>' +
      '<button class="btn btn-primary" type="submit">Save video</button></form>'
    );
  }

  function openExerciseImageModal(exId) {
    const ex = B.findExercise(exId);
    if (!ex) return;
    const current = B.exerciseImageFor(exId);
    openModal(
      '<h3>Picture for ' + esc(ex.name) + '</h3>' +
      '<p class="muted">Upload a picture to replace the animated character on exercise cards and in the player.</p>' +
      (current ? '<p class="small muted">Current picture: ' + esc(current.name) + '</p>' : '') +
      '<form id="exercise-image-form" class="form-stack" data-id="' + esc(exId) + '" novalidate>' +
      '<label>Choose a picture<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" required></label>' +
      '<p class="small muted">PNG, JPEG, WebP, or GIF. Maximum ' + Math.round(B.EXERCISE_IMAGE_MAX_BYTES / 1048576) + ' MB.</p>' +
      '<p id="exercise-image-error" class="form-error" role="alert"></p>' +
      '<button class="btn btn-primary" type="submit">Save picture</button></form>'
    );
  }

  /* ---------- reminders ---------- */
  let reminderTimer = null;
  let reminderKey = '';
  function scheduleReminder() {
    const btn = $('#reminder-btn');
    const u = state.user;
    if (!u) { clearInterval(reminderTimer); reminderTimer = null; reminderKey = ''; btn.classList.remove('active'); return; }
    const r = B.getData(u.id).reminder;
    btn.classList.toggle('active', !!r.on);
    btn.setAttribute('aria-pressed', r.on ? 'true' : 'false');
    // Every action re-renders the page. Only restart the countdown when the settings really changed,
    // otherwise a busy user would keep pushing the reminder back and never see it.
    const key = u.id + '|' + r.on + '|' + r.every;
    if (key === reminderKey) return;
    reminderKey = key;
    clearInterval(reminderTimer);
    reminderTimer = null;
    if (!r.on) return;
    reminderTimer = setInterval(() => {
      const pool = B.allExercises().filter((e) => e.cat === 'desk' || e.cat === 'stretch');
      const ex = pool[Math.floor(Math.random() * pool.length)];
      const msg = 'Time for a movement break. Try ' + ex.name + ' (' + ex.min + ' min).';
      toast(msg, 'info', 7000);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('FitLife', { body: msg }); } catch (e) { /* ignore */ }
      }
    }, r.every * 60 * 1000);
  }

  function openReminder() {
    const r = B.getData(state.user.id).reminder;
    openModal(
      '<h3>Movement break reminders</h3>' +
        '<p class="muted">A gentle nudge to get up and move while FitLife is open in a browser tab.</p>' +
      '<form id="reminder-form" class="form-stack"><label class="check"><input type="checkbox" name="on"' +
        (r.on ? ' checked' : '') + '> Remind me to take a break</label>' +
      '<label>Every<select name="every">' +
        [[30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '90 minutes'], [120, '2 hours']].map((o) => '<option value="' +
        o[0] + '"' + (o[0] === r.every ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
      '<button class="btn btn-primary" type="submit">Save reminder</button></form>'
    );
  }

  // Asked right after a fresh login/signup, once, when the profile is still missing
  // height/weight (or age): age/sex/height/weight let us show a BMI and calorie meter.
  function openBodyStatsModal(user) {
    const u = user || state.user;
    openModal(
      '<h3>A couple of quick details</h3>' +
        '<p class="muted">Age, sex, height and weight let FitLife show your BMI and a daily calorie estimate. You can change these any time in Profile.</p>' +
      '<form id="body-stats-form" class="form-stack">' +
        '<div class="controls">' +
          '<label class="field-inline">Age<input required id="stats-age" name="age" type="number" inputmode="numeric" min="13" max="100" placeholder="Years" value="' +
            esc(u.age == null ? '' : u.age) + '"></label>' +
          '<label class="field-inline">Sex<select id="stats-sex" name="sex">' + opts(D.SEX, u.sex) + '</select></label>' +
        '</div>' +
        '<div class="controls">' +
          '<label class="field-inline">Height (cm)<input required id="stats-height" name="heightCm" type="number" inputmode="decimal" min="100" max="250" placeholder="e.g. 165" value="' +
            esc(u.heightCm == null ? '' : u.heightCm) + '"></label>' +
          '<label class="field-inline">Weight (kg)<input required id="stats-weight" name="weightKg" type="number" inputmode="decimal" min="30" max="300" placeholder="e.g. 60" value="' +
            esc(u.weightKg == null ? '' : u.weightKg) + '"></label>' +
        '</div>' +
        '<div id="stats-bmi">' + bmiMeterHtml(u.heightCm, u.weightKg) + '</div>' +
        '<p id="body-stats-error" class="form-error" role="alert"></p>' +
        '<div class="row">' +
          '<button class="btn btn-primary" type="submit">Save and see my BMI</button>' +
          '<button type="button" class="btn btn-ghost" data-close>Skip for now</button>' +
        '</div>' +
      '</form>'
    );
  }

  /* ---------- rendering ---------- */
  function setAuthTab(tab) {
    $$('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b.dataset.authTab === tab));
    $('#login-form-wrap').classList.toggle('hidden', tab !== 'login');
    $('#signup-form-wrap').classList.toggle('hidden', tab !== 'signup');
  }

  function routeFromHash() {
    const r = location.hash.replace(/^#\/?/, '') || 'home';
    return ROUTES[r] ? r : 'home';
  }

  function navigate(r) {
    const target = '#/' + r;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function render() {
    const user = B.currentUser();
    state.user = user;
    const auth = $('#auth-view');
    const app = $('#app-view');
    if (!user) {
      closeModal();
      auth.classList.remove('hidden');
      app.classList.add('hidden');
      document.title = D.APP_NAME + ' | Move more, feel better';
      scheduleReminder();
      return;
    }
    auth.classList.add('hidden');
    app.classList.remove('hidden');

    const isAdmin = user.role === 'admin';
    let r = routeFromHash();
    if (isAdmin && !ROUTES[r].admin) r = 'admin';
    if (!isAdmin && ROUTES[r].admin) r = 'home';
    state.route = r;
    const changed = state.lastRoute !== r;
    if (changed) {
      state.ui.cat = 'all';
      state.ui.level = 'all';
      state.ui.q = '';
      state.ui.seed = 1;
      state.ui.mealDay = 0;
      $('#sidebar-message').textContent = D.NUDGES[state.nudge++ % D.NUDGES.length];
    }

    state.day = dayKey();
    $$('.side-nav .nav-item').forEach((b) => {
      const on = b.dataset.route === r;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    // Two experiences behind one login: the admin gets the admin panel, everyone else gets the app.
    $('#user-nav').classList.toggle('hidden', isAdmin);
    $('#admin-nav').classList.toggle('hidden', !isAdmin);
    $('.mini-motivation').classList.toggle('hidden', isAdmin);
    $('#reminder-btn').classList.toggle('hidden', isAdmin);
    $('#page-title').textContent = ROUTES[r].title;
    document.title = ROUTES[r].title + ' | ' + D.APP_NAME;
    $('#top-name').textContent = U.displayName(user.name);
    $('#top-department').textContent = isAdmin ? 'Administrator' : labelOf(D.OCCUPATIONS, user.occupation);
    $('#top-avatar').textContent = U.displayName(user.name).charAt(0).toUpperCase();

    $('#page-content').innerHTML = ROUTES[r].view();
    hydrateExerciseImages($('#page-content'));
    if (changed) window.scrollTo(0, 0);
    state.lastRoute = r;
    closeMenu();
    scheduleReminder();
  }

  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    const b = $('#mobile-menu');
    if (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); }
  };
  const openMenu = () => setMenu(true);
  const closeMenu = () => setMenu(false);

  /* ---------- form handlers ---------- */
  async function withBusy(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(); } finally { if (btn) btn.disabled = false; }
  }

  // The admin forms accept a video file or a link, never both.
  const VIDEO_BOTH_MSG = 'Choose a video file or a link, not both.';
  function readVideoInput(fd) {
    const picked = fd.get('file');
    const file = picked && picked.size ? picked : null;
    const url = String(fd.get('url') || '').trim();
    return { file, url, both: !!(file && url) };
  }

  const forms = {
    'login-form': (form) => withBusy(form, async () => {
      const err = $('#login-error');
      err.textContent = '';
      const fd = new FormData(form);
      try {
        const user = await B.login(fd.get('email'), fd.get('password'));
        form.reset();
        afterAuth(user);
      } catch (e) { err.textContent = e.message; }
    }),
    'signup-form': (form) => withBusy(form, async () => {
      const err = $('#signup-error');
      err.textContent = '';
      const fd = new FormData(form);
      try {
        const user = await B.signup({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), occupation: fd.get('occupation') });
        form.reset();
        afterAuth(user);
        toast('Welcome to ' + D.APP_NAME + '. Set your goals in Profile whenever you like.', 'ok', 4500);
      } catch (e) { err.textContent = e.message; }
    }),
    'profile-form': (form) => {
      const fd = new FormData(form);
      const err = $('#profile-error');
      err.textContent = '';
      try {
        B.updateProfile(state.user.id, {
          name: fd.get('name'), occupation: fd.get('occupation'), goal: fd.get('goal'), level: fd.get('level'), activity: fd.get('activity'),
          age: fd.get('age'), sex: fd.get('sex'), heightCm: fd.get('heightCm'), weightKg: fd.get('weightKg'), diet: fd.get('diet'), weeklyGoal: fd.get('weeklyGoal'),
        });
        resetNutritionChoices();
        render();
        toast('Profile saved', 'ok');
      } catch (e) { err.textContent = e.message; }
    },
    'body-stats-form': (form) => {
      const fd = new FormData(form);
      const err = $('#body-stats-error');
      err.textContent = '';
      try {
        const user = B.updateProfile(state.user.id, {
          age: fd.get('age'), sex: fd.get('sex'), heightCm: fd.get('heightCm'), weightKg: fd.get('weightKg'),
        });
        state.user = user;
        closeModal();
        render();
        toast('Saved. Here is your BMI and calorie estimate.', 'ok');
      } catch (e) { err.textContent = e.message; }
    },
    'reminder-form': (form) => {
      const fd = new FormData(form);
      const on = fd.get('on') === 'on';
      B.setReminder(state.user.id, { on, every: fd.get('every') });
      if (on && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) { /* ignore */ }
      }
      closeModal();
      scheduleReminder();
      toast(on ? 'Reminders are on' : 'Reminders are off', 'ok');
    },
    'exercise-form': (form) => withBusy(form, async () => {
      const fd = new FormData(form);
      const err = $('#exercise-error');
      err.textContent = '';
      const video = readVideoInput(fd);
      if (video.both) { err.textContent = VIDEO_BOTH_MSG; return; }
      try {
        const ex = B.adminAddExercise(Object.fromEntries(fd.entries()));
        let videoError = '';
        try {
          if (video.file) await B.adminSetVideoFile(ex.id, video.file, '');
          else if (video.url) await B.adminSetVideoLink(ex.id, video.url, '');
        } catch (e) { videoError = e.message; }
        render();
        if (videoError) toast('Exercise added, but the video was not saved: ' + videoError, 'warn', 7000);
        else toast('Exercise added', 'ok');
      } catch (e) { err.textContent = e.message; }
    }),
    'exercise-image-form': (form) => withBusy(form, async () => {
      const file = new FormData(form).get('image');
      const exId = form.dataset.id;
      const err = $('#exercise-image-error');
      err.textContent = '';
      try {
        await B.adminSetExerciseImage(exId, file);
        clearExerciseImageUrl(exId);
        render();
        toast('Exercise picture saved', 'ok');
      } catch (e) { err.textContent = e.message; }
    }),
    'video-form': (form) => withBusy(form, async () => {
      const fd = new FormData(form);
      const err = $('#video-error');
      const btn = form.querySelector('button[type=submit]');
      err.textContent = '';
      const video = readVideoInput(fd);
      if (video.both) { err.textContent = VIDEO_BOTH_MSG; return; }
      if (!video.file && !video.url) { err.textContent = 'Choose a video file or paste a link.'; return; }
      btn.textContent = 'Saving…';
      try {
        if (video.file) await B.adminSetVideoFile(form.dataset.id, video.file, fd.get('title'));
        else await B.adminSetVideoLink(form.dataset.id, video.url, fd.get('title'));
        closeModal();
        render();
        toast('Video saved', 'ok');
      } catch (e) {
        err.textContent = e.message;
        btn.textContent = 'Save video';
      }
    }),
  };

  // Same login for everyone. Members land on Home, the admin lands on the admin panel.
  // Back to "use my profile" for eating style and goal on the Nutrition page.
  const resetNutritionChoices = () => { state.ui.diet = null; state.ui.dir = null; };

  function afterAuth(user) {
    state.lastRoute = null;
    resetNutritionChoices();
    const target = user && user.role === 'admin' ? '#/admin' : '#/home';
    if (user && user.role === 'admin') toast('Signed in as admin', 'ok');
    if (location.hash !== target) location.hash = target;
    else render();
    // Ask for age/sex/height/weight right after login (not on the signup form itself) so we
    // can show a BMI and calorie meter. Skipped for the admin account and once already set.
    if (user && user.role !== 'admin' && (user.age == null || user.heightCm == null || user.weightKg == null)) {
      openBodyStatsModal(user);
    }
  }

  /* ---------- click actions ---------- */
  const actions = {
    'start-ex': (el) => openPlayer(el.dataset.id),
    'start-list': (el) => {
      const ids = String(el.dataset.ids || '').split(',').filter((id) => B.findExercise(id));
      if (!ids.length) return;
      openPlayer(ids[0], { queue: ids, index: 0, name: el.dataset.name || 'Routine', acc: { n: 0, min: 0, pts: 0 } });
    },
    'session-delete': (el) => attempt(() => B.deleteSession(state.user.id, el.dataset.id), 'Session removed'),
    'filter-cat': (el) => { state.ui.cat = el.dataset.value; render(); },
    'filter-level': (el) => { state.ui.level = el.dataset.value; render(); },
    'lb-range': (el) => { state.ui.lb = el.dataset.value; render(); },
    water: (el) => {
      const res = B.addWater(state.user.id, Number(el.dataset.delta));
      announceBadges(res.newBadges);
      render();
    },
    'plan-set': (el) => { B.setPlan(state.user.id, el.dataset.id); toast('Plan updated', 'ok'); render(); },
    'plan-stop': () => { B.setPlan(state.user.id, null); toast('Plan stopped', 'ok'); render(); },
    'meal-shuffle': () => { state.ui.seed += 1; render(); },
    'meal-day': (el) => { state.ui.mealDay = Number(el.dataset.value) || 0; render(); },
    'meal-save': () => {
      const m = mealDraft();
      const items = [];
      m.days.forEach((day, idx) => day.items.forEach((it) => items.push(Object.assign({ day: idx }, it))));
      const fresh = B.saveMealPlan(state.user.id, { diet: m.diet, kcal: m.total, items });
      toast('Week plan saved', 'ok');
      announceBadges(fresh);
      render();
    },
    'meal-delete': (el) => { B.deleteMealPlan(state.user.id, el.dataset.id); render(); },
    export: () => {
      download('fitlife-data-' + dayKey() + '.json', B.exportData(state.user.id), 'application/json');
      toast('Data downloaded', 'ok');
    },
    'reset-progress': () => {
      if (!confirm('Erase all your sessions, meals, water logs and badges? Your profile stays.')) return;
      B.resetProgress(state.user.id);
      render();
      toast('Progress reset', 'ok');
    },
    'delete-account': () => {
      if (!confirm('Delete your account and all its data from this browser? This cannot be undone.')) return;
      B.deleteAccount(state.user.id);
      history.replaceState(null, '', location.pathname + location.search);
      state.lastRoute = null;
      render();
    },
    'admin-remove-user': (el) => {
      if (confirm('Remove this account and its data?')) attempt(() => B.adminRemoveUser(el.dataset.id), 'Account removed');
    },
    'video-edit': (el) => openVideoModal(el.dataset.id),
    'image-edit': (el) => openExerciseImageModal(el.dataset.id),
    'image-remove': (el) => {
      if (!confirm('Remove this picture and restore the animated character?')) return;
      clearExerciseImageUrl(el.dataset.id);
      attempt(() => B.adminRemoveExerciseImage(el.dataset.id), 'Picture removed');
    },
    'video-remove': (el) => {
      if (confirm('Remove this video from the exercise?')) attempt(() => B.adminRemoveVideo(el.dataset.id), 'Video removed');
    },
    'admin-remove-ex': (el) => attempt(() => B.adminRemoveExercise(el.dataset.id)),
    'admin-reset-all': () => {
      if (!confirm('Erase every account and all data in this browser?')) return;
      try {
        B.adminResetAll();
        history.replaceState(null, '', location.pathname + location.search);
        state.lastRoute = null;
        render();
      } catch (e) { toast(e.message, 'warn'); }
    },
    'open-reminder': () => openReminder(),
    logout: () => {
      B.logout();
      history.replaceState(null, '', location.pathname + location.search);
      state.lastRoute = null;
      render();
    },
    'toggle-menu': () => (document.body.classList.contains('menu-open') ? closeMenu() : openMenu()),
  };

  function bind() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target.classList.contains('modal-backdrop')) { closeModal(); return; }
      const tab = e.target.closest('[data-auth-tab]');
      if (tab) { setAuthTab(tab.dataset.authTab); return; }
      const act = e.target.closest('[data-action]');
      if (act && actions[act.dataset.action]) { actions[act.dataset.action](act); return; }
      const rt = e.target.closest('[data-route]');
      if (rt) navigate(rt.dataset.route);
      if (e.target.id === 'scrim') closeMenu();
    });

    document.addEventListener('submit', (e) => {
      const h = forms[e.target.id];
      if (h) { e.preventDefault(); h(e.target); }
    });

    document.addEventListener('change', async (e) => {
      if (e.target.id === 'import-file') {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!confirm('Restore from "' + file.name + '"? This replaces your current sessions, meals and water logs.')) return;
        try {
          const text = await file.text();
          const res = B.importData(state.user.id, text);
          render();
          toast('Restored ' + res.sessions + ' sessions', 'ok');
        } catch (err) { toast(err.message, 'warn', 5000); }
        return;
      }
      const key = e.target.dataset && e.target.dataset.ui;
      if (key) { state.ui[key] = e.target.value; render(); }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'ex-search') {
        state.ui.q = e.target.value;
        const list = filteredExercises();
        $('#ex-grid').innerHTML = exGrid(list);
        $('#ex-count').textContent = list.length + ' exercise' + (list.length === 1 ? '' : 's');
        return;
      }
      if (e.target.id === 'bmi-height' || e.target.id === 'bmi-weight') {
        state.ui.bmiHeight = $('#bmi-height').value;
        state.ui.bmiWeight = $('#bmi-weight').value;
        const box = $('#bmi-result');
        if (box) box.innerHTML = bmiMeterHtml(state.ui.bmiHeight, state.ui.bmiWeight);
      }
      if (e.target.id === 'stats-height' || e.target.id === 'stats-weight') {
        const box = $('#stats-bmi');
        if (box) box.innerHTML = bmiMeterHtml($('#stats-height').value, $('#stats-weight').value);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !activeModal && document.body.classList.contains('menu-open')) { closeMenu(); return; }
      if (!activeModal) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key !== 'Tab') return;
      const f = $$('button:not([disabled]), input, select, textarea, a[href]', $('.modal')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $('.modal'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    window.addEventListener('hashchange', render);

    // If the tab stays open past midnight, roll "today" over without waiting for a click.
    const rollover = () => { if (state.user && state.day && state.day !== dayKey()) render(); };
    setInterval(rollover, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });
    B.onExternalChange(render);
    B.onSaveError(() => toast('Could not save. Your browser may be blocking storage, so progress will be lost when you close this tab.', 'warn', 6000));
  }

  function boot() {
    document.title = D.APP_NAME;
    $$('link[data-font]').forEach((l) => { l.media = 'all'; });
    $$('.app-name').forEach((n) => (n.textContent = D.APP_NAME));
    const occ = $('#signup-form select[name=occupation]');
    if (occ) occ.innerHTML = opts(D.OCCUPATIONS, 'desk');
    bind();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
