/**
 * Facturas: numeración, ciclo de vida y creación a partir de horas.
 *
 * Regla que gobierna el módulo: borrador = calculado en vivo, emitido =
 * congelado. Una factura emitida es un documento histórico; ni sus totales, ni
 * sus impuestos, ni su tasa de cambio pueden cambiar después.
 *
 * Módulo puro: recibe el estado y devuelve uno nuevo. `ahora` entra por
 * parámetro para que las pruebas no dependan del reloj.
 */

import { nuevoId } from './id.js';
import { calcularTotales, impuestosPorDefecto } from './tax.js';
import { hoyLocal, sumarDias, diasEntre, horasFacturables } from './time.js';

export const ESTADOS = ['borrador', 'enviada', 'pagada', 'vencida', 'anulada'];

export const ETIQUETA_ESTADO = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  pagada: 'Pagada',
  vencida: 'Vencida',
  anulada: 'Anulada',
};

export const siguienteNumero = ({ prefijo, siguiente, padding }) =>
  prefijo + String(siguiente).padStart(padding, '0');

/**
 * El estado `vencida` no se guarda: se deriva. Guardarlo obligaría a repasar
 * todas las facturas cada día para mantenerlo al corriente.
 */
export function estadoEfectivo(factura, hoy = hoyLocal()) {
  if (factura.estado !== 'enviada') return factura.estado;
  if (totalPagado(factura) >= factura.totales.total) return 'pagada';
  if (factura.venceEn < hoy) return 'vencida';
  return 'enviada';
}

export const totalPagado = (factura) =>
  (factura.pagos ?? []).reduce((acc, pago) => acc + pago.monto, 0);

export const saldoPendiente = (factura) =>
  Math.max(0, (factura.totales?.total ?? 0) - totalPagado(factura));

export const diasParaVencer = (factura, hoy = hoyLocal()) => diasEntre(hoy, factura.venceEn);

export const esEditable = (factura) => factura.estado === 'borrador';

/** Borrador vacío: sin número (se asigna al emitir) y sin totales congelados. */
export function nuevoBorrador(estado, clienteId, ahora = new Date()) {
  const cliente = estado.clientes.find((c) => c.id === clienteId);
  if (!cliente) throw new Error('El cliente no existe.');

  return {
    id: nuevoId('fac'),
    numero: null,
    clienteId,
    estado: 'borrador',
    emitidaEn: null,
    venceEn: null,
    creadaEn: hoyLocal(ahora),
    moneda: cliente.moneda,
    fx: null,
    items: [],
    descuentoPct: 0,
    impuestos: impuestosPorDefecto(estado.ajustes, cliente),
    totales: null,
    pagos: [],
    notas: '',
  };
}

/**
 * Emite un borrador: le asigna consecutivo, congela totales e impuestos, y
 * marca los registros de tiempo incluidos para que no se facturen dos veces.
 */
export function emitirFactura(estado, facturaId, ahora = new Date()) {
  const factura = estado.facturas.find((f) => f.id === facturaId);
  if (!factura) throw new Error('La factura no existe.');
  if (factura.estado !== 'borrador') throw new Error('La factura ya fue emitida.');
  if (factura.items.length === 0) throw new Error('Agrega al menos un ítem antes de emitir.');

  const numero = siguienteNumero(estado.ajustes.consecutivo);
  const emitidaEn = hoyLocal(ahora);
  const venceEn = sumarDias(emitidaEn, estado.ajustes.pago.diasVencimiento);
  const idsFacturados = new Set(factura.items.flatMap((item) => item.registroIds ?? []));

  return {
    ...estado,
    facturas: estado.facturas.map((f) => (f.id !== facturaId ? f : {
      ...f,
      numero,
      emitidaEn,
      venceEn,
      estado: 'enviada',
      totales: calcularTotales(f),
      impuestos: { ...f.impuestos },
    })),
    registros: estado.registros.map((r) => (idsFacturados.has(r.id) ? { ...r, facturaId } : r)),
    ajustes: {
      ...estado.ajustes,
      consecutivo: {
        ...estado.ajustes.consecutivo,
        siguiente: estado.ajustes.consecutivo.siguiente + 1,
      },
    },
  };
}

