// Roda todos os testes em sequência e resume o resultado. Uso: npm test
const { spawnSync } = require('child_process');
const path = require('path');
const suites = [
  ['Login e isolamento entre contas', 't_auth.js'],
  ['Fotos (Cloudinary), desfazer e histórico', 't_cloud.js'],
  ['Pragas, tratamentos e agenda', 't_pests_agenda.js'],
  ['Tema, configurações, backup e notificações (app)', 't_misc.js'],
  ['Excel, service worker e contraste', 't_node.js'],
  ['Compartilhar: imagem e vídeo', 't_share.js'],
  ['Acessibilidade (axe-core), foco e ligações do HTML', 't_a11y.js'],
  ['Notificações (Worker)', 'push_test.mjs'],
  ['Telas principais, filtros, galeria, IA', 'smoke.js']
];
let failed = 0;
for (const [name, file] of suites) {
  process.stdout.write(`\n━━ ${name} (${file})\n`);
  const r = spawnSync('node', [path.join(__dirname, file)], { cwd: __dirname, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const lines = out.split('\n').filter(l => /✘|❌|✅|FALHA|Error/.test(l));
  console.log(lines.join('\n') || out.split('\n').slice(-4).join('\n'));
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n❌ ${failed} grupo(s) com falha` : '\n✅ Todos os grupos de testes passaram');
process.exit(failed ? 1 : 0);
