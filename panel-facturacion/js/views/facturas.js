import { html, attr } from '../core/render.js';
import { formatear } from '../domain/money.js';
import { hoyLocal } from '../domain/time.js';
import { estadoEfectivo, ETIQUETA_ESTADO, totalesDe, totalPagado, saldoPendiente } from '../domain/invoice.js';
import { abrirModal, cerrarModal } from '../ui/modal.js';
import { leerFormulario, formularioValido } from '../ui/form.js';
import { activarFiltro } from '../ui/filtro.js';
import { error as toastError } from '../ui/toast.js';
import { navegar } from '../core/router.js';
import * as store from '../core/store.js';

const nombreCliente = (estado, id) => estado.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente';

export function vistaFacturas(estado) {
  if (estado.clientes.length === 0) {
    return html`
      <div class="vacio">
        <h2>Necesitas un cliente primero</h2>
        <a class="btn btn--primario" href="#/clientes">Ir a Clientes</a>
      </div>`;
  }

  if (estado.facturas.length === 0) {
    return html`
      <div class="vacio">
        <h2>Aún no has creado facturas</h2>
        <p>Crea una desde cero o a partir de horas ya registradas.</p>
        <button class="btn btn--primario" data-accion="nueva-factura" type="button">Nueva factura</button>
      </div>`;
  }

  const hoy = hoyLocal();
  const ordenadas = [...estado.facturas].sort((a, b) => (b.emitidaEn ?? '9999').localeCompare(a.emitidaEn ?? '9999'));

  return html`
    <header class="vista__cabecera">
      <h1>Facturas</h1>
      <div class="vista__acciones">
        <button class="btn" data-accion="exportar-csv-facturas" type="button">Exportar CSV</button>
        <button class="btn btn--primario" data-accion="nueva-factura" type="button">Nueva factura</button>
      </div>
    </header>
    <div class="barra-busqueda">
      <input type="search" id="buscar-facturas" placeholder="Buscar por número, cliente o estado..." aria-label="Buscar facturas">
    </div>
    <table class="tabla" id="tabla-facturas">
      <thead>
        <tr><th>Número</th><th>Cliente</th><th>Emitida</th><th>Vence</th><th class="num">Total</th><th>Estado</th></tr>
      </thead>
      <tbody>
        ${ordenadas.map((f) => {
      const efectivo = estadoEfectivo(f, hoy);
      const totales = totalesDe(f);
      const buscar = [f.numero ?? 'borrador', nombreCliente(estado, f.clienteId), ETIQUETA_ESTADO[efectivo]].join(' ').toLowerCase();
      return html`
          <tr data-buscar="${buscar}">
            <td><a href="#/facturas/${f.id}">${f.numero ?? 'Borrador'}</a></td>
            <td>${nombreCliente(estado, f.clienteId)}</td>
            <td>${f.emitidaEn ?? '—'}</td>
            <td>${f.venceEn ?? '—'}</td>
            <td class="num">${formatear(totales.total, f.moneda)}</td>
            <td><span class="chip chip--${efectivo}">${ETIQUETA_ESTADO[efectivo]}</span></td>
          </tr>`;
    })}
        <tr data-sin-resultados hidden><td colspan="6">Ninguna factura coincide con la búsqueda.</td></tr>
      </tbody>
    </table>`;
}

export function alActualizar() {
  activarFiltro(document.getElementById('buscar-facturas'), document.getElementById('tabla-facturas'));
}

