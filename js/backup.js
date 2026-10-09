// Backup (JSON), restauração e exportação para Excel (uma linha por vaso).
import { S } from './state.js';
import { loadScript, downloadBlob, fmtDate } from './utils.js';
import { db, doc, writeBatch } from './firebase.js';
import { toast, friendlyError } from './ui/feedback.js';
import { askConfirm } from './ui/dialogs.js';
import { buildWorkbook } from './excel.js';

const stripId = ({ firestoreId, ownerId, ...rest }) => rest;
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------- Backup em JSON ----------
export function exportBackup() {
  const payload = {
    app: 'minhas-plantas', version: 2, exportedAt: new Date().toISOString(),
    species: S.species.map(s => ({ id: s.firestoreId, ...stripId(s) })),
    vases: S.vases.map(v => ({ id: v.firestoreId, ...stripId(v) }))
  };
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `minhas-plantas-backup-${stamp()}.json`);
  toast('Backup salvo 💾');
}

/** Valida e normaliza o conteúdo de um arquivo de backup. Lança erro com mensagem amigável se inválido. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('O arquivo não é um backup válido (JSON ilegível).'); }
  if (!data || data.app !== 'minhas-plantas' || !Array.isArray(data.species) || !Array.isArray(data.vases)) {
    throw new Error('Este arquivo não parece ser um backup do Minhas Plantas.');
  }
  const clean = (list) => list.filter(x => x && typeof x.id === 'string' && x.id).map(x => { const { id, ...rest } = x; return { id, data: rest }; });
  return { species: clean(data.species), vases: clean(data.vases), exportedAt: data.exportedAt };
}

export async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = parseBackup(await file.text());
    const total = parsed.species.length + parsed.vases.length;
    if (!total) { toast('O backup está vazio.', 'error'); return; }
    const ok = await askConfirm(`Restaurar ${parsed.species.length} espécies e ${parsed.vases.length} vasos${parsed.exportedAt ? ' (backup de ' + fmtDate(parsed.exportedAt) + ')' : ''}? Itens com o mesmo código serão substituídos; os demais continuam como estão.`, { icon: '📥', okLabel: 'Restaurar' });
    if (!ok) return;
    const jobs = [...parsed.species.map(x => ['species', x]), ...parsed.vases.map(x => ['vases', x])];
    for (let i = 0; i < jobs.length; i += 400) {
      const batch = writeBatch(db);
      jobs.slice(i, i + 400).forEach(([col, x]) => batch.set(doc(db, col, x.id), { ...x.data, ownerId: S.user.uid }));
      await batch.commit();
    }
    toast(`Backup restaurado: ${total} itens ✅`);
  } catch (err) {
    toast(err.message || friendlyError(err), 'error');
  }
}

// ---------- Excel ----------
export async function exportExcel() {
  if (!S.vases.length && !S.species.length) { toast('Ainda não há nada para exportar.', 'error'); return; }
  try {
    toast('Preparando a planilha…');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    const wb = buildWorkbook(window.ExcelJS, S.species, S.vases);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `minhas-plantas-${stamp()}.xlsx`);
    toast('Planilha exportada 📊');
  } catch (err) {
    toast('Não foi possível gerar a planilha: ' + friendlyError(err), 'error');
  }
}
