/**
 * Filtro de tabla instantáneo, sin pasar por el store.
 *
 * Oculta/muestra filas por coincidencia de texto directamente en el DOM en
 * cada tecla. Deliberadamente NO dispara un re-render de la vista: el término
 * de búsqueda no es un dato de negocio, y re-renderizar la vista completa en
 * cada tecla recrearía el propio campo de texto y le haría perder el foco.
 */
export function activarFiltro(input, contenedor) {
  if (!input || !contenedor) return;

  input.addEventListener('input', () => {
    const termino = input.value.trim().toLowerCase();
    const filas = contenedor.querySelectorAll('[data-buscar]');
    let visibles = 0;

    filas.forEach((fila) => {
      const coincide = fila.dataset.buscar.includes(termino);
      fila.hidden = !coincide;
      if (coincide) visibles += 1;
    });

    const vacio = contenedor.querySelector('[data-sin-resultados]');
    if (vacio) vacio.hidden = termino === '' || visibles > 0;
  });
}
