(() => {
  const W = 1280;
  const H = 720;
  const LANES = 4;
  const INTEGRITY_MAX = 5;
  const WOLF_FOOT = { x: 171, y: 278, w: 410, h: 288 };
  const WOLF_DRAW_H = 228;
  const WOLF_SCALE = WOLF_DRAW_H / WOLF_FOOT.h;
  const WOLF_X = 458;
  const HIT_X0 = WOLF_X + 36;
  const HIT_X1 = WOLF_X + 228;
  const HIT_MID0 = HIT_X0 + (HIT_X1 - HIT_X0) * 0.28;
  const HIT_MID1 = HIT_X0 + (HIT_X1 - HIT_X0) * 0.72;
  const WALL_X = 372;
  const PACKET_SIZE = 64;
  const BEST_KEY = "packetwolf.best";
  const BOARD_KEY = "packetwolf.board";
  const FEVER_AT = 8;
  const LUNGE = [6, 16, 30, 48, 56, 36, 18, 8];
  const INTRO = [
    { kind: "legit", lane: 1, hint: "GREEN — F TO ALLOW" },
    { kind: "malware", lane: 2, hint: "RED — SPACE TO DROP" },
    { kind: "c2", lane: 0, hint: "C2 IS FAST — DROP IT" },
  ];

  const TYPES = {
    legit: { drop: false, speed: 1, score: 80, pass: 15, color: "#3dff8a", label: "ALLOW" },
    malware: { drop: true, speed: 1.06, score: 100, color: "#ff3355", label: "MALWARE" },
    phish: { drop: true, speed: 0.9, score: 125, color: "#ffcc44", label: "PHISH" },
    c2: { drop: true, speed: 1.42, score: 160, color: "#c084ff", label: "C2" },
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const pauseEl = document.getElementById("pause");
  const hud = document.getElementById("hud");
  const actionsEl = document.getElementById("actions");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const comboEl = document.getElementById("combo");
  const comboBlock = document.querySelector(".combo-block");
  const pipsEl = document.getElementById("pips");
  const toastEl = document.getElementById("toast");
  const bestLine = document.getElementById("bestLine");
  const boardEl = document.getElementById("board");
  const frameEl = document.getElementById("frame");
  const startBtn = document.getElementById("startBtn");
  const allowBtn = document.getElementById("allowBtn");
  const dropBtn = document.getElementById("dropBtn");

  const images = {};
  const idle = [];
  const attack = [];

  let mode = "title";
  let last = 0;
  let lastDt = 0.016;
  let elapsed = 0;
  let spawnT = 0;
  let intro = 0;
  let lane = 1;
  let laneY = 0;
  let anim = "idle";
  let frame = 0;
  let frameT = 0;
  let squash = 0;
  let freeze = 0;
  let flash = 0;
  let stampLock = 0;
  let score = 0;
  let combo = 1;
  let bestCombo = 1;
  let integrity = INTEGRITY_MAX;
  let wave = 1;
  let dropped = 0;
  let allowed = 0;
  let stamped = 0;
  let breaches = 0;
  let falsePos = 0;
  let perfects = 0;
  let pStreak = 0;
  let cleanWave = true;
  let burstLeft = 0;
  let queued = null;
  let heartT = 0;
  let packets = [];
  let fx = [];
  let floaters = [];
  let particles = [];
  let shake = 0;
  let toastT = 0;
  let muted = false;
  let audio;
  let drone;
  const params = new URLSearchParams(location.search);
  const autoStart = params.has("autostart") || params.has("demo");
  const demo = params.has("demo");

  const LY = (() => {
    const top = 168;
    const bot = 662;
    const step = (bot - top) / (LANES - 1);
    return Array.from({ length: LANES }, (_, i) => top + i * step);
  })();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(src));
      im.src = src;
    });
  }

  async function loadAll() {
    const jobs = [
      ["bg", "assets/bg/ops.jpg"],
      ["legit", "assets/packets/legit.png"],
      ["malware", "assets/packets/malware.png"],
      ["phish", "assets/packets/phish.png"],
      ["c2", "assets/packets/c2.png"],
      ["slash", "assets/fx/slash.png"],
      ["breach", "assets/fx/breach.png"],
      ["stamp", "assets/fx/stamp.png"],
      ["spark", "assets/fx/spark.png"],
    ];
    for (let i = 1; i <= 8; i++) {
      const n = String(i).padStart(2, "0");
      jobs.push([`idle${i}`, `assets/wolf/idle/${n}.png`]);
      jobs.push([`atk${i}`, `assets/wolf/attack/${n}.png`]);
    }
    const loaded = await Promise.all(jobs.map(([, src]) => loadImage(src)));
    jobs.forEach(([key], i) => {
      images[key] = loaded[i];
    });
    for (let i = 1; i <= 8; i++) {
      idle.push(images[`idle${i}`]);
      attack.push(images[`atk${i}`]);
    }
  }

  function ensureAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    return audio;
  }

  function tone(freq, dur, type = "square", vol = 0.06, slide = 0) {
    const ac = ensureAudio();
    if (!ac || muted) return;
    if (ac.state === "suspended") ac.resume();
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function chord(freqs, dur, vol = 0.03) {
    freqs.forEach((f, i) => tone(f, dur, i ? "triangle" : "square", vol, 0));
  }

  function noiseBurst(dur = 0.12, vol = 0.04) {
    const ac = ensureAudio();
    if (!ac || muted) return;
    if (ac.state === "suspended") ac.resume();
    const n = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = n;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(g).connect(ac.destination);
    src.start();
  }

  function startDrone() {
    const ac = ensureAudio();
    if (!ac || drone) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = 52;
    g.gain.value = muted ? 0 : 0.018;
    osc.connect(g).connect(ac.destination);
    osc.start();
    drone = { osc, g };
  }

  function stopDrone() {
    if (!drone) return;
    try {
      drone.osc.stop();
    } catch (_) {
      /* already stopped */
    }
    drone = null;
  }

  function fever() {
    return combo >= FEVER_AT;
  }

  function setDroneMute() {
    if (!drone) return;
    if (muted || mode !== "playing") {
      drone.g.gain.value = 0;
      return;
    }
    drone.g.gain.value = fever() ? 0.03 : 0.018;
    const hz = fever() ? 78 : 52;
    try {
      drone.osc.frequency.setTargetAtTime(hz, drone.osc.context.currentTime, 0.08);
    } catch (_) {
      drone.osc.frequency.value = hz;
    }
  }

  function best() {
    return Number(localStorage.getItem(BEST_KEY) || 0);
  }

  function board() {
    try {
      return JSON.parse(localStorage.getItem(BOARD_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function pushBoard(entry) {
    const b = board()
      .concat(entry)
      .sort((a, c) => c.score - a.score)
      .slice(0, 5);
    localStorage.setItem(BOARD_KEY, JSON.stringify(b));
    return b;
  }

  function renderBoard(el) {
    if (!el) return;
    const b = board();
    el.innerHTML = b
      .map(
        (r, i) =>
          `<li><b>${r.score}</b><span>${r.rank}</span><em>W${r.wave}</em></li>`
      )
      .join("");
  }

  function setBest(n) {
    if (n > best()) localStorage.setItem(BEST_KEY, String(n));
    if (bestLine) bestLine.textContent = `BEST ${best()}`;
    renderBoard(boardEl);
  }

  function renderPips() {
    pipsEl.innerHTML = "";
    for (let i = 0; i < INTEGRITY_MAX; i++) {
      const s = document.createElement("span");
      s.className = "pip" + (i < integrity ? "" : " off") + (integrity <= 2 && i < integrity ? " hurt" : "");
      pipsEl.appendChild(s);
    }
  }

  function hudSync() {
    scoreEl.textContent = String(score);
    waveEl.textContent = String(wave);
    comboEl.textContent = fever() ? `×${combo} OC` : `×${combo}`;
    comboBlock.classList.toggle("hot", combo >= 5);
    comboBlock.classList.toggle("fever", fever());
    frameEl.classList.toggle("fever", fever() && (mode === "playing" || mode === "paused"));
    frameEl.classList.toggle("critical", integrity === 1 && (mode === "playing" || mode === "paused"));
    renderPips();
  }

  function toast(text, color, ms = 700) {
    toastEl.textContent = text;
    toastEl.style.color = color;
    toastEl.classList.add("show");
    toastT = ms / 1000;
  }

  function comboWord(c) {
    if (c >= 16) return "APEX";
    if (c >= 12) return "RAMPAGE";
    if (c >= 8) return "ON FIRE";
    if (c >= 5) return "STREAK";
    if (c >= 3) return "CLEAN";
    return null;
  }

  function rankFor() {
    if (score >= 12000) return "GHOST WOLF";
    if (score >= 7000) return "CISO";
    if (score >= 3500) return "THREAT HUNTER";
    if (score >= 1200) return "ANALYST";
    return "INTERN";
  }

  function resetRun() {
    elapsed = 0;
    spawnT = 0.45;
    intro = 0;
    lane = 1;
    laneY = LY[lane];
    anim = "idle";
    frame = 0;
    frameT = 0;
    squash = 0;
    freeze = 0;
    flash = 0;
    stampLock = 0;
    score = 0;
    combo = 1;
    bestCombo = 1;
    integrity = INTEGRITY_MAX;
    wave = 1;
    dropped = 0;
    allowed = 0;
    stamped = 0;
    breaches = 0;
    falsePos = 0;
    perfects = 0;
    pStreak = 0;
    cleanWave = true;
    burstLeft = 0;
    queued = null;
    heartT = 0;
    packets = [];
    fx = [];
    floaters = [];
    particles = [];
    shake = 0;
    hud.hidden = false;
    actionsEl.hidden = false;
    hudSync();
  }

  function difficulty() {
    const t = Math.max(0, elapsed - 6);
    const speed = Math.min(430, 145 + t * 8.5);
    const interval = Math.max(0.4, 1.22 - t * 0.02);
    const w = 1 + Math.floor(elapsed / 18);
    if (w !== wave) {
      if (cleanWave && wave >= 1) {
        const bonus = 200 * wave;
        addScore(bonus);
        toast(`CLEAN WAVE +${bonus}`, "#3dff8a", 900);
        chord([330, 415, 494], 0.18, 0.035);
      } else {
        toast(`WAVE ${w}`, "#3ee0ff", 800);
        tone(220, 0.08, "square", 0.05);
        tone(330, 0.12, "square", 0.05);
      }
      wave = w;
      cleanWave = true;
      if (wave > 1 && wave % 3 === 0) {
        burstLeft = 6;
        toast("BURST TRAFFIC", "#c084ff", 900);
        noiseBurst(0.12, 0.05);
        tone(196, 0.16, "sawtooth", 0.05, 80);
      }
    }
    return { speed, interval };
  }

  function pickType() {
    const r = Math.random();
    if (wave >= 4) {
      if (r < 0.38) return "legit";
      if (r < 0.6) return "malware";
      if (r < 0.8) return "phish";
      return "c2";
    }
    if (r < 0.44) return "legit";
    if (r < 0.69) return "malware";
    if (r < 0.86) return "phish";
    return "c2";
  }

  function spawnPacket(kind, laneId, slow) {
    packets.push({
      kind,
      lane: laneId,
      x: W + 40,
      bob: Math.random() * Math.PI * 2,
      rot: (Math.random() - 0.5) * 0.2,
      trail: [],
      late: false,
      slow: !!slow,
    });
  }

  function spawn() {
    if (intro < INTRO.length) {
      const s = INTRO[intro++];
      spawnPacket(s.kind, s.lane, true);
      toast(s.hint, s.kind === "legit" ? "#3dff8a" : "#ff3355", 1400);
      return;
    }
    const occupied = packets.filter((p) => p.x > W - 160).map((p) => p.lane);
    const open = [0, 1, 2, 3].filter((l) => !occupied.includes(l));
    const laneId = open.length ? open[(Math.random() * open.length) | 0] : (Math.random() * LANES) | 0;
    if (burstLeft > 0) {
      burstLeft -= 1;
      spawnPacket(pickType(), laneId, false);
      return;
    }
    spawnPacket(pickType(), laneId, false);
  }

  function floater(x, y, text, color, size = 16) {
    floaters.push({ x, y, text, color, size, t: 0, life: 0.75 });
  }

  function burst(x, y, img, size = 110) {
    fx.push({ x, y, img, t: 0, life: 0.3, size });
  }

  function spray(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 180;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0.35 + Math.random() * 0.25,
        t: 0,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function addScore(n) {
    score += Math.max(0, n | 0);
    hudSync();
  }

  function bumpCombo() {
    const was = fever();
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    if (!was && fever()) {
      toast("OVERCLOCK", "#ffcc44", 900);
      chord([262, 330, 392, 523], 0.24, 0.04);
      setDroneMute();
    } else {
      const word = comboWord(combo);
      if (word) toast(word, "#ffcc44", 520);
    }
    hudSync();
  }

  function breakCombo() {
    const was = fever();
    combo = 1;
    pStreak = 0;
    if (was) {
      toast("OVERCLOCK LOST", "#ff3355", 560);
      tone(110, 0.22, "sawtooth", 0.05, -50);
      setDroneMute();
    }
    hudSync();
  }

  function busy() {
    return anim === "attack" || stampLock > 0;
  }

  function nearestHit() {
    const hits = packets.filter((p) => p.lane === lane && p.x >= HIT_X0 && p.x <= HIT_X1);
    hits.sort((a, b) => a.x - b.x);
    return hits[0] || null;
  }

  function isPerfect(p) {
    return p.x >= HIT_MID0 && p.x <= HIT_MID1;
  }

  function classify(wantDrop) {
    if (mode !== "playing") return;
    if (busy()) {
      queued = { drop: wantDrop, t: 0.2 };
      return;
    }
    queued = null;

    const p = nearestHit();
    if (!p) {
      if (wantDrop) {
        anim = "attack";
        frame = 0;
        frameT = 0;
        noiseBurst(0.06, 0.03);
        floater(HIT_X1 - 10, laneY - 44, "WHIFF", "#7f93ad");
      } else {
        stampLock = 0.14;
        squash = 1;
        floater(HIT_X1 - 10, laneY - 44, "WHIFF", "#7f93ad");
        tone(180, 0.08, "triangle", 0.03);
      }
      return;
    }

    const spec = TYPES[p.kind];
    const perfect = isPerfect(p);
    packets = packets.filter((q) => q !== p);

    if (wantDrop) {
      anim = "attack";
      frame = 0;
      frameT = 0;
      noiseBurst(0.07, 0.045);
      burst(p.x + 8, p.y, images.slash, 124);
      spray(p.x, p.y, spec.color, 16);
      if (spec.drop) {
        bumpCombo();
        let pts = spec.score * Math.min(combo - 1, 12);
        if (perfect) {
          pts = Math.round(pts * 1.5);
          perfects += 1;
          pStreak += 1;
          burst(p.x, p.y - 10, images.spark, 90);
          if (pStreak === 3) toast("TRIPLE PERFECT", "#ffcc44", 700);
          floater(p.x, p.y - 36, `PERFECT +${pts}`, "#ffcc44", 18);
        } else {
          pStreak = 0;
          floater(p.x, p.y - 22, `DROP +${pts}`, spec.color);
        }
        if (fever()) pts *= 2;
        addScore(pts);
        dropped += 1;
        freeze = fever() ? 0.06 : 0.045;
        tone(480 + combo * 16, 0.09, "square", 0.05);
      } else {
        breakCombo();
        falsePos += 1;
        flash = 0.35;
        floater(p.x, p.y - 22, "FALSE POSITIVE", "#ffcc44");
        toast("FALSE POSITIVE", "#ffcc44", 520);
        tone(140, 0.18, "sawtooth", 0.05, -80);
      }
    } else {
      stampLock = 0.16;
      squash = 1;
      burst(p.x, p.y, images.stamp, 100);
      spray(p.x, p.y, spec.color, 10);
      if (!spec.drop) {
        bumpCombo();
        stamped += 1;
        allowed += 1;
        let pts = spec.score * Math.min(combo - 1, 12);
        if (perfect) {
          pts = Math.round(pts * 1.5);
          perfects += 1;
          pStreak += 1;
          burst(p.x, p.y - 8, images.spark, 80);
          if (pStreak === 3) toast("TRIPLE PERFECT", "#ffcc44", 700);
          floater(p.x, p.y - 36, `PERFECT +${pts}`, "#3dff8a", 18);
        } else {
          pStreak = 0;
          floater(p.x, p.y - 22, `STAMP +${pts}`, "#3dff8a");
        }
        if (fever()) pts *= 2;
        addScore(pts);
        chord([392, 494, 587], 0.12, 0.03);
      } else {
        breachAt(p.x, p.y, "STAMPED A THREAT");
      }
    }
  }

  function breachAt(x, y, label) {
    if (mode !== "playing") return;
    integrity = Math.max(0, integrity - 1);
    breakCombo();
    cleanWave = false;
    breaches += 1;
    shake = 0.32;
    flash = 0.55;
    burst(x, y, images.breach, 160);
    spray(x, y, "#ff3355", 22);
    floater(x, y - 16, "BREACH", "#ff3355", 18);
    toast(label || "BREACH", "#ff3355", 560);
    tone(90, 0.28, "sawtooth", 0.07, -40);
    noiseBurst(0.2, 0.05);
    hudSync();
    if (integrity <= 0) gameOver();
  }

  function onReach(p) {
    if (mode !== "playing") return;
    const spec = TYPES[p.kind];
    if (spec.drop) breachAt(WALL_X + 48, p.y, "BREACH");
    else {
      allowed += 1;
      addScore(spec.pass);
      floater(WALL_X + 54, p.y, `PASS +${spec.pass}`, "#3dff8a");
      tone(620, 0.07, "triangle", 0.03);
    }
  }

  function gameOver() {
    mode = "gameover";
    stopDrone();
    const prev = best();
    const isNew = score > prev;
    const recapRank = rankFor();
    setBest(score);
    pushBoard({ score, rank: recapRank, wave });
    hud.hidden = true;
    actionsEl.hidden = true;
    frameEl.classList.remove("fever", "critical");
    overlay.classList.remove("hidden");
    const judged = dropped + stamped + breaches + falsePos;
    const acc = judged ? Math.round((100 * (dropped + stamped)) / judged) : 0;
    const boardHtml = board()
      .map((r) => `<li><b>${r.score}</b><span>${r.rank}</span><em>W${r.wave}</em></li>`)
      .join("");
    overlay.innerHTML = `
      <div class="panel over">
        <p class="kicker">INTEGRITY FAILURE</p>
        <h1>BREACH<br/>CASCADE</h1>
        <p class="rank">${recapRank}${isNew ? "  ·  NEW BEST" : ""}</p>
        <ul class="stats">
          <li>SCORE <b class="${isNew ? "newbest" : ""}">${score}</b></li>
          <li>BEST <b>${best()}</b></li>
          <li>ACCURACY <b>${acc}%</b></li>
          <li>THREATS DROPPED <b>${dropped}</b></li>
          <li>STAMPED LEGIT <b>${stamped}</b></li>
          <li>PERFECTS <b>${perfects}</b></li>
          <li>FALSE POSITIVES <b>${falsePos}</b></li>
          <li>MAX COMBO <b>×${bestCombo}</b></li>
          <li>WAVE <b>${wave}</b></li>
        </ul>
        <ol class="board">${boardHtml}</ol>
        <button id="againBtn" type="button">PRESS SPACE TO REDEPLOY</button>
      </div>`;
    document.getElementById("againBtn").addEventListener("click", start);
    tone(200, 0.4, "sawtooth", 0.06, -160);
  }

  function start() {
    if (mode === "playing") return;
    ensureAudio();
    overlay.classList.add("hidden");
    overlay.innerHTML = "";
    pauseEl.classList.add("hidden");
    resetRun();
    mode = "playing";
    startDrone();
    setDroneMute();
    toast("DEFEND THE BOUNDARY", "#3ee0ff", 800);
    tone(330, 0.1, "square", 0.05);
    tone(440, 0.14, "square", 0.05);
  }

  function togglePause() {
    if (mode === "playing") {
      mode = "paused";
      pauseEl.classList.remove("hidden");
      setDroneMute();
      if (drone) drone.g.gain.value = 0;
    } else if (mode === "paused") {
      mode = "playing";
      pauseEl.classList.add("hidden");
      last = performance.now();
      setDroneMute();
    }
  }

  function showTitle() {
    mode = "title";
    hud.hidden = true;
    actionsEl.hidden = true;
    overlay.classList.remove("hidden");
    frameEl.classList.remove("fever", "critical");
    setBest(best());
    renderBoard(boardEl);
  }

  function wolfFrame() {
    return anim === "attack" ? attack[Math.min(frame, 7)] : idle[frame % 8];
  }

  function approaching() {
    return packets
      .filter((p) => p.lane === lane && p.x > HIT_X0 - 30 && p.x < HIT_X1 + 320)
      .sort((a, b) => a.x - b.x)[0];
  }

  function drawHitZone() {
    if (mode !== "playing" && mode !== "paused") return;
    const y = LY[lane];
    const next = approaching();
    const spec = next ? TYPES[next.kind] : null;
    const col = spec ? spec.color : fever() ? "#ffcc44" : "#3ee0ff";
    const inZone = next && next.x >= HIT_X0 && next.x <= HIT_X1;
    ctx.save();
    ctx.globalAlpha = inZone ? 0.22 : 0.1;
    ctx.fillStyle = col;
    ctx.fillRect(HIT_X0, y - 46, HIT_X1 - HIT_X0, 56);
    ctx.globalAlpha = inZone ? 0.95 : 0.45;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(HIT_X0, y - 46);
    ctx.lineTo(HIT_X0, y + 10);
    ctx.moveTo(HIT_X1, y - 46);
    ctx.lineTo(HIT_X1, y + 10);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(HIT_MID0, y - 40);
    ctx.lineTo(HIT_MID0, y + 6);
    ctx.moveTo(HIT_MID1, y - 40);
    ctx.lineTo(HIT_MID1, y + 6);
    ctx.stroke();
    ctx.restore();
    if (next && inZone) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col;
      ctx.font = "700 12px 'IBM Plex Mono', monospace";
      ctx.fillText(spec.drop ? "DROP" : "ALLOW", HIT_X0 + 8, y - 52);
      ctx.restore();
    }
  }

  function drawWolf(y) {
    const im = wolfFrame();
    const lunge = anim === "attack" ? LUNGE[Math.min(frame, 7)] : 0;
    const dw = WOLF_FOOT.w * WOLF_SCALE;
    const dh = WOLF_FOOT.h * WOLF_SCALE;
    const dx = WOLF_X - WOLF_FOOT.x * WOLF_SCALE + lunge;
    const dy = y - WOLF_FOOT.y * WOLF_SCALE;
    ctx.save();
    ctx.fillStyle = fever() ? "rgba(255, 204, 68, 0.35)" : "rgba(62, 224, 255, 0.22)";
    ctx.beginPath();
    ctx.ellipse(WOLF_X + 8 + lunge * 0.4, y + 10, 52, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(WOLF_X + lunge, y);
    ctx.scale(1, 1 - squash * 0.1);
    ctx.translate(-(WOLF_X + lunge), -y);
    ctx.shadowColor = fever() ? "rgba(255, 204, 68, 0.85)" : "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = fever() ? 28 : 18;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(im, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawLanes() {
    LY.forEach((y, i) => {
      ctx.save();
      ctx.globalAlpha = i === lane && (mode === "playing" || mode === "paused") ? 0.5 : 0.16;
      ctx.strokeStyle = i === lane ? "#3ee0ff" : "#6a86a8";
      ctx.lineWidth = i === lane ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(400, y + 8);
      ctx.lineTo(W - 24, y + 8);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawSpeedLines() {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 220, 120, 0.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const y = 140 + ((elapsed * 420 + i * 73) % 520);
      const x0 = 520 + (i * 67) % 200;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 90, y + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFirewallHurt() {
    const hurt = 1 - integrity / INTEGRITY_MAX;
    if (hurt <= 0 || (mode !== "playing" && mode !== "paused" && mode !== "gameover")) return;
    ctx.save();
    ctx.fillStyle = `rgba(255, 40, 70, ${0.08 + hurt * 0.18})`;
    ctx.fillRect(0, 0, 420, H);
    ctx.restore();
  }

  function drawPackets(dt) {
    for (const p of packets) {
      p.bob += dt * (TYPES[p.kind].drop ? 8 : 5);
      const spec = TYPES[p.kind];
      const y = LY[p.lane] - 6 + Math.sin(p.bob) * 5;
      p.y = y;
      p.trail.push({ x: p.x, y });
      if (p.trail.length > 7) p.trail.shift();
      ctx.save();
      p.trail.forEach((t, i) => {
        ctx.globalAlpha = (i / p.trail.length) * 0.28;
        ctx.fillStyle = spec.color;
        const s = 8 + i * 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, s * 0.35, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      ctx.save();
      ctx.translate(p.x, y);
      ctx.rotate(p.rot + Math.sin(p.bob * 0.5) * 0.05);
      ctx.shadowColor = spec.color;
      ctx.shadowBlur = spec.drop ? 22 : 14;
      const pulse = spec.drop ? 1 + Math.sin(p.bob * 2) * 0.04 : 1;
      const sz = PACKET_SIZE * pulse;
      ctx.drawImage(images[p.kind], -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
  }

  function drawFx() {
    for (const f of fx) {
      const a = 1 - f.t / f.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.translate(f.x, f.y);
      ctx.rotate(-0.35 + a * 0.15);
      const s = f.size * (0.85 + (1 - a) * 0.35);
      ctx.drawImage(f.img, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.restore();
    }
    for (const f of floaters) {
      const a = 1 - f.t / f.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = f.color;
      ctx.font = `700 ${f.size || 16}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - f.t * 52);
      ctx.restore();
    }
  }

  function tickTitle(dt) {
    frameT += dt;
    if (frameT >= 1 / 8) {
      frameT = 0;
      frame = (frame + 1) % 8;
    }
    if (!packets.length) {
      for (let i = 0; i < 5; i++) spawnPacket(pickType(), i % 4, false);
      packets.forEach((p, i) => {
        p.x = 680 + i * 130;
      });
    }
    packets.forEach((p) => {
      p.x -= 40 * dt;
      if (p.x < 640) p.x = W + 40;
    });
  }

  function tickPlay(dt) {
    if (queued) {
      queued.t -= dt;
      if (queued.t <= 0) queued = null;
    }
    if (freeze > 0) {
      freeze -= dt;
      return;
    }
    elapsed += dt;
    squash = Math.max(0, squash - dt * 6);
    stampLock = Math.max(0, stampLock - dt);
    flash = Math.max(0, flash - dt * 2.2);

    const { speed, interval } = difficulty();
    spawnT -= dt;
    if (spawnT <= 0) {
      const wasBurst = burstLeft > 0;
      spawn();
      if (burstLeft > 0) spawnT = 0.2;
      else if (wasBurst) spawnT = 1.15;
      else spawnT = intro < INTRO.length ? 1.6 : interval * (0.65 + Math.random() * 0.55);
    }

    const target = LY[lane];
    laneY += (target - laneY) * Math.min(1, dt * 14);

    const fps = anim === "attack" ? 18 : 8;
    frameT += dt;
    if (frameT >= 1 / fps) {
      frameT -= 1 / fps;
      frame += 1;
      if (anim === "attack") {
        if (frame >= 8) {
          anim = "idle";
          frame = 0;
        }
      } else {
        frame %= 8;
      }
    }

    if (!busy() && queued) {
      const q = queued;
      queued = null;
      classify(q.drop);
    }

    for (const p of packets) {
      const mul = (p.slow ? 0.62 : 1) * TYPES[p.kind].speed * (fever() ? 0.88 : 1);
      p.x -= speed * mul * dt;
      if (!p.late && TYPES[p.kind].drop && p.x < HIT_X0 && p.x > WALL_X + 40 && p.lane === lane) {
        p.late = true;
        floater(p.x, LY[p.lane] - 40, "LATE", "#ffcc44");
      }
    }
    const remaining = [];
    for (const p of packets) {
      if (p.x <= WALL_X + 18) onReach(p);
      else remaining.push(p);
    }
    packets = remaining;

    if (demo) {
      const incoming = packets.filter((p) => p.x >= HIT_X0 && p.x <= HIT_X1);
      if (incoming.length) {
        incoming.sort((a, b) => a.x - b.x);
        const p = incoming[0];
        if (p.lane !== lane) lane = p.lane;
        classify(TYPES[p.kind].drop);
      }
    }

    if (integrity === 1) {
      heartT += dt;
      if (heartT >= 0.72) {
        heartT = 0;
        flash = Math.max(flash, 0.18);
        tone(64, 0.09, "sine", 0.055);
      }
    } else {
      heartT = 0;
    }

    if (shake > 0) shake = Math.max(0, shake - dt);
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) toastEl.classList.remove("show");
    }
  }

  function tickFx(dt) {
    const step = freeze > 0 ? dt * 0.35 : dt;
    fx.forEach((f) => {
      f.t += step;
    });
    fx = fx.filter((f) => f.t < f.life);
    floaters.forEach((f) => {
      f.t += step;
    });
    floaters = floaters.filter((f) => f.t < f.life);
    particles.forEach((p) => {
      p.t += step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += 420 * step;
    });
    particles = particles.filter((p) => p.t < p.life);
  }

  function draw() {
    const ox = shake ? (Math.random() - 0.5) * 18 : 0;
    const oy = shake ? (Math.random() - 0.5) * 12 : 0;
    ctx.setTransform(1, 0, 0, 1, ox, oy);
    ctx.drawImage(images.bg, 0, 0, W, H);
    drawFirewallHurt();
    if (fever() && (mode === "playing" || mode === "paused")) drawSpeedLines();
    drawLanes();
    drawHitZone();
    drawPackets(lastDt);
    const wolfY = mode === "playing" || mode === "paused" ? laneY : LY[1];
    drawWolf(wolfY);
    drawFx();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 40, 70, ${flash * 0.32})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    lastDt = dt;
    if (mode === "title") tickTitle(dt);
    else if (mode === "playing") tickPlay(dt);
    if (mode !== "paused") tickFx(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function laneFromY(y) {
    let bestI = 0;
    let bestD = 1e9;
    LY.forEach((ly, i) => {
      const d = Math.abs(ly - y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    return bestI;
  }

  function canvasPos(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * W,
      y: ((ev.clientY - r.top) / r.height) * H,
    };
  }

  window.addEventListener("keydown", (e) => {
    if (["Space", "ArrowUp", "ArrowDown", "KeyF", "KeyE"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyM") {
      muted = !muted;
      setDroneMute();
      if (mode === "paused" && drone) drone.g.gain.value = 0;
      return;
    }
    if (e.code === "Escape") {
      togglePause();
      return;
    }
    if (mode === "paused") return;
    if (mode === "title" && (e.code === "Space" || e.code === "Enter")) {
      start();
      return;
    }
    if (mode === "gameover" && (e.code === "Space" || e.code === "Enter")) {
      start();
      return;
    }
    if (mode !== "playing") return;
    if (e.code === "ArrowUp" || e.code === "KeyW") lane = Math.max(0, lane - 1);
    if (e.code === "ArrowDown" || e.code === "KeyS") lane = Math.min(LANES - 1, lane + 1);
    if (e.code === "Digit1") lane = 0;
    if (e.code === "Digit2") lane = 1;
    if (e.code === "Digit3") lane = 2;
    if (e.code === "Digit4") lane = 3;
    if (e.code === "Space" || e.code === "KeyJ" || e.code === "KeyK") classify(true);
    if (e.code === "KeyF" || e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight") classify(false);
  });

  canvas.addEventListener("pointerdown", (ev) => {
    if (mode === "title" || mode === "gameover") {
      start();
      return;
    }
    if (mode !== "playing") return;
    const { y } = canvasPos(ev);
    lane = laneFromY(y);
    classify(ev.button !== 2);
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  allowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    classify(false);
  });
  dropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    classify(true);
  });

  startBtn.addEventListener("click", start);
  overlay.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") return;
    if (mode === "title" || mode === "gameover") start();
  });
  pauseEl.addEventListener("click", () => {
    if (mode === "paused") togglePause();
  });

  loadAll()
    .then(() => {
      setBest(best());
      laneY = LY[1];
      showTitle();
      if (autoStart) start();
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      overlay.innerHTML = `<div class="panel"><h1>LOAD FAIL</h1><p>${err.message}</p></div>`;
    });
})();
