/* ==========================================================
   НИИ «СФЕРА» — клиент
   v9 · 11 ролей + мобильная оптимизация + звук по устройству
   ========================================================== */
(() => {
'use strict';

/* ==========================================================
   ОПРЕДЕЛЕНИЕ УСТРОЙСТВА
   ========================================================== */
const Device = {
    isMobile: false,
    isTouch: false,
    isLowPower: false,
    reducedMotion: false,

    detect() {
        const ua = navigator.userAgent || '';
        this.isTouch = ('ontouchstart' in window)
            || (navigator.maxTouchPoints > 0)
            || (navigator.msMaxTouchPoints > 0);

        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua)
            || (this.isTouch && Math.min(window.innerWidth, window.innerHeight) < 820);

        this.isLowPower = this.isMobile
            || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
            || (navigator.deviceMemory && navigator.deviceMemory <= 4);

        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = mq.matches;
        if (mq.addEventListener) mq.addEventListener('change', e => { this.reducedMotion = e.matches; });
    }
};
Device.detect();

/* ==========================================================
   ЗАГРУЗЧИК data.txt
   ========================================================== */
const DATA_DEFAULTS = {
    'проводящий': 'KlacB',
    'дата': 'XX.XX.2026, в XX:00 по МСК',
    'тип': 'Закрытое Мероприятие',
    'футер': 'Для записи необходимо написать KlacB в личные сообщения',
    'роль1': '??? | свободна',
    'роль2': '??? | свободна',
    'роль3': '??? | свободна',
    'роль4': '??? | свободна',
    'роль5': '??? | свободна',
    'роль6': '??? | свободна',
    'роль7': '??? | свободна',
    'роль8': '??? | свободна',
    'роль9': 'Статист | свободна',
    'роль10': 'Статист | свободна',
    'роль11': 'Статист | свободна'
};

const Data = {
    map: Object.assign({}, DATA_DEFAULTS),
    loaded: false,
    _loading: null,

    async load() {
        if (this.loaded) return;
        if (this._loading) return this._loading;

        this._loading = (async () => {
            try {
                const res = await fetch('data.txt?v=' + Date.now(), {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const text = await res.text();
                this._parse(text);
                console.log('[data.txt] загружен, ключей:', Object.keys(this.map).length);
            } catch (e) {
                console.warn('[data.txt] не загружен (' + e.message + '), используются значения по умолчанию');
            }
            this.loaded = true;
            this._loading = null;
        })();

        return this._loading;
    },

    _parse(text) {
        text = text.replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/);
        for (let raw of lines) {
            raw = raw.replace(/^\uFEFF/, '').trim();
            if (!raw || raw[0] === '#') continue;
            const pos = raw.indexOf('=');
            if (pos === -1) continue;
            let key = raw.slice(0, pos).trim().replace(/\s+/g, '');
            const val = raw.slice(pos + 1).trim();
            if (/^[a-zA-Z0-9_]+$/.test(key)) key = key.toLowerCase();
            if (key) this.map[key] = val;
        }
    },

    get(key, fallback = '') {
        return (key in this.map) ? this.map[key] : fallback;
    }
};

/* ==========================================================
   АУДИО
   На телефоне — пауза при свёрнутой вкладке
   На десктопе — продолжает играть
   ========================================================== */
const Audio_ = {
    sounds: {},
    volume: 0.5,
    muted: false,
    ambientStarted: false,
    randomTimer: null,
    wctx: null,
    wmaster: null,
    unlocked: false,
    watchdog: null,

    files: {
        ambient_drone:  { file: 'ambient_drone.ogg',  loop: true,  base: 0.55 },
        ambient_wind:   { file: 'ambient_wind.ogg',   loop: true,  base: 0.35 },
        sfx_heartbeat:  { file: 'sfx_heartbeat.ogg',  loop: false, base: 0.7 },
        sfx_whisper:    { file: 'sfx_whisper.ogg',    loop: false, base: 0.55 },
        sfx_static:     { file: 'sfx_static.ogg',     loop: false, base: 0.45 },
        sfx_footsteps:  { file: 'sfx_footsteps.ogg',  loop: false, base: 0.55 },
        sfx_breath:     { file: 'sfx_breath.ogg',     loop: false, base: 0.55 },
        ui_click:       { file: 'ui_click.ogg',       loop: false, base: 0.55 },
        ui_transition:  { file: 'ui_transition.ogg',  loop: false, base: 0.75 }
    },

    init() {
        if (this.ready) return;
        this.ready = true;

        for (const key in this.files) {
            const cfg = this.files[key];
            const a = new window.Audio();
            a.src = 'audio/' + cfg.file;
            a.loop = cfg.loop;
            a.preload = 'auto';
            a._base = cfg.base;
            a.setAttribute('playsinline', '');
            a.addEventListener('error', () => {});
            this.sounds[key] = a;
        }

        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) {
                this.wctx = new Ctx();
                this.wmaster = this.wctx.createGain();
                this.wmaster.gain.value = this.muted ? 0 : this.volume;
                this.wmaster.connect(this.wctx.destination);
            }
        } catch (e) {}

        this._apply();
        this._startWatchdog();
        this._setupVisibility();
    },

    setVol(v) {
        this.volume = Math.max(0, Math.min(1, v));
        this._apply();
    },

    toggleMute() {
        this.muted = !this.muted;
        this._apply();
        return this.muted;
    },

    _apply() {
        const m = this.muted ? 0 : this.volume;
        for (const k in this.sounds) {
            const a = this.sounds[k];
            a.volume = Math.max(0, Math.min(1, (a._base || 1) * m));
        }
        if (this.wmaster) this.wmaster.gain.value = m;
    },

    play(name) {
        const a = this.sounds[name];
        if (!a) return;
        try {
            a.currentTime = 0;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    },

    startAmbient() {
        if (this.ambientStarted) return;
        this.ambientStarted = true;
        this.play('ambient_drone');
        this.play('ambient_wind');
        this._scheduleRandom();
    },

    _startWatchdog() {
        if (this.watchdog) return;
        this.watchdog = setInterval(() => {
            if (!this.ambientStarted) return;
            if (this.muted) return;
            if (Device.isTouch && document.hidden) return;
            ['ambient_drone', 'ambient_wind'].forEach(k => {
                const a = this.sounds[k];
                if (!a) return;
                if (a.paused) {
                    try {
                        const p = a.play();
                        if (p && p.catch) p.catch(() => {});
                    } catch (e) {}
                }
            });
        }, 2500);
    },

    _setupVisibility() {
        const handler = () => {
            if (!Device.isTouch) return;
            if (document.hidden) {
                this._pauseAll();
            } else {
                if (this.ambientStarted) {
                    ['ambient_drone', 'ambient_wind'].forEach(k => {
                        const a = this.sounds[k];
                        if (a) {
                            try {
                                const p = a.play();
                                if (p && p.catch) p.catch(() => {});
                            } catch (e) {}
                        }
                    });
                }
            }
        };

        document.addEventListener('visibilitychange', handler);
        window.addEventListener('pagehide', () => { if (Device.isTouch) this._pauseAll(); });
        window.addEventListener('pageshow', handler);
        window.addEventListener('blur', () => { if (Device.isTouch) this._pauseAll(); });
        window.addEventListener('focus', handler);
    },

    _pauseAll() {
        for (const k in this.sounds) {
            try { this.sounds[k].pause(); } catch (e) {}
        }
    },

    _scheduleRandom() {
        const pool = ['sfx_heartbeat', 'sfx_whisper', 'sfx_static', 'sfx_footsteps', 'sfx_breath'];
        const fire = () => {
            if (!this.ambientStarted) return;
            if (Device.isTouch && document.hidden) {
                this.randomTimer = setTimeout(fire, 30000);
                return;
            }
            const name = pool[Math.floor(Math.random() * pool.length)];
            this.play(name);
            this.randomTimer = setTimeout(fire, 30000 + Math.random() * 40000);
        };
        this.randomTimer = setTimeout(fire, 25000 + Math.random() * 25000);
    },

    unlock() {
        if (this.unlocked) return;
        this.unlocked = true;
        if (this.wctx && this.wctx.state === 'suspended') {
            try { this.wctx.resume(); } catch (e) {}
        }
    },

    /* ---------- СИНТЕЗ СКРИМЕРОВ ---------- */
    _noise(sec) {
        const n = Math.floor(this.wctx.sampleRate * sec);
        const b = this.wctx.createBuffer(1, n, this.wctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return b;
    },

    scream1() {
        const t = this.wctx.currentTime;
        const n = this.wctx.createBufferSource();
        n.buffer = this._noise(1.4);
        const ws = this.wctx.createWaveShaper();
        const c = new Float32Array(2048);
        for (let i = 0; i < 2048; i++) {
            const x = (i / 2048) * 2 - 1;
            c[i] = Math.tanh(x * 7);
        }
        ws.curve = c;
        const g = this.wctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.75, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
        n.connect(ws).connect(g).connect(this.wmaster);
        n.start(t); n.stop(t + 1.4);

        const o = this.wctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(1400, t);
        o.frequency.exponentialRampToValueAtTime(160, t + 1);
        const og = this.wctx.createGain();
        og.gain.setValueAtTime(0.16, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        o.connect(og).connect(this.wmaster);
        o.start(t); o.stop(t + 1.2);
    },

    scream2() {
        const t = this.wctx.currentTime;
        const o = this.wctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(2200, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.7);
        const g = this.wctx.createGain();
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.connect(g).connect(this.wmaster);
        o.start(t); o.stop(t + 0.9);

        const n = this.wctx.createBufferSource();
        n.buffer = this._noise(0.8);
        const f = this.wctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 1200;
        const ng = this.wctx.createGain();
        ng.gain.setValueAtTime(0.22, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        n.connect(f).connect(ng).connect(this.wmaster);
        n.start(t); n.stop(t + 0.9);
    },

    scream3() {
        const t = this.wctx.currentTime;
        const n = this.wctx.createBufferSource();
        n.buffer = this._noise(1.2);
        const f = this.wctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 1500;
        const g = this.wctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.55, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        n.connect(f).connect(g).connect(this.wmaster);
        n.start(t); n.stop(t + 1.2);
    },

    scream4() {
        const t = this.wctx.currentTime;
        [180, 340, 620, 980].forEach(freq => {
            const o = this.wctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = freq;
            const g = this.wctx.createGain();
            g.gain.setValueAtTime(0.001, t);
            g.gain.linearRampToValueAtTime(0.09, t + 0.5);
            g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
            o.connect(g).connect(this.wmaster);
            o.start(t); o.stop(t + 1.3);
        });
    },

    scream5() {
        const t = this.wctx.currentTime;
        const carrier = this.wctx.createOscillator();
        carrier.type = 'sawtooth';
        carrier.frequency.value = 320;
        const mod = this.wctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.value = 38;
        const mg = this.wctx.createGain();
        mg.gain.value = 700;
        mod.connect(mg).connect(carrier.frequency);
        const g = this.wctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        carrier.connect(g).connect(this.wmaster);
        carrier.start(t); mod.start(t);
        carrier.stop(t + 1.2); mod.stop(t + 1.2);
    },

    scream6() {
        const t = this.wctx.currentTime;
        [180, 340, 620, 980].forEach(freq => {
            const o = this.wctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = freq;
            const g = this.wctx.createGain();
            g.gain.setValueAtTime(0.001, t);
            g.gain.linearRampToValueAtTime(0.08, t + 0.6);
            g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
            o.connect(g).connect(this.wmaster);
            o.start(t); o.stop(t + 1.4);
        });
    },

    scream(kind) {
        if (!this.wctx || this.muted) return;
        const fn = this['scream' + kind];
        if (fn) fn.call(this);
    }
};

/* ==========================================================
   ПИКСЕЛЬНЫЙ ПЕРЕХОД
   ========================================================== */
const Pixel = {
    canvas: null,
    ctx: null,
    pixel: 12,
    cellsCache: null,

    init() {
        this.canvas = document.getElementById('pixelCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this._setPixelSize();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    },

    _setPixelSize() {
        const w = window.innerWidth;
        if (w < 480) this.pixel = 8;
        else if (w < 900) this.pixel = 10;
        else this.pixel = 12;
    },

    resize() {
        if (!this.canvas) return;
        this._setPixelSize();
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },

    _buildCells() {
        const p = this.pixel;
        const cols = Math.ceil(this.canvas.width / p);
        const rows = Math.ceil(this.canvas.height / p);
        const fx = Math.random() * this.canvas.width;
        const fy = Math.random() * this.canvas.height;
        const arr = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const px = x * p + p / 2;
                const py = y * p + p / 2;
                const dx = px - fx;
                const dy = py - fy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const jitter = Math.random() * 80;
                arr.push({ x, y, key: dist + jitter });
            }
        }
        arr.sort((a, b) => a.key - b.key);
        return arr;
    },

    in() {
        return new Promise(resolve => {
            if (!this.canvas || Device.reducedMotion) return resolve();
            this.canvas.classList.add('active');
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            const cells = this._buildCells();
            this.cellsCache = cells;
            const total = cells.length;
            const p = this.pixel;
            const dur = Device.isLowPower ? 700 : 1100;
            let drawn = 0;
            const start = performance.now();

            const step = (now) => {
                const t = Math.min(1, (now - start) / dur);
                const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                const target = Math.floor(total * e);
                while (drawn < target && drawn < total) {
                    const c = cells[drawn];
                    this.ctx.fillStyle = '#000';
                    this.ctx.fillRect(c.x * p, c.y * p, p, p);
                    drawn++;
                }
                if (t < 1) requestAnimationFrame(step);
                else {
                    this.ctx.fillStyle = '#000';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    },

    out() {
        return new Promise(resolve => {
            if (!this.canvas || Device.reducedMotion) {
                if (this.canvas) this.canvas.classList.remove('active');
                return resolve();
            }
            const cells = (this.cellsCache || this._buildCells()).slice().reverse();
            const total = cells.length;
            const p = this.pixel;
            const dur = Device.isLowPower ? 500 : 800;
            let removed = 0;
            const start = performance.now();

            const step = (now) => {
                const t = Math.min(1, (now - start) / dur);
                const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                const target = Math.floor(total * e);
                while (removed < target && removed < total) {
                    const c = cells[removed];
                    this.ctx.clearRect(c.x * p, c.y * p, p, p);
                    removed++;
                }
                if (t < 1) requestAnimationFrame(step);
                else {
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.canvas.classList.remove('active');
                    this.cellsCache = null;
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }
};

/* ==========================================================
   СКРИМЕРЫ
   ========================================================== */
const Scream = {
    el: null,
    inner: null,
    enabled: true,
    busy: false,

    init() {
        this.el = document.getElementById('scream');
        this.inner = document.getElementById('screamInner');
    },

    variants: [
        { cls: 'scream--face',   text: 'ОСТАНЬСЯ',        snd: 1 },
        { cls: 'scream--blade',  text: 'НЕ ОБОРАЧИВАЙСЯ', snd: 2 },
        { cls: 'scream--static', text: '',                snd: 3 },
        { cls: 'scream--blood',  text: 'ПОМОГИ',          snd: 4 },
        { cls: 'scream--glitch', text: 'ОНО СМОТРИТ',     snd: 5 },
        { cls: 'scream--void',   text: '· · · · ·',       snd: 6 }
    ],

    async fire() {
        if (!this.enabled || this.busy || !this.el) return;
        if (Device.reducedMotion) return;
        if (document.hidden) return;

        this.busy = true;
        const v = this.variants[Math.floor(Math.random() * this.variants.length)];
        this.el.className = 'scream on ' + v.cls;
        this.inner.textContent = v.text;

        Audio_.scream(v.snd);

        document.body.style.transition = 'transform 0.04s';
        document.body.style.transform = `translate(${(Math.random()-0.5)*18}px,${(Math.random()-0.5)*18}px)`;

        const dur = 520 + Math.random() * 380;
        await new Promise(r => setTimeout(r, dur));

        this.el.className = 'scream';
        this.inner.textContent = '';
        document.body.style.transform = '';
        document.body.style.transition = '';

        this.busy = false;
    },

    schedule() {
        const next = () => {
            const delay = 120000 + Math.random() * 120000;
            setTimeout(() => {
                if (document.visibilityState === 'visible') this.fire();
                next();
            }, delay);
        };
        next();
    }
};

/* ==========================================================
   СЛУЧАЙНЫЕ ЭФФЕКТЫ
   ========================================================== */
const Fx = {
    glitch: null,
    blood: null,

    init() {
        this.glitch = document.getElementById('fxGlitch');
        this.blood = document.getElementById('bloodLayer');
    },

    triggerGlitch() {
        if (!this.glitch || Device.reducedMotion) return;
        this.glitch.classList.add('on');
        setTimeout(() => this.glitch.classList.remove('on'), 130 + Math.random() * 260);
    },

    triggerBlood() {
        if (!this.blood || Device.reducedMotion) return;
        this.blood.classList.add('on');
        setTimeout(() => this.blood.classList.remove('on'), 4200);
    },

    randomCursor() {
        if (Device.isTouch || Device.reducedMotion) return;
        const cursors = ['crosshair', 'cell', 'progress', 'wait', 'not-allowed', 'move', 'alias', 'grab'];
        document.body.style.cursor = cursors[Math.floor(Math.random() * cursors.length)];
        setTimeout(() => { document.body.style.cursor = 'crosshair'; }, 3000 + Math.random() * 5000);
    },

    start() {
        if (Device.reducedMotion) return;
        const gMul = Device.isLowPower ? 2 : 1;
        const bMul = Device.isLowPower ? 2 : 1;

        setInterval(() => { if (Math.random() < 0.4) this.triggerGlitch(); }, 30000 * gMul);
        setInterval(() => { if (Math.random() < 0.5) this.triggerBlood(); }, 180000 * bMul);
        setInterval(() => { if (Math.random() < 0.35) this.randomCursor(); }, 120000);
        setInterval(() => {
            if (Math.random() < 0.15) {
                this.triggerGlitch();
                setTimeout(() => this.triggerGlitch(), 120);
            }
        }, 90000 * gMul);
    }
};

/* ==========================================================
   «Проклятие» таблицы
   ========================================================== */
function hauntRoles() {
    const rows = document.querySelectorAll('.roles__row');
    if (!rows.length) return;
    const row = rows[Math.floor(Math.random() * rows.length)];
    const cell = row.querySelector('.roles__role');
    if (!cell) return;
    const orig = cell.textContent;
    const creepy = ['КРЫЛОВ', '№19', 'ЖДЁТ', 'СПИТ', 'НЕ ОТКЛ', 'ОНО'];
    cell.textContent = creepy[Math.floor(Math.random() * creepy.length)];
    row.classList.add('haunt');
    setTimeout(() => {
        cell.textContent = orig;
        row.classList.remove('haunt');
    }, 700);
}

/* ==========================================================
   ЗАПОЛНЕНИЕ ТЕКСТА ИЗ data.txt
   ========================================================== */
function applyData() {
    document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.getAttribute('data-key');
        const val = Data.get(key, null);
        if (val !== null && val !== '') el.textContent = val;
    });

    const tbody = document.getElementById('rolesBody');
    if (tbody) {
        const rows = tbody.querySelectorAll('.roles__row');
        rows.forEach((row, idx) => {
            const n = idx + 1;
            const raw = Data.get('роль' + n, null);
            if (raw === null) return;
            const parts = raw.split('|').map(s => s.trim());
            const role = parts[0] || '???';
            const status = parts[1] || 'свободна';
            const rCell = row.querySelector('.roles__role');
            const fCell = row.querySelector('.roles__free');
            if (rCell) rCell.textContent = role;
            if (fCell) fCell.textContent = status;
        });
    }
}

/* ==========================================================
   РЕНДЕР СТРАНИЦ
   ========================================================== */
const Pages = {
    render(page) {
        const tpl = document.getElementById('tpl-' + page);
        const content = document.getElementById('content');
        if (!tpl || !content) return;
        content.innerHTML = tpl.innerHTML;
        applyData();
    }
};

/* ==========================================================
   НАВИГАЦИЯ
   ========================================================== */
const Nav = {
    busy: false,
    current: null,
    scrollLockY: 0,
    validPages: ['info', 'roles', 'project', 'timeline', 'people', 'patient'],

    init() {
        const initial = this._pageFromHash() || 'roles';
        this.current = initial;
        this._paint(initial);

        document.addEventListener('click', (e) => {
            const link = e.target.closest('[data-nav]');
            if (!link) return;
            e.preventDefault();
            let page = link.getAttribute('data-page');
            if (!page) {
                const href = link.getAttribute('href') || '';
                const m = href.match(/#([a-z]+)/i);
                if (m) page = m[1];
            }
            if (!page) return;
            this.go(page);
        });

        window.addEventListener('hashchange', () => {
            const page = this._pageFromHash() || 'roles';
            if (page !== this.current) this.load(page, false);
        });
    },

    _pageFromHash() {
        const h = (location.hash || '').replace(/^#/, '').toLowerCase();
        return this.validPages.includes(h) ? h : null;
    },

    _paint(page) {
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('is-on', t.getAttribute('data-page') === page);
        });
    },

    _lockScroll() {
        this.scrollLockY = window.scrollY || window.pageYOffset || 0;
        document.documentElement.classList.add('is-locked');
        document.body.classList.add('is-locked');
        document.body.style.top = '-' + this.scrollLockY + 'px';
    },

    _unlockScroll() {
        document.documentElement.classList.remove('is-locked');
        document.body.classList.remove('is-locked');
        document.body.style.top = '';
        window.scrollTo(0, 0);
    },

    async go(page) {
        if (this.busy) return;
        if (page === this.current) return;
        if (!this.validPages.includes(page)) return;
        this.busy = true;

        Audio_.play('ui_click');
        this._lockScroll();
        await Pixel.in();
        Audio_.play('ui_transition');

        await this.load(page, true);

        await new Promise(r => setTimeout(r, 140));
        window.scrollTo(0, 0);
        this._unlockScroll();
        await Pixel.out();

        this.busy = false;
    },

    async load(page, pushHash) {
        if (!Data.loaded) await Data.load();
        Pages.render(page);
        this.current = page;
        this._paint(page);
        if (pushHash) {
            try { history.pushState({ page }, '', '#' + page); }
            catch (e) { location.hash = '#' + page; }
        }
    }
};

/* ==========================================================
   BOOT
   ========================================================== */
async function runBoot() {
    const log = document.getElementById('bootLog');
    const boot = document.getElementById('boot');
    if (!log || !boot) return;

    const lines = [
        'NIH-SFERA / node-04',
        'bootstrap...',
        'mount crypto-module ................. OK',
        'mount sense-deprivation ............ OK',
        'load archive index ................. OK',
        'query camera #1 ..................... ' + (Math.random() > 0.5 ? 'ACTIVE' : 'NO CARRIER'),
        'query camera #2 ..................... NO CARRIER',
        'query camera #3 ..................... NO CARRIER',
        'last known input: 12.03.1987',
        'guest session opened.'
    ];

    const speed = Device.isLowPower ? 90 : 170;
    for (const line of lines) {
        log.textContent += line + '\n';
        await new Promise(r => setTimeout(r, speed + Math.random() * speed * 1.4));
    }
    await new Promise(r => setTimeout(r, 400));
    boot.classList.add('done');
}

/* ==========================================================
   СОГЛАСИЕ
   ========================================================== */
function setupOath() {
    const oath = document.getElementById('oath');
    const btn = document.getElementById('oathBtn');
    const checks = document.querySelectorAll('.oath__chk');
    const screamEnable = document.getElementById('screamEnable');
    if (!oath || !btn) return;

    const update = () => {
        const all = Array.from(checks).every(c => c.checked);
        btn.disabled = !all;
    };
    checks.forEach(c => c.addEventListener('change', () => {
        Audio_.unlock();
        Audio_.play('ui_click');
        update();
    }));

    btn.addEventListener('click', async () => {
        Audio_.init();
        Audio_.unlock();
        Audio_.startAmbient();

        Scream.enabled = screamEnable ? screamEnable.checked : true;
        if (Scream.enabled) Scream.schedule();
        Fx.start();

        const shell = document.getElementById('shell');
        if (shell) shell.hidden = false;

        oath.classList.add('gone');
        setTimeout(() => { if (oath.parentNode) oath.remove(); }, 1000);

        await Data.load();
        const page = Nav._pageFromHash() || 'roles';
        Nav.current = page;
        Pages.render(page);
        Nav._paint(page);
    });
}

/* ==========================================================
   ГРОМКОСТЬ
   ========================================================== */
function setupVolume() {
    const vol = document.getElementById('vol');
    const mute = document.getElementById('muteBtn');
    if (vol) {
        const updatePct = () => {
            const pct = vol.value + '%';
            vol.style.setProperty('--vol-pct', pct);
        };
        const handler = () => {
            Audio_.setVol(parseInt(vol.value, 10) / 100);
            updatePct();
        };
        vol.addEventListener('input', handler);
        vol.addEventListener('change', handler);
        updatePct();
        Audio_.setVol(parseInt(vol.value, 10) / 100);
    }
    if (mute) {
        mute.addEventListener('click', () => {
            const m = Audio_.toggleMute();
            mute.textContent = m ? 'unmute' : 'mute';
        });
    }
}

/* ==========================================================
   РАЗБЛОКИРОВКА АУДИО
   ========================================================== */
function setupAudioUnlock() {
    const unlock = () => {
        Audio_.unlock();
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock);
}

/* ==========================================================
   ДВОЙНОЙ ТАП
   ========================================================== */
function setupDoubleTapPrevent() {
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTouch <= 300) e.preventDefault();
        lastTouch = now;
    }, { passive: false });
}

/* ==========================================================
   ГЛАВНЫЙ ЦИКЛ
   ========================================================== */
window.addEventListener('DOMContentLoaded', async () => {
    Pixel.init();
    Scream.init();
    Fx.init();
    Nav.init();
    setupVolume();
    setupOath();
    setupAudioUnlock();
    if (Device.isTouch) setupDoubleTapPrevent();

    setInterval(hauntRoles, 7000);

    setInterval(() => {
        if (Device.isLowPower) return;
        const docs = document.querySelectorAll('.doc');
        if (!docs.length) return;
        if (Math.random() > 0.7) return;
        const d = docs[0];
        d.style.transition = 'transform 0.1s';
        d.style.transform = `translate(${(Math.random()-0.5)*3}px, ${(Math.random()-0.5)*3}px)`;
        setTimeout(() => { d.style.transform = ''; }, 120);
    }, 15000);

    Data.load();

    await runBoot();
});
})();