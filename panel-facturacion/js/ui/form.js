/**
 * Lectura y validación de formularios. No conoce el dominio (dinero, fechas):
 * devuelve tipos nativos (string, number, boolean) y quien llama decide cómo
 * interpretarlos, por ejemplo con `parsear()` de `domain/money.js`.
 */

export function leerFormulario(form) {
  const datos = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;

    if (el.type === 'checkbox') { datos[el.name] = el.checked; continue; }
    if (el.type === 'radio') { if (el.checked) datos[el.name] = el.value; continue; }
    if (el.type === 'number' || el.type === 'range') {
      datos[el.name] = el.value === '' ? null : Number(el.value);
      continue;
    }
    if (el.tagName === 'SELECT' && el.multiple) {
      datos[el.name] = [...el.selectedOptions].map((op) => op.value);
      continue;
    }
    datos[el.name] = el.value;
  }
  return datos;
}

/** Validación nativa del navegador (required, pattern, min, max...). */
export function formularioValido(form) {
  return form.reportValidity();
}

/** Errores de negocio que la validación nativa no puede expresar (p. ej. "el email ya existe"). */
export function marcarErrores(form, errores) {
  for (const [nombre, mensaje] of Object.entries(errores)) {
    const el = form.elements[nombre];
    if (!el) continue;
    el.setCustomValidity(mensaje);
    el.closest('.campo')?.classList.add('campo--invalido');
  }
  form.reportValidity();
}

export function limpiarErrores(form) {
  for (const el of form.elements) el.setCustomValidity?.('');
  form.querySelectorAll('.campo--invalido').forEach((el) => el.classList.remove('campo--invalido'));
}
