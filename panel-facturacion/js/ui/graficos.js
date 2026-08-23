/**
 * Anima el crecimiento de barras (`[data-alto]` para gráficos verticales,
 * `[data-ancho]` para horizontales) desde 0 hasta su valor real.
 *
 * En dos pasos: se pintan en 0% en el HTML inicial y aquí se fuerza un
 * frame antes de ponerles el valor real — una transición CSS no anima un
 * valor que ya nace así en el primer render. Sin librerías: solo
 * `requestAnimationFrame`. Se desactiva si el sistema pide
 * `prefers-reduced-motion`.
 */
export function animarBarras(contenedor = document) {
  const prefiereMovimiento = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const altos = [...contenedor.querySelectorAll('[data-alto]')];
  const anchos = [...contenedor.querySelectorAll('[data-ancho]')];

  const aplicar = () => {
    altos.forEach((el) => { el.style.height = `${el.dataset.alto}%`; });
    anchos.forEach((el) => { el.style.width = `${el.dataset.ancho}%`; });
  };

  if (!prefiereMovimiento) { aplicar(); return; }
  requestAnimationFrame(aplicar);
}
