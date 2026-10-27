/*
 * Шар-пиньята главной — глобус пузырей из шапки офлайна игры, переписанный для сайта:
 * шар крутится, по нему растут и лопаются пузыри с картинками планет. Его таскают по всему
 * окну, бросают смахом (летит и отскакивает от краёв, гаснет, как камень), раздувают и
 * ужимают двумя пальцами или колесом мыши. Тап шар лопает: пузыри разлетаются, а дома
 * вырастает новый. Числа — те же, что у игры.
 */
(() => {
  const home = document.getElementById('globe-home');
  if (!home) return;

  const PICTURES = [
    'mars',
    'venus',
    'earth',
    'cannon',
    'neptune',
    'avenger',
    'uranus',
    'saturn',
    'hole',
    'jupiter',
    'stone',
  ];
  const RING_COUNT = 150;
  const TURN_MS = 10000;
  const AXIS_TILT = 0.35;
  const UPRIGHT_TILT = Math.PI / 4;
  const BACK_ALPHA = 0.45;
  const FRONT_ALPHA = 0.35;
  const GROW_RAD_PER_S = 0.077;
  const POP_MS = 450;
  const APPEAR_MS = 120;
  const POP_SWELL = 0.5;
  const SPARK_COUNT = 6;
  const SPARK_REACH = 0.6;
  const SPARK_R = 0.8;
  const SPARK_COLORS = ['#f2c14e', '#e0315a', '#5b5bd6', '#2a9fb8', '#ffffff'];
  const MIN_ANGLE = 0.004;
  const SEED = 20261009;

  const MAX_SCALE = 1;
  const MIN_SCALE = 0.2;
  const RETURN_TAU_MS = 300;
  const TAP_SLOP = 10;
  const TAP_MS = 300;
  /** Колесо: на сколько меняется размер за пиксель прокрутки. */
  const WHEEL_RATE = 0.005;
  /** Щипок действует сильнее разводки пальцев: весь размах — за одно движение. */
  const PINCH_POWER = 2.5;
  /** Лопнувший шар: пузыри разлетаются столько мс, потом пауза до нового шара. */
  const BURST_MS = 700;
  const REBORN_MS = 600;
  /** На сколько радиусов шара разлетаются пузыри. */
  const BURST_REACH = 1.6;
  const FLING_WINDOW_MS = 80;
  const FLING_MIN_SPEED = 400;
  const REST_SPEED = 15;
  const DRAG_DECAY = 0.988;
  const SIDE_WALL_DAMPING = 0.85;
  const DECAY_FRAME_MS = 1000 / 60;

  const images = {};
  for (const name of PICTURES) {
    const image = new Image();
    image.src = new URL(`assets/globe/${name}.png`, document.currentScript.src).href;
    images[name] = image;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  const hit = document.createElement('div');
  hit.className = 'globe-hit';
  hit.setAttribute('aria-hidden', 'true');
  document.body.append(canvas, hit);
  const ctx = canvas.getContext('2d');

  function randomOf(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const smooth = (p) => p * p * (3 - 2 * p);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (p) => {
    const n = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / n, p[1] / n, p[2] / n];
  };

  // Пузырей мелких много, крупных мало.
  const rings = [];
  {
    const random = randomOf(SEED);
    for (let index = 0; index < RING_COUNT; index++) {
      const a = 0.03 + 0.24 * random() ** 3;
      const lifeMs = (a / GROW_RAD_PER_S) * 1000 + POP_MS;
      rings.push({
        index,
        a,
        lifeMs,
        spark: SPARK_COLORS[index % SPARK_COLORS.length],
        offsetMs: random() * lifeMs,
        life: NaN,
        spot: null,
      });
    }
  }

  function spotOf(index, life) {
    const random = randomOf(SEED + index * 7919 + life * 104729);
    const z = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const c = [r * Math.cos(phi), z, r * Math.sin(phi)];
    const helper = Math.abs(z) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(helper, c));
    return { c, u, v: cross(c, u) };
  }

  function viewAt(now) {
    const turn = ((now % TURN_MS) / TURN_MS) * Math.PI * 2;
    const cy = Math.cos(turn),
      sy = Math.sin(turn);
    const ct = Math.cos(AXIS_TILT),
      st = Math.sin(AXIS_TILT);
    return (p) => {
      const px = p[0] * cy + p[2] * sy;
      const pz = -p[0] * sy + p[2] * cy;
      return [px, p[1] * ct - pz * st, p[1] * st + pz * ct];
    };
  }

  /** Растёт из точки с ровной скоростью, потом хлопает. */
  function bubbleOf(ring, now) {
    const age = (now + ring.offsetMs) / ring.lifeMs;
    const life = Math.floor(age);
    const ms = (age - life) * ring.lifeMs;
    if (ring.life !== life) {
      ring.life = life;
      ring.spot = spotOf(ring.index, life);
    }
    const growMs = ring.lifeMs - POP_MS;
    if (ms < growMs) {
      return { a: ring.a * (ms / growMs), alpha: smooth(Math.min(1, ms / APPEAR_MS)), pop: null };
    }
    const pop = (ms - growMs) / POP_MS;
    const p = smooth(pop);
    return { a: ring.a * (1 + POP_SWELL * p), alpha: 1 - p, pop };
  }

  /** Верх картинки смотрит вверх экрана с наклоном не больше `UPRIGHT_TILT`. */
  function upright(u, v) {
    const screenUp = Math.atan2(v[1], u[1]);
    const off = Math.atan2(Math.sin(Math.PI / 2 - screenUp), Math.cos(Math.PI / 2 - screenUp));
    const up = screenUp + Math.max(-UPRIGHT_TILT, Math.min(UPRIGHT_TILT, off));
    const cos = Math.cos(up + Math.PI / 2),
      sin = Math.sin(up + Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const ui = u[i],
        vi = v[i];
      u[i] = ui * cos + vi * sin;
      v[i] = vi * cos - ui * sin;
    }
  }

  // Хватка: сдвиг от дома, размер, полёт, пальцы.
  let dx = 0,
    dy = 0,
    scale = 1;
  let flight = null;
  let homing = false;
  let pinched = false;
  let touch = null;
  /** Миг, когда шар лопнул; `null` — шар цел. */
  let burstAt = null;
  const fingers = new Map();

  function homeCircle() {
    const rect = home.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 };
  }

  function circle() {
    const h = homeCircle();
    return { x: h.x + dx, y: h.y + dy, r: h.r * scale };
  }

  function within(value, low, high) {
    if (low > high) return (low + high) / 2;
    return Math.min(high, Math.max(low, value));
  }

  function clampToScreen() {
    const h = homeCircle();
    const r = h.r * Math.min(1, scale);
    dx = within(dx, r - h.x, innerWidth - r - h.x);
    dy = within(dy, r - h.y, innerHeight - r - h.y);
  }

  function held() {
    return fingers.size > 0;
  }

  // Пока шар держат, второй палец где угодно — щипок, а не прокрутка страницы.
  function setHeldStyle() {
    document.documentElement.style.touchAction = held() ? 'none' : '';
  }

  function press(e, onGlobe) {
    if (burstAt !== null) return;
    if (!onGlobe && !held()) return;
    if (fingers.size >= 2 && !fingers.has(e.pointerId)) return;
    e.preventDefault();
    flight = null;
    homing = false;
    const at = performance.now();
    if (!held()) {
      pinched = false;
      touch = { x: e.clientX, y: e.clientY, at, moved: false };
    }
    fingers.set(e.pointerId, [{ x: e.clientX, y: e.clientY, at }]);
    if (fingers.size === 2) pinched = true;
    setHeldStyle();
  }

  function move(e) {
    const trail = fingers.get(e.pointerId);
    if (!trail) return;
    e.preventDefault();
    const was = trail[trail.length - 1];
    const otherTrail = [...fingers].find(([key]) => key !== e.pointerId)?.[1];
    const other = otherTrail?.[otherTrail.length - 1];
    const at = performance.now();
    const x = e.clientX,
      y = e.clientY;
    trail.push({ x, y, at });
    while (trail.length > 2 && at - trail[0].at > FLING_WINDOW_MS) trail.shift();
    if (touch && Math.hypot(x - touch.x, y - touch.y) > TAP_SLOP) touch.moved = true;
    if (!other) {
      dx += x - was.x;
      dy += y - was.y;
    } else {
      dx += (x - was.x) / 2;
      dy += (y - was.y) / 2;
      const before = Math.hypot(was.x - other.x, was.y - other.y);
      const after = Math.hypot(x - other.x, y - other.y);
      if (before > 0)
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (after / before) ** PINCH_POWER));
    }
    clampToScreen();
  }

  function tapped(at) {
    const t = touch;
    touch = null;
    if (!t || t.moved || at - t.at > TAP_MS) return false;
    burstAt = at;
    flight = null;
    homing = false;
    return true;
  }

  /** Новый шар дома: растёт из точки. */
  function reborn() {
    burstAt = null;
    dx = 0;
    dy = 0;
    scale = 0.02;
    homing = true;
  }

  function release(e) {
    const trail = fingers.get(e.pointerId);
    if (!trail) return;
    fingers.delete(e.pointerId);
    setHeldStyle();
    if (held() || pinched) return;
    const at = performance.now();
    if (tapped(at)) return;
    const first = trail[0],
      last = trail[trail.length - 1];
    if (last.at <= first.at) return;
    const seconds = (last.at - first.at) / 1000;
    const vx = (last.x - first.x) / seconds;
    const vy = (last.y - first.y) / seconds;
    if (Math.hypot(vx, vy) >= FLING_MIN_SPEED) flight = { vx, vy };
  }

  function step(ms) {
    if (ms <= 0 || held()) return;
    if (flight) fly(ms);
    if (!homing) return;
    const keep = Math.exp(-ms / RETURN_TAU_MS);
    scale = 1 + (scale - 1) * keep;
    dx *= keep;
    dy *= keep;
    if (Math.abs(scale - 1) < 0.002) scale = 1;
    if (Math.abs(dx) < 0.3) dx = 0;
    if (Math.abs(dy) < 0.3) dy = 0;
    if (scale === 1 && dx === 0 && dy === 0) homing = false;
  }

  function fly(ms) {
    const h = homeCircle();
    const r = h.r * scale;
    dx += (flight.vx * ms) / 1000;
    dy += (flight.vy * ms) / 1000;
    const decay = DRAG_DECAY ** (ms / DECAY_FRAME_MS);
    flight.vx *= decay;
    flight.vy *= decay;
    const left = r - h.x,
      right = innerWidth - r - h.x;
    const top = r - h.y,
      bottom = innerHeight - r - h.y;
    if (dx < left || dx > right) {
      dx = Math.min(right, Math.max(left, dx));
      flight.vx = -flight.vx * SIDE_WALL_DAMPING;
      flight.vy *= SIDE_WALL_DAMPING;
    }
    if (dy < top || dy > bottom) {
      dy = Math.min(bottom, Math.max(top, dy));
      flight.vy = -flight.vy * SIDE_WALL_DAMPING;
      flight.vx *= SIDE_WALL_DAMPING;
    }
    if (Math.hypot(flight.vx, flight.vy) < REST_SPEED) flight = null;
  }

  hit.addEventListener('pointerdown', (e) => {
    press(e, true);
    hit.setPointerCapture(e.pointerId);
  });
  addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== hit) press(e, false);
    },
    { passive: false },
  );
  hit.addEventListener(
    'wheel',
    (e) => {
      if (burstAt !== null) return;
      e.preventDefault();
      homing = false;
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.exp(-e.deltaY * WHEEL_RATE)));
      clampToScreen();
    },
    { passive: false },
  );
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  // Холст — ровно окно в точках CSS: `100vh` на телефоне выше окна (строка адреса), и
  // растянутый холст сплющил бы шар и сдвинул его с места.
  let dpr = 1,
    width = 0,
    height = 0;
  function resize() {
    if (width === innerWidth && height === innerHeight) return;
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  resize();

  let lastFrame = performance.now();
  function draw(now) {
    step(now - lastFrame);
    lastFrame = now;
    resize();
    if (burstAt !== null && now - burstAt > BURST_MS + REBORN_MS) reborn();
    const burst = burstAt === null ? 0 : Math.min(1, (now - burstAt) / BURST_MS);
    const spread = 1 + BURST_REACH * smooth(burst);
    const fade = 1 - burst;
    const { x, y, r: radius } = circle();
    hit.style.display = burstAt === null ? '' : 'none';
    hit.style.left = `${x - radius}px`;
    hit.style.top = `${y - radius}px`;
    hit.style.width = hit.style.height = `${2 * radius}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Шар вне окна не рисуется: страницу пролистали.
    if (y + radius < 0 || y - radius > innerHeight || fade === 0) {
      requestAnimationFrame(draw);
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    const view = viewAt(now);
    const items = [];
    for (const ring of rings) {
      const bubble = bubbleOf(ring, now);
      if (bubble.a < MIN_ANGLE) continue;
      const mid = view(ring.spot.c);
      items.push({ z: mid[2], ring, bubble, mid });
    }
    items.sort((one, other) => one.z - other.z);

    for (const { ring, bubble, mid } of items) {
      const image = images[PICTURES[(ring.index + ring.life) % PICTURES.length]];
      const front = mid[2] >= 0;
      const depth = front ? FRONT_ALPHA + (1 - FRONT_ALPHA) * mid[2] : BACK_ALPHA;
      if (image.complete && image.naturalWidth > 0) {
        const u = view(ring.spot.u);
        const v = view(ring.spot.v);
        upright(u, v);
        // Лопнувший шар: пузыри разлетаются от середины и гаснут.
        const lift = radius * Math.cos(bubble.a) * spread;
        const s = radius * Math.sin(bubble.a) * spread;
        ctx.globalAlpha = depth * bubble.alpha * fade;
        // Картинка лежит в касательной плоскости шара: оси рисунка — `u` и `v` на экране.
        ctx.setTransform(
          dpr * s * u[0],
          -dpr * s * u[1],
          dpr * s * v[0],
          -dpr * s * v[1],
          dpr * (x + lift * mid[0]),
          dpr * (y - lift * mid[1]),
        );
        ctx.drawImage(image, -1, -1, 2, 2);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (bubble.pop !== null && burstAt === null) sparks(ring, bubble, x, y, radius, view);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  function sparks(ring, bubble, x, y, radius, view) {
    const pop = bubble.pop;
    const { c, u, v } = ring.spot;
    const reach = bubble.a * (1 + SPARK_REACH * Math.sqrt(pop));
    const ca = Math.cos(reach),
      sa = Math.sin(reach);
    const side = 2 * SPARK_R * (1 - 0.5 * pop);
    ctx.fillStyle = ring.spark;
    for (let k = 0; k < SPARK_COUNT; k++) {
      const t = ((k + 0.5 * (ring.life % 2)) / SPARK_COUNT) * Math.PI * 2;
      const dc = Math.cos(t) * sa,
        ds = Math.sin(t) * sa;
      const point = view([
        c[0] * ca + u[0] * dc + v[0] * ds,
        c[1] * ca + u[1] * dc + v[1] * ds,
        c[2] * ca + u[2] * dc + v[2] * ds,
      ]);
      const depth = point[2] >= 0 ? FRONT_ALPHA + (1 - FRONT_ALPHA) * point[2] : BACK_ALPHA;
      ctx.globalAlpha = depth * (1 - pop);
      ctx.fillRect(x + radius * point[0] - side / 2, y - radius * point[1] - side / 2, side, side);
    }
  }

  requestAnimationFrame(draw);
})();
