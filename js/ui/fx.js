import { $, prefersReducedMotion, rand } from '../utils.js';

// ---------- Efeitos: ripple de pétala, gotas, brilhos, chuva de pétalas ----------
document.addEventListener('pointerdown', (e) => {
  const target = e.target.closest('.btn:not(.burger), .chip, .quick-btn, .fab');
  if (!target || target.disabled || prefersReducedMotion) return;
  const rect = target.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = (e.clientX - rect.left) + 'px';
  span.style.top = (e.clientY - rect.top) + 'px';
  target.appendChild(span);
  setTimeout(() => span.remove(), 750);
});

export function spawnFx(className, text, x, y, dx, dy, dur, rot = 0) {
  const el = document.createElement('span');
  el.className = `fx ${className}`;
  if (text) el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--dx', dx + 'px');
  el.style.setProperty('--dy', dy + 'px');
  el.style.setProperty('--rot', rot + 'deg');
  el.style.setProperty('--dur', dur + 's');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), dur * 1000 + 100);
}

export function burst(sourceEl, kind) {
  if (prefersReducedMotion || !sourceEl) return;
  const r = sourceEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  if (kind === 'lastWater') {
    for (let i = 0; i < 9; i++) spawnFx('drop', '', cx + rand(-18, 18), cy - 6, rand(-34, 34), rand(70, 130), rand(.7, 1.1));
    return;
  }
  const sets = { lastFertilizer: ['✨', '🧪', '🌿'], lastPruning: ['🍃', '✂️', '🍃'], lastRepot: ['🌱', '🪴', '🌱'] };
  const set = sets[kind] || ['✨'];
  for (let i = 0; i < 7; i++) {
    spawnFx('emoji', set[i % set.length], cx + rand(-14, 14), cy, rand(-60, 60), rand(-130, -60), rand(.9, 1.4), rand(-40, 40));
  }
}

export function petalRain(count = 28) {
  if (prefersReducedMotion) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'fx petalfx' + (i % 4 === 0 ? ' leaf' : '');
    el.style.left = rand(0, window.innerWidth) + 'px';
    el.style.top = '-24px';
    el.style.setProperty('--dx', rand(-140, 140) + 'px');
    el.style.setProperty('--dy', (window.innerHeight + 60) + 'px');
    el.style.setProperty('--rot', rand(180, 540) + 'deg');
    el.style.setProperty('--dur', rand(1.8, 3) + 's');
    el.style.animationDelay = rand(0, .5) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }
}

// Pétalas e folhas flutuando no fundo
(function initPetals() {
  const wrap = $('petals');
  if (!wrap || prefersReducedMotion) return;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('span');
    p.className = 'petal' + (i % 3 === 0 ? ' leaf' : '');
    p.style.left = rand(0, 100) + '%';
    p.style.setProperty('--s', rand(12, 24) + 'px');
    p.style.setProperty('--d', rand(22, 40) + 's');
    p.style.setProperty('--delay', (-rand(0, 40)) + 's');
    p.style.setProperty('--sway', rand(-70, 90) + 'px');
    wrap.appendChild(p);
  }
})();
