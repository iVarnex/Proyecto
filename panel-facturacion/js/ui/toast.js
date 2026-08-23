/**
 * Notificaciones apilables. `role="alert"` en los tipos que interrumpen
 * (error), `role="status"` en el resto: un lector de pantalla no debe gritar
 * cada confirmación de guardado.
 */

const DURACION_MS = 4000;
const ICONOS = { exito: '✓', info: 'ℹ', aviso: '⚠', error: '✕' };

let contenedor = null;

function asegurarContenedor() {
  if (contenedor) return contenedor;
  contenedor = document.createElement('div');
  contenedor.className = 'toast-pila';
  contenedor.setAttribute('aria-live', 'polite');
  document.body.appendChild(contenedor);
  return contenedor;
}

/* Se arma con creación de nodos, no con innerHTML: el mensaje puede traer
   texto de un cliente o proyecto y no debe interpretarse como marcado. */
export function mostrarToast(mensaje, tipo = 'info', duracionMs = DURACION_MS) {
  const pila = asegurarContenedor();

  const nodo = document.createElement('div');
  nodo.className = `toast toast--${tipo}`;
  nodo.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  const icono = Object.assign(document.createElement('span'), {
    className: 'toast__icono',
    textContent: ICONOS[tipo] ?? ICONOS.info,
  });
  icono.setAttribute('aria-hidden', 'true');
  const texto = Object.assign(document.createElement('span'), { className: 'toast__mensaje', textContent: mensaje });
  const cerrar = Object.assign(document.createElement('button'), {
    className: 'toast__cerrar',
    type: 'button',
    textContent: '✕',
  });
  cerrar.setAttribute('aria-label', 'Cerrar aviso');
  nodo.append(icono, texto, cerrar);

  const descartar = () => {
    nodo.classList.add('toast--saliendo');
    nodo.addEventListener('animationend', () => nodo.remove(), { once: true });
  };
  cerrar.addEventListener('click', descartar);
  pila.appendChild(nodo);
  if (duracionMs) setTimeout(descartar, duracionMs);
}

export const exito = (mensaje) => mostrarToast(mensaje, 'exito');
export const error = (mensaje) => mostrarToast(mensaje, 'error', 6000);
export const aviso = (mensaje) => mostrarToast(mensaje, 'aviso');
