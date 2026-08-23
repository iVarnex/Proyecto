/**
 * Hash router. `#/clientes/cli_k3n8` funciona con `file://` y sin servidor
 * (a diferencia del History API, que necesita que el servidor sepa devolver
 * index.html para cualquier ruta).
 */

const rutas = [];
let rutaNoEncontrada = () => {};

/** `patron`: `/clientes` o `/clientes/:id`. */
export function ruta(patron, manejador) {
  const nombres = [];
  const regex = new RegExp(
    '^' + patron.replace(/:([^/]+)/g, (_, nombre) => {
      nombres.push(nombre);
      return '([^/]+)';
    }) + '$',
  );
  rutas.push({ regex, nombres, manejador });
}

export function rutaPorDefecto(manejador) {
  rutaNoEncontrada = manejador;
}

function resolver() {
  const hash = location.hash.slice(1) || '/';

  for (const { regex, nombres, manejador } of rutas) {
    const coincidencia = hash.match(regex);
    if (!coincidencia) continue;
    const parametros = Object.fromEntries(nombres.map((nombre, i) => [nombre, coincidencia[i + 1]]));
    manejador(parametros);
    return;
  }

  rutaNoEncontrada();
}

export function navegar(hash) {
  location.hash = hash;
}

export function iniciarRouter() {
  window.addEventListener('hashchange', resolver);
  resolver();
}