function formularioNuevaFactura(estado) {
  const c = estado.clientes[0];
  return html`
    <h2>Nueva factura</h2>
    <form class="formulario" data-form="nueva-factura" novalidate>
      <label class="campo">
        <span>Cliente</span>
        <select name="clienteId" required autofocus>
          ${estado.clientes.map((cl) => html`<option value="${cl.id}" ${attr('selected', cl.id === c?.id)}>${cl.nombre}</option>`)}
        </select>
      </label>
      <label class="campo">
        <span>Origen</span>
        <select name="origen">
          <option value="blanco">Factura en blanco</option>
          <option value="horas">A partir de horas sin facturar</option>
        </select>
      </label>
      <div class="campo-grupo" data-campo="rango-horas" hidden>
        <label class="campo">
          <span>Desde</span>
          <input name="desde" type="date">
        </label>
        <label class="campo">
          <span>Hasta</span>
          <input name="hasta" type="date" value="${hoyLocal()}">
        </label>
      </div>
      <label class="campo" data-campo="rango-horas" hidden>
        <span>Agrupar líneas por</span>
        <select name="agruparPor">
          <option value="proyecto">Proyecto</option>
          <option value="dia">Proyecto y día</option>
          <option value="registro">Cada registro</option>
        </select>
      </label>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">Crear</button>
      </div>
    </form>`;
}

function abrirFormularioNuevaFactura(estado) {
  abrirModal(formularioNuevaFactura(estado));

  const form = document.querySelector('[data-form="nueva-factura"]');
  const camposHoras = form.querySelectorAll('[data-campo="rango-horas"]');
  form.origen.addEventListener('change', () => {
    const esHoras = form.origen.value === 'horas';
    camposHoras.forEach((el) => { el.hidden = !esHoras; });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;
    const datos = leerFormulario(form);

    try {
      const id = datos.origen === 'horas'
        ? store.crearFacturaDesdeHoras(datos.clienteId, { desde: datos.desde || '0000-01-01', hasta: datos.hasta, agruparPor: datos.agruparPor })
        : store.crearFactura(datos.clienteId);
      cerrarModal();
      navegar(`/facturas/${id}`);
    } catch (err) {
      toastError(err.message);
    }
  });
}

/* Excel evalúa como fórmula cualquier celda que empiece por = + - @ aunque venga entrecomillada. */
const PREFIJO_FORMULA = /^[=+\-@\t\r]/;

const celdaCsv = (valor) => {
  const texto = String(valor ?? '');
  const segura = PREFIJO_FORMULA.test(texto) ? `'${texto}` : texto;
  return `"${segura.replace(/"/g, '""')}"`;
};

const ENCABEZADO_CSV = ['Número', 'Cliente', 'Estado', 'Emitida', 'Vence', 'Moneda', 'Subtotal', 'Descuento', 'IVA', 'ReteFuente', 'ReteICA', 'Total', 'Pagado', 'Saldo'];

function facturasACsv(estado) {
  const filas = estado.facturas.map((f) => {
    const totales = totalesDe(f);
    const sinSimbolo = (centavos) => formatear(centavos, f.moneda, { conSimbolo: false });
    return [
      f.numero ?? 'Borrador',
      nombreCliente(estado, f.clienteId),
      ETIQUETA_ESTADO[estadoEfectivo(f)],
      f.emitidaEn ?? '',
      f.venceEn ?? '',
      f.moneda,
      sinSimbolo(totales.subtotal),
      sinSimbolo(totales.descuento),
      sinSimbolo(totales.iva),
      sinSimbolo(totales.reteFuente),
      sinSimbolo(totales.reteIca),
      sinSimbolo(totales.total),
      sinSimbolo(totalPagado(f)),
      sinSimbolo(saldoPendiente(f)),
    ];
  });

  return [ENCABEZADO_CSV, ...filas].map((fila) => fila.map(celdaCsv).join(',')).join('\r\n');
}

/** BOM al inicio: sin él, Excel en Windows no reconoce el archivo como UTF-8 y rompe las tildes. */
const BOM_UTF8 = '﻿';

function descargarCsvFacturas(estado) {
  const csv = BOM_UTF8 + facturasACsv(estado);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = Object.assign(document.createElement('a'), {
    href: url,
    download: `facturas-${hoyLocal()}.csv`,
  });
  enlace.click();
  URL.revokeObjectURL(url);
}

export const accionesFacturas = {
  'nueva-factura': (id, estado) => abrirFormularioNuevaFactura(estado),
  'exportar-csv-facturas': (id, estado) => descargarCsvFacturas(estado),
};
