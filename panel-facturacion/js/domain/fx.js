/**
 * Tasas de cambio.
 *
 * Dos reglas que sostienen los números históricos:
 *   1. La tasa se congela con el documento. Una factura emitida guarda la tasa
 *      de ese día; si mañana la TRM sube, la factura no cambia.
 *   2. Se guarda el monto original y el convertido. Recalcular el segundo en
 *      cada render haría bailar los ingresos históricos a diario.
 *
 * `obtenerTasa` es la única función del módulo que no es pura (hace fetch);
 * recibe la caché y el reloj por parámetro para poder probarla.
 */

import { factorDe } from './money.js';

const VIGENCIA_MS = 4 * 60 * 60 * 1000;
const API_TASAS = 'https://open.er-api.com/v6/latest';

export const claveTasa = (desde, hacia) => `${desde}_${hacia}`;

export async function obtenerTasa(desde, hacia, cache = {}, ahora = Date.now()) {
  if (desde === hacia) return { tasa: 1, fuente: 'identidad', ts: ahora };

  const guardada = cache[claveTasa(desde, hacia)];
  if (guardada && ahora - guardada.ts < VIGENCIA_MS) return guardada;

  try {
    const respuesta = await fetch(`${API_TASAS}/${desde}`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

    const datos = await respuesta.json();
    const tasa = datos.rates?.[hacia];
    if (!tasa) throw new Error(`La API no devolvió tasa para ${hacia}`);

    return { tasa, ts: ahora, fuente: 'open.er-api' };
  } catch (error) {
    /* degradación: una tasa vencida sirve más que un error, pero se marca como tal */
    if (guardada) return { ...guardada, vencida: true, motivo: error.message };
    throw new Error(`No se pudo obtener la tasa ${desde}→${hacia}: ${error.message}. Ingrésala manualmente.`);
  }
}

/** Convierte entre monedas respetando los decimales de cada una. */
export function convertir(centavos, tasa, monedaOrigen, monedaDestino) {
  const valor = centavos / factorDe(monedaOrigen);
  return Math.round(valor * tasa * factorDe(monedaDestino));
}

/** Snapshot que se congela dentro de la factura al emitirla. */
export function snapshotFx({ desde, hacia, tasa, fuente }, ahora = new Date()) {
  return { desde, hacia, tasa, fuente, capturadaEn: ahora.toISOString() };
}

export const esTasaVencida = (registro, ahora = Date.now()) =>
  Boolean(registro) && ahora - registro.ts >= VIGENCIA_MS;
