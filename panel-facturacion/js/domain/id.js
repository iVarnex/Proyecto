/** Identificadores locales. Módulo puro salvo por la fuente de aleatoriedad. */

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin l/o/0/1: se confunden al leerlos
const LONGITUD = 4;

const aleatorios = (cantidad) => {
  const bytes = new Uint8Array(cantidad);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < cantidad; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};

/** nuevoId('cli') -> "cli_k3n8" */
export function nuevoId(prefijo) {
  const sufijo = [...aleatorios(LONGITUD)]
    .map((b) => ALFABETO[b % ALFABETO.length])
    .join('');
  return `${prefijo}_${sufijo}`;
}
