/**
 * Modal genérico con promesa: `abrirModal()` devuelve una promesa que se
 * resuelve con lo que se le pase a `cerrarModal(valor)`. Así un formulario en
 * modal se usa como `const datos = await abrirModal(...)` sin callbacks.
 *
 * Un solo overlay reutilizado, con foco atrapado dentro y Escape/clic-afuera
 * cerrando sin confirmar (se resuelve `undefined`).
 */

import { montar, html } from '../core/render.js';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let overlayEl = null;
let resolverActual = null;
let manejarClicActual = null;
let ultimoFoco = null;

function asegurarOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML = '<div class="modal" role="dialog" aria-modal="true"></div>';

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) { cerrarModal(); return; }
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    if (btn.dataset.accion === 'cerrar-modal') { cerrarModal(); return; }
    manejarClicActual?.(btn.dataset.accion, btn, e);
  });
  overlayEl.addEventListener('keydown', atraparFoco);
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function atraparFoco(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    cerrarModal();
    return;
  }
  if (e.key !== 'Tab') return;

  const items = [...overlayEl.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const [primero, ultimo] = [items[0], items[items.length - 1]];

  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primero.focus();
  }
}

/**
 * Abre el modal con `marcado` (html`` ya renderizado). `onClic(accion, boton, evento)`
 * recibe los `data-accion` del contenido que no sean `cerrar-modal` (ese lo maneja
 * el propio modal). Llamar a `cerrarModal(valor)` desde `onClic` resuelve la promesa.
 */
export function abrirModal(marcado, { onClic } = {}) {
  const overlay = asegurarOverlay();
  montar(overlay.querySelector('.modal'), marcado);

  manejarClicActual = onClic ?? null;
  ultimoFoco = document.activeElement;
  overlay.hidden = false;
  document.body.classList.add('modal-abierto');
  overlay.querySelector(FOCUSABLE)?.focus();

  return new Promise((resolve) => { resolverActual = resolve; });
}

export function cerrarModal(valor) {
  if (!overlayEl || overlayEl.hidden) return;
  overlayEl.hidden = true;
  document.body.classList.remove('modal-abierto');
  ultimoFoco?.focus();
  ultimoFoco = null;
  manejarClicActual = null;
  const resolver = resolverActual;
  resolverActual = null;
  resolver?.(valor);
}

/** Atajo para confirmaciones: `if (await confirmar('¿Eliminar cliente?')) ...` */
export function confirmar(mensaje, { textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar', peligroso = true } = {}) {
  return abrirModal(
    html`
      <p class="modal__mensaje">${mensaje}</p>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">${textoCancelar}</button>
        <button class="btn ${peligroso ? 'btn--peligro' : 'btn--primario'}" data-accion="confirmar-modal" type="button">${textoConfirmar}</button>
      </div>`,
    { onClic: (accion) => { if (accion === 'confirmar-modal') cerrarModal(true); } },
  );
}
