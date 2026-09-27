/* FitLife: static content + small utilities.
   Loaded first. Everything hangs off window.FitLife. */
(function () {
  'use strict';

  const FL = (window.FitLife = window.FitLife || {});

  /* ---------- utilities ---------- */
  const pad = (n) => String(n).padStart(2, '0');

  // Local calendar day (YYYY-MM-DD). Never use toISOString() for this:
  // it is UTC, so in India sessions logged after midnight IST would land on the wrong day.
  const dayKey = (d) => {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  // Parse a day key at noon so DST shifts can never move it to another date.
  const parseKey = (k) => {
    const p = k.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12);
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  // "shashank soam" -> "Shashank Soam", but leave "McDonald" alone.
  const displayName = (s) => {
    s = String(s || '').trim();
    return s === s.toLowerCase() ? titleCase(s) : s;
  };

  // Whole number that changes at local midnight (not UTC midnight), used to rotate daily suggestions.
  const dayNumber = () => Math.floor(parseKey(dayKey()).getTime() / 86400000);
  // "Vishnu Kumar Singhania" -> "Vishnu S." for places other people can see, like the leaderboard.
  const shortName = (s) => {
    const parts = displayName(s).split(' ').filter(Boolean);
    return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : parts[0] || '';
  };

  FL.util = { pad, dayKey, parseKey, addDays, uid, esc, displayName, dayNumber, shortName };

  /* ---------- lookup lists ---------- */
  const CATEGORIES = [
    { id: 'strength', label: 'Strength' },
    { id: 'cardio', label: 'Cardio' },
    { id: 'desk', label: 'Desk' },
    { id: 'yoga', label: 'Yoga' },
    { id: 'stretch', label: 'Mobility' },
  ];
  const LEVELS = [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced', label: 'Advanced' },
  ];
  const OCCUPATIONS = [
    { id: 'desk', label: 'Office or desk job' },
    { id: 'remote', label: 'Remote or freelance' },
    { id: 'student', label: 'Student' },
    { id: 'onfeet', label: 'On my feet most of the day' },
    { id: 'shift', label: 'Shift or night work' },
    { id: 'home', label: 'Homemaker or caregiver' },
    { id: 'retired', label: 'Retired' },
    { id: 'other', label: 'Something else' },
  ];
  const SEATED = ['desk', 'remote', 'student'];
  const GOALS = [
    { id: 'stay-active', label: 'Stay active' },
    { id: 'lose-weight', label: 'Lose weight' },
    { id: 'build-strength', label: 'Build strength' },
    { id: 'more-energy', label: 'Have more energy' },
    { id: 'less-stress', label: 'Feel less stressed' },
    { id: 'flexibility', label: 'Move more freely' },
  ];
  const ACTIVITY = [
    { id: 'sedentary', label: 'Mostly sitting', f: 1.2 },
    { id: 'light', label: 'Light: walking a few days a week', f: 1.375 },
    { id: 'moderate', label: 'Moderate: exercise 3 to 5 days a week', f: 1.55 },
    { id: 'active', label: 'Very active: daily training or a physical job', f: 1.725 },
  ];
  const DIETS = [
    { id: 'any', label: 'I eat everything', max: 3 },
    { id: 'egg', label: 'Vegetarian + eggs', max: 2 },
    { id: 'veg', label: 'Vegetarian', max: 1 },
    { id: 'vegan', label: 'Vegan', max: 0 },
  ];
  const SEX = [
    { id: '', label: 'Prefer not to say' },
    { id: 'female', label: 'Female' },
    { id: 'male', label: 'Male' },
    { id: 'other', label: 'Other' },
  ];
  const WEIGHT_DIRS = [
    { id: 'lose', label: 'Lose weight gradually' },
    { id: 'maintain', label: 'Maintain weight' },
    { id: 'gain', label: 'Gain weight or muscle' },
  ];

  /* ---------- pose illustrations ----------
     Small original pictures (not photos) used as the "how it looks" picture next to
     each exercise's step-by-step instructions. Every pose shares a 100x100 viewBox
     and is styled in styles.css into a small filled, coloured figure on a soft
     gradient card — no image files or network requests needed, and nothing to break
     the page's Content-Security-Policy. */
  const CATEGORY_COLORS = {
    strength: { body: '#e8590c', skin: '#ffd8a8', bg1: '#fff4e8', bg2: '#ffd8a8' },
    cardio: { body: '#e03131', skin: '#ffc9c9', bg1: '#fff1f1', bg2: '#ffc9c9' },
    desk: { body: '#1971c2', skin: '#a5d8ff', bg1: '#eaf5ff', bg2: '#a5d8ff' },
    yoga: { body: '#2f9e44', skin: '#b2f2bb', bg1: '#eefbf0', bg2: '#b2f2bb' },
    stretch: { body: '#9c36b5', skin: '#eebefa', bg1: '#f9f0fc', bg2: '#eebefa' },
  };
  const POSE = (inner) => '<svg class="pose-figure" viewBox="0 0 100 100" role="img" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">' +
    inner + '</svg>';
  const GROUND = '<line x1="10" y1="93" x2="90" y2="93" stroke-width="3" opacity=".35"/>';
  const POSES = {
    standing: POSE(GROUND + '<circle cx="50" cy="18" r="8"/><line x1="50" y1="26" x2="50" y2="60"/>' +
      '<line x1="50" y1="34" x2="34" y2="55"/><line x1="50" y1="34" x2="66" y2="55"/>' +
      '<line x1="50" y1="60" x2="38" y2="92"/><line x1="50" y1="60" x2="62" y2="92"/>'),
    reach: POSE(GROUND + '<circle cx="50" cy="20" r="8"/><line x1="50" y1="28" x2="50" y2="62"/>' +
      '<line x1="50" y1="32" x2="30" y2="10"/><line x1="50" y1="32" x2="70" y2="10"/>' +
      '<line x1="50" y1="62" x2="40" y2="92"/><line x1="50" y1="62" x2="60" y2="92"/>'),
    squat: POSE(GROUND + '<circle cx="50" cy="22" r="8"/><line x1="50" y1="30" x2="52" y2="52"/>' +
      '<line x1="50" y1="35" x2="28" y2="42"/><line x1="50" y1="35" x2="72" y2="42"/>' +
      '<line x1="52" y1="52" x2="32" y2="64"/><line x1="32" y1="64" x2="30" y2="90"/>' +
      '<line x1="52" y1="52" x2="72" y2="64"/><line x1="72" y1="64" x2="70" y2="90"/>'),
    lunge: POSE(GROUND + '<circle cx="46" cy="20" r="8"/><line x1="46" y1="28" x2="52" y2="54"/>' +
      '<line x1="47" y1="34" x2="30" y2="20"/><line x1="47" y1="34" x2="64" y2="46"/>' +
      '<line x1="52" y1="54" x2="72" y2="60"/><line x1="72" y1="60" x2="74" y2="90"/>' +
      '<line x1="52" y1="54" x2="34" y2="66"/><line x1="34" y1="66" x2="24" y2="92"/>'),
    bridge: POSE(GROUND + '<circle cx="18" cy="82" r="8"/><line x1="25" y1="80" x2="55" y2="60"/>' +
      '<line x1="55" y1="60" x2="80" y2="70"/><line x1="80" y1="70" x2="80" y2="92"/>' +
      '<line x1="55" y1="60" x2="34" y2="92"/><line x1="30" y1="80" x2="14" y2="66"/>'),
    superman: POSE(GROUND + '<circle cx="14" cy="50" r="8"/><path d="M21 52 Q50 72 86 50"/>' +
      '<line x1="21" y1="52" x2="6" y2="36"/><line x1="82" y1="51" x2="96" y2="34"/>'),
    plank: POSE(GROUND + '<circle cx="16" cy="48" r="8"/><line x1="23" y1="50" x2="80" y2="60"/>' +
      '<line x1="30" y1="52" x2="26" y2="90"/><line x1="80" y1="60" x2="90" y2="88"/>'),
    pushup: POSE(GROUND + '<circle cx="16" cy="52" r="8"/><line x1="23" y1="53" x2="80" y2="62"/>' +
      '<line x1="30" y1="54" x2="20" y2="76"/><line x1="20" y1="76" x2="26" y2="90"/>' +
      '<line x1="80" y1="62" x2="90" y2="88"/>'),
    walk: POSE(GROUND + '<circle cx="46" cy="18" r="8"/><line x1="47" y1="26" x2="53" y2="58"/>' +
      '<line x1="49" y1="34" x2="34" y2="26"/><line x1="49" y1="34" x2="66" y2="48"/>' +
      '<line x1="53" y1="58" x2="72" y2="66"/><line x1="72" y1="66" x2="78" y2="90"/>' +
      '<line x1="53" y1="58" x2="34" y2="68"/><line x1="34" y1="68" x2="24" y2="90"/>'),
    jump: POSE('<circle cx="50" cy="20" r="8"/><line x1="50" y1="28" x2="50" y2="58"/>' +
      '<line x1="50" y1="33" x2="20" y2="16"/><line x1="50" y1="33" x2="80" y2="16"/>' +
      '<line x1="50" y1="58" x2="26" y2="90"/><line x1="50" y1="58" x2="74" y2="90"/>'),
    boxing: POSE(GROUND + '<circle cx="50" cy="20" r="8"/><line x1="50" y1="28" x2="50" y2="60"/>' +
      '<line x1="50" y1="34" x2="30" y2="30"/><line x1="50" y1="32" x2="68" y2="46"/>' +
      '<line x1="50" y1="60" x2="40" y2="92"/><line x1="50" y1="60" x2="62" y2="88"/>'),
    highknee: POSE(GROUND + '<circle cx="48" cy="18" r="8"/><line x1="49" y1="26" x2="52" y2="56"/>' +
      '<line x1="50" y1="32" x2="30" y2="44"/><line x1="50" y1="32" x2="70" y2="24"/>' +
      '<line x1="52" y1="56" x2="34" y2="52"/><line x1="34" y1="52" x2="30" y2="34"/>' +
      '<line x1="52" y1="56" x2="66" y2="76"/><line x1="66" y1="76" x2="62" y2="92"/>'),
    stairs: POSE('<line x1="8" y1="92" x2="34" y2="92" stroke-width="3" opacity=".35"/>' +
      '<line x1="34" y1="92" x2="34" y2="76" stroke-width="3" opacity=".35"/><line x1="34" y1="76" x2="60" y2="76" stroke-width="3" opacity=".35"/>' +
      '<line x1="60" y1="76" x2="60" y2="60" stroke-width="3" opacity=".35"/><line x1="60" y1="60" x2="86" y2="60" stroke-width="3" opacity=".35"/>' +
      '<circle cx="58" cy="34" r="8"/><line x1="58" y1="42" x2="60" y2="66"/>' +
      '<line x1="58" y1="48" x2="42" y2="42"/><line x1="58" y1="46" x2="72" y2="34"/>' +
      '<line x1="60" y1="66" x2="72" y2="60"/><line x1="60" y1="66" x2="48" y2="80"/><line x1="48" y1="80" x2="46" y2="92"/>'),
    neck: POSE('<circle cx="50" cy="24" r="9" transform="rotate(18 50 24)"/><line x1="50" y1="33" x2="50" y2="68"/>' +
      '<line x1="50" y1="40" x2="34" y2="58"/><line x1="50" y1="40" x2="66" y2="58"/>' +
      '<path d="M62 14 a14 14 0 0 1 6 10" opacity=".55" stroke-width="3.5"/>'),
    shoulder: POSE('<circle cx="50" cy="20" r="8"/><line x1="50" y1="28" x2="50" y2="68"/>' +
      '<path d="M34 34 a16 16 0 1 1 4 14" opacity=".55" stroke-width="3.5"/>' +
      '<path d="M66 34 a16 16 0 1 0 -4 14" opacity=".55" stroke-width="3.5"/>' +
      '<line x1="50" y1="68" x2="40" y2="92"/><line x1="50" y1="68" x2="60" y2="92"/>'),
    wrist: POSE('<line x1="20" y1="70" x2="58" y2="50"/>' +
      '<path d="M58 50 c10 -14 24 -12 30 -2"/><path d="M66 44 l6 -8 M74 40 l4 -9 M82 40 l2 -9"/>' +
      '<path d="M22 78 a10 10 0 0 0 14 4" opacity=".55" stroke-width="3.5"/>'),
    twist: POSE(GROUND + '<circle cx="58" cy="20" r="8"/><line x1="50" y1="30" x2="50" y2="62"/>' +
      '<line x1="50" y1="36" x2="70" y2="30"/><line x1="50" y1="36" x2="34" y2="46"/>' +
      '<line x1="50" y1="62" x2="36" y2="90"/><line x1="50" y1="62" x2="64" y2="90"/>' +
      '<path d="M60 30 a12 12 0 0 0 6 -8" opacity=".55" stroke-width="3.5"/>'),
    eye: POSE('<path d="M12 50 C 30 24, 70 24, 88 50 C 70 76, 30 76, 12 50 Z"/>' +
      '<circle cx="50" cy="50" r="12"/><circle cx="50" cy="50" r="3.5" fill="currentColor"/>'),
    calfraise: POSE(GROUND + '<circle cx="50" cy="18" r="8"/><line x1="50" y1="26" x2="50" y2="58"/>' +
      '<line x1="50" y1="32" x2="34" y2="46"/><line x1="50" y1="32" x2="66" y2="46"/>' +
      '<line x1="50" y1="58" x2="42" y2="86"/><line x1="42" y1="86" x2="52" y2="90"/>' +
      '<line x1="50" y1="58" x2="58" y2="86"/><line x1="58" y1="86" x2="68" y2="90"/>'),
    childpose: POSE(GROUND + '<circle cx="82" cy="76" r="8"/><line x1="76" y1="72" x2="30" y2="58"/>' +
      '<line x1="30" y1="58" x2="14" y2="66"/><line x1="30" y1="58" x2="14" y2="50"/>' +
      '<line x1="76" y1="72" x2="76" y2="92"/>'),
    catcow: POSE(GROUND + '<circle cx="86" cy="46" r="8"/><path d="M80 50 Q 50 30, 20 50"/>' +
      '<line x1="20" y1="50" x2="20" y2="90"/><line x1="34" y1="46" x2="34" y2="90"/>' +
      '<line x1="72" y1="46" x2="72" y2="90"/><line x1="80" y1="50" x2="80" y2="90"/>'),
    downdog: POSE(GROUND + '<circle cx="78" cy="70" r="8"/><path d="M72 66 L 40 30 L 14 90"/>' +
      '<line x1="40" y1="30" x2="66" y2="90"/><line x1="72" y1="66" x2="90" y2="90"/>'),
    warrior: POSE(GROUND + '<circle cx="44" cy="18" r="8"/><line x1="45" y1="26" x2="52" y2="55"/>' +
      '<line x1="48" y1="30" x2="20" y2="18"/><line x1="48" y1="30" x2="76" y2="18"/>' +
      '<line x1="52" y1="55" x2="76" y2="60"/><line x1="76" y1="60" x2="80" y2="90"/>' +
      '<line x1="52" y1="55" x2="30" y2="66"/><line x1="30" y1="66" x2="18" y2="92"/>'),
    breathing: POSE('<circle cx="50" cy="24" r="8"/><line x1="50" y1="32" x2="50" y2="62"/>' +
      '<line x1="50" y1="40" x2="32" y2="50"/><line x1="50" y1="40" x2="68" y2="50"/>' +
      '<line x1="50" y1="62" x2="30" y2="80"/><line x1="30" y1="80" x2="70" y2="80"/><line x1="70" y1="80" x2="50" y2="62"/>' +
      '<path d="M18 30 q6 -8 0 -16 M82 30 q-6 -8 0 -16" opacity=".5" stroke-width="3.5"/>'),
    butterfly: POSE('<circle cx="50" cy="22" r="8"/><line x1="50" y1="30" x2="50" y2="58"/>' +
      '<line x1="50" y1="36" x2="34" y2="48"/><line x1="50" y1="36" x2="66" y2="48"/>' +
      '<path d="M50 58 Q30 62 26 78 Q40 80 50 66 Q60 80 74 78 Q70 62 50 58 Z"/>'),
    seatedreach: POSE('<circle cx="70" cy="22" r="8"/><line x1="66" y1="30" x2="46" y2="55"/>' +
      '<line x1="60" y1="38" x2="30" y2="46"/><line x1="46" y1="55" x2="16" y2="60"/>' +
      '<line x1="46" y1="55" x2="52" y2="78"/><line x1="52" y1="78" x2="76" y2="80"/>'),
  };

  /* ---------- exercises ---------- */
  // pose: id into POSES above, used to show a small how-it-looks illustration next to the steps.
  const E = (id, name, cat, level, min, pts, icon, focus, steps, pose) => ({
    id, name, cat, level, min, pts, icon, focus, steps: steps.split('|'), pose: pose || 'standing',
  });

  const EXERCISES = [
    // strength
    E('squats', 'Bodyweight squats', 'strength', 'beginner', 5, 20, '🦵', 'Legs and glutes',
      'Stand with your feet shoulder-width apart|Push your hips back and bend your knees|Keep your chest up and your heels flat|Stand tall by pushing through your heels|Aim for 3 sets of 12', 'squat'),
    E('wall-pushups', 'Wall push-ups', 'strength', 'beginner', 4, 15, '🧱', 'Chest, shoulders and arms',
      'Stand an arm’s length from a wall|Place your hands on the wall at shoulder height|Bend your elbows to bring your chest toward the wall|Press back to the start|Aim for 3 sets of 10', 'pushup'),
    E('glute-bridge', 'Glute bridges', 'strength', 'beginner', 5, 20, '🌉', 'Glutes, hamstrings and lower back',
      'Lie on your back with knees bent and feet flat|Press through your heels and lift your hips|Squeeze your glutes at the top for 2 seconds|Lower slowly|Aim for 3 sets of 12', 'bridge'),
    E('back-extension', 'Back extensions', 'strength', 'beginner', 4, 15, '🦸', 'Lower back and glutes',
      'Lie face down with your arms extended|Lift your arms, chest and legs slightly off the floor|Hold for 2 seconds|Lower slowly|Aim for 3 sets of 10', 'superman'),
    E('lunges', 'Alternating lunges', 'strength', 'beginner', 6, 25, '🚶', 'Legs and balance',
      'Step forward and lower until both knees are near 90 degrees|Keep your front knee over your ankle|Push back to standing|Switch legs|Aim for 3 sets of 10 per leg', 'lunge'),
    E('pushups', 'Push-ups', 'strength', 'intermediate', 5, 25, '💪', 'Chest, shoulders, triceps and core',
      'Start in a high plank with your hands under your shoulders|Keep your body in a straight line|Lower your chest to just above the floor|Press back up|Drop to your knees if you need to. Aim for 3 sets of 8 to 12', 'pushup'),
    E('plank', 'Plank holds', 'strength', 'intermediate', 4, 20, '🪵', 'Core and shoulders',
      'Rest on your forearms with your elbows under your shoulders|Lift your hips so your body forms a straight line|Brace your core and keep breathing|Hold for 30 seconds, rest for 30, and repeat', 'plank'),

    // cardio
    E('brisk-walk', 'Brisk walk', 'cardio', 'beginner', 15, 30, '👟', 'Heart and legs',
      'Walk at a pace where you can talk but not sing|Swing your arms and keep your shoulders relaxed|Look ahead, not down|Keep the pace steady for the full time', 'walk'),
    E('jumping-jacks', 'Jumping jacks', 'cardio', 'beginner', 5, 25, '⭐', 'Full-body warm-up',
      'Stand with your feet together and arms at your sides|Jump your feet wide while raising your arms overhead|Jump back to the start|Keep a steady rhythm, or step instead of jumping for low impact', 'jump'),
    E('shadow-boxing', 'Shadow boxing', 'cardio', 'beginner', 6, 30, '🥊', 'Shoulders, core and heart',
      'Stand with your feet shoulder-width apart and knees soft|Throw jabs and crosses at a steady tempo|Add a slip or a step side to side|Keep your hands up and breathe out with each punch', 'boxing'),
    E('high-knees', 'High knees', 'cardio', 'intermediate', 4, 25, '🏃', 'Heart, hip flexors and core',
      'Stand tall with your feet hip-width apart|Drive one knee up to hip height|Switch quickly, pumping your arms|Land softly on the balls of your feet|Go 30 seconds on, 30 seconds off', 'highknee'),
    E('stair-climb', 'Stair climb', 'cardio', 'intermediate', 8, 35, '🪜', 'Legs and heart',
      'Find a flight of stairs|Climb at a steady pace, placing your whole foot on each step|Walk down slowly|Hold the rail if you need it|Repeat for the full time', 'stairs'),
    E('skipping', 'Skipping rope', 'cardio', 'intermediate', 8, 40, '🪢', 'Calves, shoulders and heart',
      'Hold the handles at hip height|Turn the rope with your wrists, not your arms|Jump just high enough to clear the rope|Land softly and rest when your form slips', 'jump'),

    // desk
    E('neck-rolls', 'Neck rolls', 'desk', 'beginner', 2, 10, '🙆', 'Neck and upper shoulders',
      'Sit tall with your shoulders relaxed|Drop your right ear toward your right shoulder for 15 seconds|Switch sides|Slowly roll your chin toward your chest and side to side. Never force the movement', 'neck'),
    E('shoulder-rolls', 'Shoulder rolls', 'desk', 'beginner', 2, 10, '🔄', 'Shoulders and upper back',
      'Sit or stand tall|Lift your shoulders toward your ears|Roll them back and down in a slow circle|Do 10 backward, then 10 forward', 'shoulder'),
    E('wrist-stretch', 'Wrist and finger stretch', 'desk', 'beginner', 2, 10, '🤲', 'Wrists, forearms and fingers',
      'Extend one arm with the palm up|Gently pull your fingers back with your other hand for 15 seconds|Flip your palm down and press the hand toward you|Switch arms', 'wrist'),
    E('seated-twist', 'Seated spinal twist', 'desk', 'beginner', 3, 10, '🌀', 'Spine and sides of the waist',
      'Sit tall with both feet on the floor|Place your right hand on your left knee|Rotate your torso to the left and look over your shoulder|Hold for 20 seconds, breathe, then switch sides', 'twist'),
    E('chair-squats', 'Chair squats', 'desk', 'beginner', 3, 15, '🪑', 'Legs and glutes',
      'Stand in front of your chair with your feet hip-width apart|Lower your hips until you lightly touch the seat|Stand back up without using your hands|Do 2 sets of 10', 'squat'),
    E('desk-pushups', 'Desk push-ups', 'desk', 'beginner', 3, 15, '🖥️', 'Chest, arms and core',
      'Place your hands on the edge of a sturdy desk|Step back until your body is in a straight line|Lower your chest toward the desk, then press away|Do 2 sets of 10', 'pushup'),
    E('eye-reset', '20-20-20 eye reset', 'desk', 'beginner', 2, 10, '👀', 'Eyes',
      'Look at something about 20 feet (6 m) away|Hold your gaze for 20 seconds|Blink slowly 10 times|Close your eyes and take three deep breaths', 'eye'),
    E('calf-raises', 'Standing calf raises', 'desk', 'beginner', 2, 10, '🦶', 'Calves and ankles',
      'Stand behind your chair with your hands on the back for balance|Rise onto your toes|Pause for a second at the top|Lower slowly and do 3 sets of 15', 'calfraise'),

    // yoga
    E('sun-salutation', 'Sun salutation', 'yoga', 'beginner', 8, 30, '🌅', 'Whole body',
      'Stand tall with your palms together at your chest|Inhale and reach your arms overhead|Exhale and fold forward|Step back to plank, lower down, then lift into cobra|Push back to downward dog, walk your feet forward, and rise|Repeat for 5 rounds at your own pace', 'reach'),
    E('child-pose', 'Child’s pose', 'yoga', 'beginner', 4, 15, '🧎', 'Back, hips and shoulders',
      'Kneel with your big toes touching and knees apart|Sit your hips back toward your heels|Stretch your arms forward and rest your forehead down|Breathe slowly for 1 to 2 minutes', 'childpose'),
    E('cat-cow', 'Cat-cow flow', 'yoga', 'beginner', 4, 15, '🐈', 'Spine and core',
      'Start on your hands and knees|Inhale, drop your belly and lift your chest (cow)|Exhale and round your spine toward the ceiling (cat)|Move slowly with your breath for 10 rounds', 'catcow'),
    E('down-dog', 'Downward dog flow', 'yoga', 'beginner', 5, 20, '🐕', 'Hamstrings, shoulders and spine',
      'Start on your hands and knees|Tuck your toes and lift your hips up and back|Press the floor away and lengthen your spine|Bend your knees if your hamstrings feel tight|Hold for 5 breaths, rest, and repeat', 'downdog'),
    E('warrior', 'Warrior sequence', 'yoga', 'intermediate', 8, 30, '🏹', 'Legs, hips and balance',
      'Step one foot back into a long stance with the back foot turned out|Bend your front knee and raise your arms (Warrior I)|Open your hips and arms to the side (Warrior II)|Hold each for 5 breaths, then switch sides', 'warrior'),
    E('box-breathing', 'Box breathing', 'yoga', 'beginner', 4, 15, '🌬️', 'Calm and focus',
      'Sit comfortably with a tall spine|Inhale through your nose for 4 counts|Hold for 4 counts|Exhale slowly for 4 counts|Hold empty for 4 counts and repeat', 'breathing'),

    // mobility
    E('hip-opener', 'Hip opener stretch', 'stretch', 'beginner', 5, 15, '🦋', 'Hips and inner thighs',
      'Sit with the soles of your feet together|Hold your ankles and sit tall|Gently press your knees toward the floor|Hold for 30 seconds, breathing slowly', 'butterfly'),
    E('hamstring', 'Hamstring stretch', 'stretch', 'beginner', 4, 15, '🦿', 'Back of the legs',
      'Sit with one leg extended and the other foot against your thigh|Hinge forward from your hips with a flat back|Hold for 30 seconds at a mild stretch|Switch legs', 'seatedreach'),
    E('full-body-stretch', 'Full-body stretch', 'stretch', 'beginner', 8, 20, '🤸', 'Whole body',
      'Reach your arms overhead and lengthen your body|Fold forward and let your head hang|Roll up slowly, one vertebra at a time|Clasp your hands behind you and open your chest|Finish with a side bend each way', 'reach'),
    E('thoracic', 'Upper-back opener', 'stretch', 'beginner', 4, 15, '🔓', 'Upper back and chest',
      'Sit or kneel and place your hands behind your head|Gently arch upward, opening your chest|Rotate your elbows from side to side|Do 10 slow reps', 'shoulder'),
  ];

  /* ---------- weekly plans (Monday first) ---------- */
  const REST = { t: 'Rest day', ex: [] };
  const PLANS = [
    {
      id: 'kickstart', name: '7-Day Kickstart', level: 'beginner',
      blurb: 'Gentle, varied days to build the habit.',
      days: [
        { t: 'Walk and stretch', ex: ['brisk-walk', 'full-body-stretch'] },
        { t: 'Lower body basics', ex: ['squats', 'glute-bridge'] },
        { t: 'Breathe and reset', ex: ['box-breathing', 'cat-cow'] },
        { t: 'Cardio burst', ex: ['jumping-jacks', 'shadow-boxing'] },
        { t: 'Upper body basics', ex: ['wall-pushups', 'plank'] },
        { t: 'Easy flow', ex: ['sun-salutation'] },
        REST,
      ],
    },
    {
      id: 'desk-reset', name: 'Desk Reset', level: 'beginner',
      blurb: 'Short breaks for people who sit most of the day.',
      days: [
        { t: 'Neck and shoulders', ex: ['neck-rolls', 'shoulder-rolls', 'eye-reset'] },
        { t: 'Wake up your legs', ex: ['chair-squats', 'calf-raises'] },
        { t: 'Wrists and back', ex: ['wrist-stretch', 'seated-twist', 'thoracic'] },
        { t: 'Desk strength', ex: ['desk-pushups', 'chair-squats'] },
        { t: 'Hips and hamstrings', ex: ['hip-opener', 'hamstring'] },
        { t: 'Walk it out', ex: ['brisk-walk'] },
        REST,
      ],
    },
    {
      id: 'home-strength', name: 'Home Strength', level: 'intermediate',
      blurb: 'Strength work with no equipment needed.',
      days: [
        { t: 'Push and core', ex: ['pushups', 'plank'] },
        { t: 'Legs', ex: ['squats', 'lunges', 'glute-bridge'] },
        { t: 'Active recovery', ex: ['brisk-walk', 'full-body-stretch'] },
        { t: 'Full body', ex: ['pushups', 'lunges', 'back-extension'] },
        { t: 'Cardio finisher', ex: ['high-knees', 'skipping'] },
        { t: 'Mobility', ex: ['down-dog', 'hip-opener'] },
        REST,
      ],
    },
    {
      id: 'calm-flexible', name: 'Calm and Flexible', level: 'beginner',
      blurb: 'Yoga and breathing for stress and stiffness.',
      days: [
        { t: 'Gentle flow', ex: ['cat-cow', 'child-pose'] },
        { t: 'Breath and focus', ex: ['box-breathing', 'thoracic'] },
        { t: 'Sun salutations', ex: ['sun-salutation'] },
        { t: 'Hips open', ex: ['hip-opener', 'down-dog'] },
        { t: 'Balance', ex: ['warrior', 'box-breathing'] },
        { t: 'Full-body release', ex: ['full-body-stretch', 'child-pose'] },
        REST,
      ],
    },
  ];

  /* ---------- meal ideas ----------
     t: 0 vegan, 1 vegetarian, 2 contains egg, 3 contains meat or fish. k: approx kcal.
     g: guideline tags (see GUIDE_TAGS below) — which WHO healthy-eating goals this
     meal leans on, shown as small chips so a day of meals visibly works toward
     fruit & veg, whole grains and protein rather than just listing the guidance. */
  const M = (n, k, t, g) => ({ n, k, t, g: g || [] });
  const GUIDE_TAGS = {
    veg: { icon: '🥦', label: 'Fruit & veg' },
    grain: { icon: '🌾', label: 'Whole grain' },
    protein: { icon: '💪', label: 'Protein' },
  };
  const MEALS = {
    breakfast: [
      M('Vegetable poha with peanuts', 320, 0, ['veg', 'grain']),
      M('Besan chilla with mint chutney', 300, 0, ['veg', 'protein']),
      M('Moong dal cheela with tomato', 280, 0, ['veg', 'protein']),
      M('Peanut butter banana toast', 340, 0, ['veg', 'grain']),
      M('Oats with banana and nuts', 350, 1, ['grain', 'veg']),
      M('Greek yogurt bowl with berries and seeds', 300, 1, ['veg', 'protein']),
      M('Masala omelette with 2 multigrain toasts', 380, 2, ['protein', 'grain']),
      M('Scrambled eggs with spinach and toast', 360, 2, ['protein', 'veg']),
      M('Chicken and veggie wrap', 420, 3, ['protein', 'veg']),
    ],
    lunch: [
      M('Dal, brown rice and sabzi with salad', 520, 0, ['veg', 'grain']),
      M('Chickpea and quinoa salad bowl', 480, 0, ['veg', 'protein']),
      M('Tofu stir-fry with noodles', 480, 0, ['veg', 'protein']),
      M('Rajma with rice and cucumber raita', 540, 1, ['protein', 'veg']),
      M('Paneer tikka wrap with salad', 500, 1, ['protein', 'veg']),
      M('Egg curry with 2 rotis and salad', 520, 2, ['protein', 'veg']),
      M('Grilled chicken, rice and vegetables', 550, 3, ['protein', 'veg']),
      M('Fish curry with rice and greens', 540, 3, ['protein', 'veg']),
    ],
    snack: [
      M('Roasted chana and a piece of fruit', 180, 0, ['veg', 'protein']),
      M('Handful of almonds and walnuts', 170, 0, ['protein']),
      M('Sprouts chaat', 160, 0, ['veg', 'protein']),
      M('Roasted makhana', 130, 0, ['grain']),
      M('Apple slices with peanut butter', 220, 0, ['veg', 'protein']),
      M('Curd with cucumber', 120, 1, ['veg', 'protein']),
      M('2 boiled eggs', 150, 2, ['protein']),
    ],
    dinner: [
      M('Mixed vegetable soup, roti and dal', 420, 0, ['veg', 'grain']),
      M('Lentil soup with grilled tofu salad', 400, 0, ['veg', 'protein']),
      M('Vegetable stir-fry with brown rice', 430, 0, ['veg', 'grain']),
      M('Vegetable khichdi with curd', 430, 1, ['veg', 'grain']),
      M('Palak paneer with 2 rotis', 480, 1, ['veg', 'protein']),
      M('Egg bhurji with roti and salad', 430, 2, ['protein', 'veg']),
      M('Grilled fish with sautéed vegetables', 450, 3, ['protein', 'veg']),
      M('Chicken curry with 2 rotis', 520, 3, ['protein', 'grain']),
    ],
  };
  const SLOTS = [
    { id: 'breakfast', label: 'Breakfast' },
    { id: 'lunch', label: 'Lunch' },
    { id: 'snack', label: 'Snack' },
    { id: 'dinner', label: 'Dinner' },
  ];

  /* ---------- badges: unlocked when metrics[metric] >= target ---------- */
  const BADGES = [
    { id: 'first-step', icon: '🌱', name: 'First Step', desc: 'Complete your first session', metric: 'sessions', target: 1 },
    { id: 'desk-hero', icon: '🪑', name: 'Desk Break Hero', desc: 'Complete 10 desk sessions', metric: 'deskSessions', target: 10 },
    { id: 'yoga-beginner', icon: '🧘', name: 'Yoga Beginner', desc: 'Complete 5 yoga sessions', metric: 'yogaSessions', target: 5 },
    { id: 'streak-7', icon: '🔥', name: '7-Day Streak', desc: 'Move on 7 days in a row', metric: 'longestStreak', target: 7 },
    { id: 'consistency', icon: '⚡', name: 'Consistency King', desc: 'Complete 30 sessions', metric: 'sessions', target: 30 },
    { id: 'athlete', icon: '🏅', name: 'Active Athlete', desc: 'Earn 500 points', metric: 'points', target: 500 },
    { id: 'champion', icon: '🏆', name: 'Champion', desc: 'Earn 1,000 points', metric: 'points', target: 1000 },
    { id: 'nutrition', icon: '🥗', name: 'Nutrition Starter', desc: 'Save your first meal plan', metric: 'mealPlans', target: 1 },
    { id: 'hydration', icon: '💧', name: 'Hydration Habit', desc: 'Log water on 7 different days', metric: 'hydrationDays', target: 7 },
  ];

  /* ---------- guided routines: exercises played back to back ---------- */
  const ROUTINES = [
    { id: 'quick-desk', name: 'Quick desk reset', cat: 'desk', blurb: 'Neck, wrists and eyes without leaving your chair.', ex: ['neck-rolls', 'wrist-stretch', 'eye-reset'] },
    { id: 'posture-fix', name: 'Posture fix', cat: 'desk', blurb: 'Undo hours of hunching.', ex: ['shoulder-rolls', 'seated-twist', 'thoracic'] },
    { id: 'sitting-legs', name: 'Long-sitting legs', cat: 'desk', blurb: 'Wake your legs up after a long sit.', ex: ['chair-squats', 'calf-raises', 'hip-opener'] },
    { id: 'morning-flow', name: 'Morning flow', cat: 'yoga', blurb: 'A gentle start to the day.', ex: ['cat-cow', 'child-pose', 'sun-salutation'] },
    { id: 'evening-unwind', name: 'Evening unwind', cat: 'yoga', blurb: 'Slow down before bed.', ex: ['box-breathing', 'child-pose', 'hip-opener'] },
    { id: 'cardio-burst', name: 'Cardio burst', cat: 'cardio', blurb: 'Get your heart rate up fast.', ex: ['jumping-jacks', 'high-knees', 'shadow-boxing'] },
    { id: 'no-gear-strength', name: 'No-gear strength', cat: 'strength', blurb: 'Legs, glutes and arms with no equipment.', ex: ['squats', 'glute-bridge', 'wall-pushups'] },
  ];

  /* ---------- copy ---------- */
  const TIPS = [
    'Breaking up long sitting with a couple of minutes of movement every hour is kind to your back and your energy.',
    'Pair a new habit with an old one: stretch while the kettle boils or the laptop starts up.',
    'A 10-minute walk after a meal is one of the easiest habits to keep.',
    'If you have 5 minutes, you have a workout. Short sessions still count toward your streak.',
    'Sleep is training too. Aim for a consistent bedtime before adding more exercise.',
    'Drink a glass of water when you wake up. It is a simple cue for the rest of the day.',
    'Soreness is normal; sharp pain is not. Stop and rest if something hurts.',
    'Track minutes, not perfection. A missed day is only a problem if it becomes two.',
    'Protein at each meal helps recovery and keeps you full for longer.',
    'A minute of slow breathing can help you feel calmer.',
  ];
  const NUDGES = [
    '🪑 Been sitting a while? Stand up and stretch for two minutes.',
    '💧 A glass of water now beats a coffee later.',
    '🚶 A 10-minute walk counts. Start there.',
    '🌬️ Three slow breaths can reset a stressful moment.',
    '👀 Look away from your screen for 20 seconds.',
    '🔥 Small sessions add up. Show up today.',
  ];

  FL.data = {
    APP_NAME: 'FitLife',
    WEEKLY_GOAL_MIN: 150, // WHO guideline for adults: 150 minutes of moderate activity per week
    CATEGORIES, LEVELS, OCCUPATIONS, SEATED, GOALS, ACTIVITY, DIETS, SEX, WEIGHT_DIRS,
    EXERCISES, PLANS, ROUTINES, MEALS, SLOTS, BADGES, TIPS, NUDGES,
    POSES, CATEGORY_COLORS, GUIDE_TAGS,
  };
})();
