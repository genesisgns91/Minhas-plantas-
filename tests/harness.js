// Ambiente de testes: carrega o app num navegador simulado (jsdom) com Firebase falso.
const ROOT = require('path').resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const { execSync } = require('child_process');
const SITE = ROOT + '/';

let fails = 0, passes = 0;
function check(name, cond, extra = '') {
  if (cond) { passes++; console.log('  ✔', name); } else { fails++; console.log('  ✘', name, extra); }
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

async function boot({ user = null, pushUrl = '', seed, popupUser = null } = {}) {
  execSync(`node -e "import('./bundle.mjs').then(m => m.bundle({ pushUrl: '${pushUrl}' }))"`, { cwd: __dirname, stdio: 'pipe' });
  const html = fs.readFileSync(SITE + 'index.html', 'utf8').replace(/<script type="module" src="js\/main.js"><\/script>/, '');
  const bundle = fs.readFileSync('/tmp/app.bundle.js', 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message || e)));
  vc.on('error', e => errors.push('console.error: ' + e));
  vc.on('warn', () => {});
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const { window } = dom;
  const style = window.document.createElement('style');
  style.textContent = fs.readFileSync(SITE + 'style.css', 'utf8');
  window.document.head.appendChild(style);
  window.__TEST__ = true;
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.eval(bundle);
  const fb = window.__fbstate;
  if (seed) seed(fb.data);
  fb.popupUser = popupUser;
  await tick(10);
  if (user) fb.setUser(user);
  await tick(80);
  return { window, document: window.document, fb, data: fb.data, errors, app: window.__app, toasts: () => [...window.document.querySelectorAll('.toast')].map(t => t.textContent).join('|') };
}

module.exports = { boot, check, tick, summary: () => { console.log(fails ? `\n❌ ${fails} falhas (${passes} ok)` : `\n✅ ${passes} verificações passaram`); return fails; } };
