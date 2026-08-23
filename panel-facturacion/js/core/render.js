/**
 * Render sin framework.
 *
 * `html` escapa por defecto: interpolar datos del usuario sin escapar es un XSS
 * esperando a pasar (un cliente llamado `<img onerror=...>` basta). Para inyectar
 * marcado a propósito hay que envolverlo en `crudo()`, que se ve en el diff.
 */

const escapar = (valor) => String(valor)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

/**
 * `html` devuelve un objeto `{ __raw, valor }`, no un string plano — a
 * propósito. Si devolviera un string, anidar una llamada a `html` dentro de
 * otra (`${cond ? html\`<b>x</b>\` : ''}`, fuera de un `.map()`) la
 * escaparía por segunda vez y el navegador mostraría "&lt;b&gt;x&lt;/b&gt;"
 * como texto en vez de negrita. Marcarlo como `__raw` hace que el
 * `reduce` de abajo la reconozca como marcado ya renderizado. El
 * `toString()` mantiene todo lo demás funcionando sin cambios: asignarlo a
 * `.innerHTML` (en `montar`) o meterlo en un array para `.join('')` lo
 * convierte a texto automáticamente.
 */
export function html(strings, ...valores) {
  const texto = strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const valor = valores[i - 1];

    if (Array.isArray(valor)) return acc + valor.join('') + str;   // fragmentos ya renderizados
    if (valor && valor.__raw) return acc + valor.valor + str;      // marcado explícito
    if (valor === null || valor === undefined || valor === false) return acc + str;

    return acc + escapar(valor) + str;
  }, '');

  return crudo(texto);
}

export const crudo = (valor) => ({ __raw: true, valor, toString: () => valor });

export function montar(contenedor, marcado) {
  contenedor.innerHTML = marcado;
}

/** Atributo condicional: `${attr('disabled', bloqueado)}` */
export const attr = (nombre, condicion) => crudo(condicion ? nombre : '');

export const clases = (...entradas) => entradas.filter(Boolean).join(' ');
