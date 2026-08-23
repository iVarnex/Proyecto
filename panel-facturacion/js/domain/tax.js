/**
 * Impuestos y totales.
 *
 * Nota fiscal: los porcentajes y el orden reflejan el caso común de servicios
 * en Colombia, pero cambian según el régimen, si eres declarante, el municipio
 * (ReteICA) y si exportas servicios (suele estar excluido de IVA). Todo es
 * configurable en Ajustes: la app calcula lo que se le diga, no decide.
 *
 * Módulo puro: no toca el DOM.
 */

import { multiplicar, porcentaje } from './money.js';
import { convertir } from './fx.js';

const POR_MIL = 1000;

export const IMPUESTOS_EN_CERO = { ivaPct: 0, reteFuentePct: 0, reteIcaPorMil: 0 };

/**
 * El orden no es negociable:
 *   subtotal → descuento → IVA sobre la base → retenciones sobre la base → total.
 * Las retenciones se calculan sobre la base, nunca sobre base+IVA, y RESTAN:
 * el cliente las paga a la DIAN en tu nombre.
 */
export function calcularTotales(factura) {
  const { items = [], descuentoPct = 0, impuestos = IMPUESTOS_EN_CERO, moneda, fx } = factura;

  const subtotal = items.reduce(
    (acc, item) => acc + multiplicar(item.precioUnitario, item.cantidad),
    0,
  );

  const descuento = porcentaje(subtotal, descuentoPct);
  const base = subtotal - descuento;

  const iva = porcentaje(base, impuestos.ivaPct ?? 0);
  const reteFuente = porcentaje(base, impuestos.reteFuentePct ?? 0);
  const reteIca = multiplicar(base, (impuestos.reteIcaPorMil ?? 0) / POR_MIL);

  const total = base + iva - reteFuente - reteIca;
  const totalEnBase = fx ? convertir(total, fx.tasa, moneda, fx.hacia) : total;

  return { subtotal, descuento, base, iva, reteFuente, reteIca, total, totalEnBase };
}

/**
 * Impuestos que aplican por defecto a un cliente.
 * Exportación de servicios: el cliente está fuera de Colombia y no se factura
 * IVA ni se practican retenciones locales.
 */
export function impuestosPorDefecto(ajustes, cliente) {
  const esExportacion = cliente?.pais && cliente.pais !== 'CO';
  if (esExportacion) return { ...IMPUESTOS_EN_CERO, motivo: 'exportación de servicios' };

  const { ivaPct, reteFuentePct, reteIcaPorMil, aplicarIvaPorDefecto } = ajustes.impuestos;
  return {
    ivaPct: aplicarIvaPorDefecto ? ivaPct : 0,
    reteFuentePct,
    reteIcaPorMil,
  };
}
