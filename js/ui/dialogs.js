import { $ } from '../utils.js';
import { trapFocus, releaseFocus, cycleTab } from './focus.js';

/**
 * Confirmação com botões Cancelar/Confirmar. Para ações de exclusão o foco começa em "Cancelar"
 * (o caminho seguro); Enter e Espaço funcionam no botão que estiver com foco.
 */
export function askConfirm(message, { icon = '🌿', okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = $('confirmOverlay');
    const ok = $('confirmOk');
    const cancel = $('confirmCancel');
    $('confirmMsg').textContent = message;
    $('confirmIco').textContent = icon;
    ok.textContent = okLabel;
    const destructive = danger || /exclu/i.test(okLabel);
    ok.classList.toggle('danger', destructive);
    overlay.classList.add('open');
    trapFocus(overlay, destructive ? cancel : ok);

    const finish = (value) => {
      overlay.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      releaseFocus(overlay);
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => { if (e.target === overlay) finish(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); return; }
      cycleTab(e, overlay);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}