/** Anular libera las horas para que puedan volver a facturarse. */
export function anularFactura(estado, facturaId) {
  const factura = estado.facturas.find((f) => f.id === facturaId);
  if (!factura) throw new Error('La factura no existe.');
  if (factura.estado === 'anulada') throw new Error('La factura ya está anulada.');
  if (totalPagado(factura) > 0) {
    throw new Error('Tiene pagos registrados. Elimina los pagos antes de anularla.');
  }

  return {
    ...estado,
    facturas: estado.facturas.map((f) => (f.id !== facturaId ? f : { ...f, estado: 'anulada' })),
    registros: estado.registros.map((r) => (r.facturaId === facturaId ? { ...r, facturaId: null } : r)),
  };
}

export function registrarPago(estado, facturaId, pago) {
  const factura = estado.facturas.find((f) => f.id === facturaId);
  if (!factura) throw new Error('La factura no existe.');
  if (factura.estado === 'borrador') throw new Error('Emite la factura antes de registrar pagos.');
  if (factura.estado === 'anulada') throw new Error('La factura está anulada.');
  if (!pago.monto || pago.monto <= 0) throw new Error('El monto del pago debe ser mayor que cero.');

  const conPago = { ...factura, pagos: [...factura.pagos, { id: nuevoId('pag'), ...pago }] };
  /* `pagada` sí se guarda: es un hecho, no una fecha que se mueva sola */
  const estadoNuevo = totalPagado(conPago) >= conPago.totales.total ? 'pagada' : conPago.estado;

  return {
    ...estado,
    facturas: estado.facturas.map((f) => (f.id !== facturaId ? f : { ...conPago, estado: estadoNuevo })),
  };
}

export function eliminarPago(estado, facturaId, pagoId) {
  return {
    ...estado,
    facturas: estado.facturas.map((f) => {
      if (f.id !== facturaId) return f;
      const pagos = f.pagos.filter((p) => p.id !== pagoId);
      const siguePagada = pagos.reduce((a, p) => a + p.monto, 0) >= f.totales.total;
      return { ...f, pagos, estado: siguePagada ? 'pagada' : 'enviada' };
    }),
  };
}

/* ==========================================================
   Facturar horas
   ========================================================== */

/** Agrupa registros para convertirlos en líneas de factura. */
export function agrupar(registros, criterio, proyectos) {
  const nombreProyecto = (id) => proyectos.find((p) => p.id === id)?.nombre ?? 'Proyecto';
  const grupos = new Map();

  for (const registro of registros) {
    const clave = criterio === 'registro' ? registro.id
      : criterio === 'dia' ? `${registro.proyectoId}|${registro.fecha}`
      : registro.proyectoId;

    const etiqueta = criterio === 'registro' ? `${registro.descripcion || 'Trabajo'} (${registro.fecha})`
      : criterio === 'dia' ? `${nombreProyecto(registro.proyectoId)} — ${registro.fecha}`
      : nombreProyecto(registro.proyectoId);

    const grupo = grupos.get(clave) ?? { proyectoId: registro.proyectoId, etiqueta, segundos: 0, registros: [] };
    grupo.segundos += registro.segundos;
    grupo.registros.push(registro);
    grupos.set(clave, grupo);
  }

  return [...grupos.values()];
}

export function crearBorradorDesdeHoras(estado, clienteId, { desde, hasta, agruparPor = 'proyecto' }, ahora = new Date()) {
  const cliente = estado.clientes.find((c) => c.id === clienteId);
  if (!cliente) throw new Error('El cliente no existe.');

  const proyectosDelCliente = estado.proyectos
    .filter((p) => p.clienteId === clienteId)
    .map((p) => p.id);

  const candidatos = estado.registros.filter((r) =>
    proyectosDelCliente.includes(r.proyectoId)
    && r.facturable
    && r.facturaId === null
    && r.fecha >= desde
    && r.fecha <= hasta);

  if (candidatos.length === 0) {
    throw new Error('No hay horas pendientes de facturar en ese periodo.');
  }

  const borrador = nuevoBorrador(estado, clienteId, ahora);
  const items = agrupar(candidatos, agruparPor, estado.proyectos).map((grupo) => {
    const proyecto = estado.proyectos.find((p) => p.id === grupo.proyectoId);
    return {
      id: nuevoId('itm'),
      descripcion: grupo.etiqueta,
      cantidad: horasFacturables(grupo.segundos),
      precioUnitario: proyecto?.tarifaHora ?? cliente.tarifaHora,
      registroIds: grupo.registros.map((r) => r.id),
    };
  });

  return { ...borrador, items, moneda: cliente.moneda };
}

/** Totales en vivo para un borrador; congelados si ya se emitió. */
export const totalesDe = (factura) => factura.totales ?? calcularTotales(factura);
