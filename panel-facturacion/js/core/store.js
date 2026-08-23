/**
 * Estado central + suscripciones + acciones.
 *
 * Las acciones de aquí son la ÚNICA forma de modificar `estado`. Nunca se
 * muta: cada acción arma un objeto nuevo y llama a `emitir()`, que persiste
 * y notifica a las vistas suscritas. Los cálculos de negocio (totales,
 * impuestos, numeración) viven en `domain/`; este módulo solo orquesta.
 */

import { cargar, guardar, guardarYa, exportar, importar as importarRespaldo, borrarTodo as borrarRespaldo } from './db.js';
import { nuevoId } from '../domain/id.js';
import { hoyLocal, segundosTranscurridos } from '../domain/time.js';
import {
  nuevoBorrador,
  crearBorradorDesdeHoras,
  emitirFactura as emitirFacturaDominio,
  anularFactura as anularFacturaDominio,
  registrarPago as registrarPagoDominio,
  eliminarPago as eliminarPagoDominio,
} from '../domain/invoice.js';
import { calcularTotales } from '../domain/tax.js';

let estado = cargar();
const suscriptores = new Set();

export const getEstado = () => estado;

export function suscribir(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

function emitir() {
  guardar(estado);
  suscriptores.forEach((fn) => fn(estado));
}

function aplicar(estadoNuevo) {
  estado = estadoNuevo;
  emitir();
}

/* ==========================================================
   Clientes
   ========================================================== */

export function crearCliente(datos) {
  const cliente = { id: nuevoId('cli'), activo: true, creadoEn: new Date().toISOString(), ...datos };
  aplicar({ ...estado, clientes: [...estado.clientes, cliente] });
  return cliente.id;
}

export function actualizarCliente(id, cambios) {
  aplicar({
    ...estado,
    clientes: estado.clientes.map((c) => (c.id === id ? { ...c, ...cambios } : c)),
  });
}

export function eliminarCliente(id) {
  if (estado.proyectos.some((p) => p.clienteId === id)) {
    throw new Error('No se puede eliminar: tiene proyectos asociados. Elimínalos primero.');
  }
  aplicar({ ...estado, clientes: estado.clientes.filter((c) => c.id !== id) });
}

/* ==========================================================
   Proyectos
   ========================================================== */

export function crearProyecto(datos) {
  const proyecto = {
    id: nuevoId('pry'),
    tarifaHora: null,
    moneda: null,
    presupuestoHoras: null,
    estado: 'activo',
    color: '#4f8fd6',
    ...datos,
  };
  aplicar({ ...estado, proyectos: [...estado.proyectos, proyecto] });
  return proyecto.id;
}

export function actualizarProyecto(id, cambios) {
  aplicar({
    ...estado,
    proyectos: estado.proyectos.map((p) => (p.id === id ? { ...p, ...cambios } : p)),
  });
}

/** Integridad referencial a mano: no dejar registros huérfanos ni horas ya facturadas sueltas. */
export function eliminarProyecto(id) {
  const tieneRegistrosFacturados = estado.registros.some((r) => r.proyectoId === id && r.facturaId);
  if (tieneRegistrosFacturados) {
    throw new Error('No se puede eliminar: tiene horas ya facturadas. Ciérralo en su lugar.');
  }
  aplicar({
    ...estado,
    proyectos: estado.proyectos.filter((p) => p.id !== id),
    registros: estado.registros.filter((r) => r.proyectoId !== id),
  });
}

/* ==========================================================
   Registro de horas (entrada manual)
   ========================================================== */

export function crearRegistro(datos) {
  const registro = {
    id: nuevoId('reg'),
    inicioTs: null,
    finTs: null,
    facturable: true,
    facturaId: null,
    ...datos,
  };
  aplicar({ ...estado, registros: [...estado.registros, registro] });
  return registro.id;
}

export function actualizarRegistro(id, cambios) {
  const registro = estado.registros.find((r) => r.id === id);
  if (registro?.facturaId) throw new Error('No se puede editar: ya está incluido en una factura.');
  aplicar({
    ...estado,
    registros: estado.registros.map((r) => (r.id === id ? { ...r, ...cambios } : r)),
  });
}

export function eliminarRegistro(id) {
  const registro = estado.registros.find((r) => r.id === id);
  if (registro?.facturaId) throw new Error('No se puede eliminar: ya está incluido en una factura.');
  aplicar({ ...estado, registros: estado.registros.filter((r) => r.id !== id) });
}

/* ==========================================================
   Cronómetro
   ========================================================== */

export function iniciarCronometro(proyectoId, ahora = Date.now()) {
  if (estado.cronometro) throw new Error('Ya hay un cronómetro corriendo. Deténlo antes de iniciar otro.');
  aplicar({ ...estado, cronometro: { proyectoId, inicioTs: ahora, pausas: [] } });
}

export function pausarCronometro(ahora = Date.now()) {
  if (!estado.cronometro || estado.cronometro.pausas.at(-1)?.fin === undefined) {
    if (!estado.cronometro) throw new Error('No hay cronómetro corriendo.');
  }
  aplicar({
    ...estado,
    cronometro: { ...estado.cronometro, pausas: [...estado.cronometro.pausas, { inicio: ahora, fin: undefined }] },
  });
}

export function reanudarCronometro(ahora = Date.now()) {
  if (!estado.cronometro) throw new Error('No hay cronómetro corriendo.');
  aplicar({
    ...estado,
    cronometro: {
      ...estado.cronometro,
      pausas: estado.cronometro.pausas.map((p, i, arr) => (i === arr.length - 1 ? { ...p, fin: ahora } : p)),
    },
  });
}

/** Convierte el cronómetro en un registro y lo cierra. */
export function detenerCronometro(descripcion = '', ahora = Date.now()) {
  const cronometro = estado.cronometro;
  if (!cronometro) throw new Error('No hay cronómetro corriendo.');

  const segundos = segundosTranscurridos(cronometro.inicioTs, cronometro.pausas, ahora);
  const registro = {
    id: nuevoId('reg'),
    proyectoId: cronometro.proyectoId,
    fecha: hoyLocal(new Date(ahora)),
    inicioTs: cronometro.inicioTs,
    finTs: ahora,
    segundos,
    descripcion,
    facturable: true,
    facturaId: null,
  };
  aplicar({ ...estado, registros: [...estado.registros, registro], cronometro: null });
  return registro.id;
}

export function descartarCronometro() {
  aplicar({ ...estado, cronometro: null });
}

/* ==========================================================
   Facturas
   ========================================================== */

export function crearFactura(clienteId) {
  const borrador = nuevoBorrador(estado, clienteId);
  aplicar({ ...estado, facturas: [...estado.facturas, borrador] });
  return borrador.id;
}

export function crearFacturaDesdeHoras(clienteId, opciones) {
  const borrador = crearBorradorDesdeHoras(estado, clienteId, opciones);
  aplicar({ ...estado, facturas: [...estado.facturas, borrador] });
  return borrador.id;
}

function conFactura(id, transformar) {
  aplicar({
    ...estado,
    facturas: estado.facturas.map((f) => (f.id === id ? transformar(f) : f)),
  });
}

function factura(id) {
  const f = estado.facturas.find((x) => x.id === id);
  if (!f) throw new Error('La factura no existe.');
  if (f.estado !== 'borrador') throw new Error('La factura ya fue emitida: no se puede editar.');
  return f;
}

export function agregarItemFactura(facturaId, item) {
  factura(facturaId);
  conFactura(facturaId, (f) => ({ ...f, items: [...f.items, { id: nuevoId('itm'), registroIds: [], ...item }] }));
}

export function actualizarItemFactura(facturaId, itemId, cambios) {
  factura(facturaId);
  conFactura(facturaId, (f) => ({
    ...f,
    items: f.items.map((it) => (it.id === itemId ? { ...it, ...cambios } : it)),
  }));
}

export function eliminarItemFactura(facturaId, itemId) {
  factura(facturaId);
  conFactura(facturaId, (f) => ({ ...f, items: f.items.filter((it) => it.id !== itemId) }));
}

export function actualizarFactura(facturaId, cambios) {
  factura(facturaId);
  conFactura(facturaId, (f) => ({ ...f, ...cambios }));
}

export function eliminarBorrador(facturaId) {
  const f = factura(facturaId);
  aplicar({ ...estado, facturas: estado.facturas.filter((x) => x.id !== f.id) });
}

export function emitirFactura(facturaId) {
  aplicar(emitirFacturaDominio(estado, facturaId));
}

export function anularFactura(facturaId) {
  aplicar(anularFacturaDominio(estado, facturaId));
}

export function registrarPago(facturaId, pago) {
  aplicar(registrarPagoDominio(estado, facturaId, pago));
}

export function eliminarPago(facturaId, pagoId) {
  aplicar(eliminarPagoDominio(estado, facturaId, pagoId));
}

/** Recalcula los totales en vivo de un borrador tras cambiar ítems, descuento o impuestos. */
export function recalcularBorrador(facturaId) {
  const f = factura(facturaId);
  conFactura(facturaId, () => ({ ...f, totales: calcularTotales(f) }));
}

/* ==========================================================
   Ajustes y respaldo
   ========================================================== */

export function actualizarAjustes(cambios) {
  aplicar({ ...estado, ajustes: { ...estado.ajustes, ...cambios } });
}

export function guardarTasaFx(clave, registro) {
  aplicar({ ...estado, fxCache: { ...estado.fxCache, [clave]: registro } });
}

export function exportarRespaldo() {
  guardarYa(estado);
  exportar(estado);
  aplicar({ ...estado, ajustes: { ...estado.ajustes, ultimoRespaldo: new Date().toISOString() } });
}

export async function importarRespaldoDesdeArchivo(archivo) {
  const estadoImportado = await importarRespaldo(archivo);
  aplicar(estadoImportado);
}

export function borrarTodo() {
  borrarRespaldo();
  estado = cargar();
  suscriptores.forEach((fn) => fn(estado));
}
