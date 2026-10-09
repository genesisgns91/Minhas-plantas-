// Monta a planilha de exportação (uma linha por vaso + os dados da espécie). Sem acesso ao DOM: recebe a classe do ExcelJS.
import { daysBetween, fmtDate, isDataUrl } from './utils.js';
import { vasePhotos } from './photos.js';
import { waterStatus, activePests, SEVERITIES } from './care.js';

const COLS = [
  ['Espécie', 24], ['Outros nomes', 26], ['Categoria', 18], ['Vaso', 24], ['Tamanho / material', 20],
  ['Situação da rega', 22], ['Última rega', 14], ['Dias desde a rega', 12], ['Ritmo de rega (dias)', 12],
  ['Última adubação', 14], ['Ciclo de adubação (dias)', 13], ['Última poda', 14], ['Ciclo de poda (dias)', 12],
  ['Último transbordo', 14], ['Pragas ativas', 28], ['Fotos', 8], ['Foto mais recente', 22],
  ['Luz', 24], ['Rega (ficha)', 26], ['Poda (tolerância)', 22], ['Umidade', 20], ['Solo', 24],
  ['Adubação comercial', 26], ['Adubação natural', 26], ['Toxicidade para pets', 14], ['Detalhes da toxicidade', 30],
  ['Dica extra', 32], ['Observações', 32], ['Cadastrado em', 14]
];

const asDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };

/** Monta a planilha. Recebe a classe Workbook (ExcelJS) para poder ser testada fora do navegador. */
export function buildWorkbook(ExcelJS, species, vases, now = new Date()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Minhas Plantas'; wb.created = now;

  const ws = wb.addWorksheet('Vasos', { views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }] });
  ws.columns = COLS.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A5335' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'medium', color: { argb: 'FFB38B4D' } } };
  });

  const bySpecies = [...species].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const rows = [];
  bySpecies.forEach(sp => {
    const vs = vases.filter(v => v.speciesId === sp.firestoreId).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    if (!vs.length) rows.push([sp, null]); else vs.forEach(v => rows.push([sp, v]));
  });

  rows.forEach(([sp, v], i) => {
    const photos = v ? vasePhotos(v) : [];
    const latest = photos.length ? photos[photos.length - 1].photo : '';
    const ws8 = v ? waterStatus(v, sp) : null;
    const pests = v ? activePests(v).map(p => `${p.name} (${(SEVERITIES[p.severity] || SEVERITIES.leve).label.toLowerCase()})`).join('; ') : '';
    const lastWater = v && asDate(v.lastWater);
    const row = ws.addRow([
      sp.name || '', sp.scientific || '', sp.category || '', v ? v.name : '(nenhum vaso)', v ? (v.size || '') : '',
      ws8 ? ws8.title + (ws8.state === 'never' ? '' : ' · ' + ws8.sub) : '',
      lastWater, lastWater ? Math.max(0, daysBetween(lastWater, now)) : '', Number(sp.waterDays) || '',
      v ? asDate(v.lastFertilizer) : null, Number(sp.fertilizerDays) || '', v ? asDate(v.lastPruning) : null, Number(sp.pruningDays) || '',
      v ? asDate(v.lastRepot) : null, pests, photos.length || '',
      latest && !isDataUrl(latest) ? { text: 'Abrir foto', hyperlink: latest } : (latest ? '(guardada no app)' : ''),
      sp.light || '', sp.water || '', sp.pruning || '', sp.humidity || '', sp.soil || '', sp.fertilizer || '', sp.naturalFertilizer || '',
      sp.petToxicity || '', sp.petWarning || '', sp.extraTips || '', sp.observations || '', asDate(sp.createdAt)
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.font = { name: 'Calibri', size: 10, ...(v ? {} : { italic: true, color: { argb: 'FF8A8A8A' } }) };
    if (i % 2 === 1) row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5EE' } }; });
    [7, 10, 12, 14, 29].forEach(n => { row.getCell(n).numFmt = 'dd/mm/yyyy'; row.getCell(n).alignment = { vertical: 'top', horizontal: 'center' }; });
    [8, 9, 11, 13, 16].forEach(n => { row.getCell(n).alignment = { vertical: 'top', horizontal: 'center' }; });
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF3A5335' } };
    if (ws8 && (ws8.state === 'late' || ws8.state === 'due')) row.getCell(6).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB3322E' } };
    if (pests) row.getCell(15).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF8E5EA2' } };
    const link = row.getCell(17);
    if (link.value && link.value.hyperlink) link.font = { name: 'Calibri', size: 10, underline: true, color: { argb: 'FF1F6D8F' } };
    const tox = row.getCell(25);
    const toxColor = { 'Segura': 'FF2F7A40', 'Tóxica': 'FFB36B00', 'Letal': 'FFB3322E' }[sp.petToxicity];
    if (toxColor) tox.font = { name: 'Calibri', size: 10, bold: true, color: { argb: toxColor } };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // Segunda aba: histórico de pragas e tratamentos
  const wp = wb.addWorksheet('Pragas e tratamentos', { views: [{ state: 'frozen', ySplit: 1 }] });
  wp.columns = [['Espécie', 22], ['Vaso', 22], ['Praga / doença', 24], ['Gravidade', 12], ['Situação', 12], ['Detectada em', 14], ['Resolvida em', 14],
    ['Tratamentos', 50], ['Próxima aplicação', 16], ['Observações', 36]].map(([header, width]) => ({ header, width }));
  wp.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8E5EA2' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  vases.forEach(v => (v.pests || []).forEach(p => {
    const sp = species.find(s => s.firestoreId === v.speciesId);
    const treats = (p.treatments || []).map(t => `${fmtDate(t.date)} — ${t.product}${t.notes ? ' (' + t.notes + ')' : ''}`).join('\n');
    const nextDates = (p.treatments || []).filter(t => t.nextDate).sort((a, b) => new Date(b.date) - new Date(a.date));
    const r = wp.addRow([sp ? sp.name : '', v.name, p.name, (SEVERITIES[p.severity] || SEVERITIES.leve).label, p.status === 'resolved' ? 'Resolvida' : 'Ativa',
      asDate(p.date), asDate(p.resolvedAt), treats, p.status === 'resolved' || !nextDates.length ? null : asDate(nextDates[0].nextDate), p.notes || '']);
    r.alignment = { vertical: 'top', wrapText: true };
    [6, 7, 9].forEach(n => { r.getCell(n).numFmt = 'dd/mm/yyyy'; r.getCell(n).alignment = { vertical: 'top', horizontal: 'center' }; });
  }));
  return wb;
}
