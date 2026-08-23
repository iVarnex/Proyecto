/**
 * Detalle de factura: el único lugar donde borrador y emitida se muestran
 * distinto. Borrador = todo editable, totales calculados en vivo con
 * `totalesDe()`. Emitida = todo bloqueado, se leen `f.totales` congelados.
 */

import { html, attr } from '../core/render.js';
import { formatear, parsear, multiplicar, MONEDAS } from '../domain/money.js';
import { obtenerTasa, claveTasa } from '../domain/fx.js';
import { ETIQUETA_ESTADO, estadoEfectivo, esEditable, totalesDe, totalPagado, saldoPendiente, diasParaVencer } from '../domain/invoice.js';
import { abrirModal, cerrarModal, confirmar } from '../ui/modal.js';
import { leerFormulario, formularioValido } from '../ui/form.js';
import { exito, error as toastError, aviso } from '../ui/toast.js';
import { navegar } from '../core/router.js';
import * as store from '../core/store.js';

const cliente = (estado, factura) => estado.clientes.find((c) => c.id === factura.clienteId);

function tablaItems(factura, editable) {
  return html`
    <table class="tabla tabla--items">
      <thead>
        <tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th>${editable ? html`<th></th>` : ''}</tr>
      </thead>
      <tbody>
        ${factura.items.length === 0 ? html`<tr><td colspan="5">Sin ítems todavía.</td></tr>` : factura.items.map((it) => html`
          <tr>
            <td>${it.descripcion}</td>
            <td class="num">${it.cantidad}</td>
            <td class="num">${formatear(it.precioUnitario, factura.moneda)}</td>
            <td class="num">${formatear(multiplicar(it.precioUnitario, it.cantidad), factura.moneda)}</td>
            ${editable ? html`
              <td class="tabla__acciones">
                <button class="btn btn--icono" data-accion="editar-item" data-id="${it.id}" type="button">Editar</button>
                <button class="btn btn--icono btn--peligro" data-accion="eliminar-item" data-id="${it.id}" type="button">✕</button>
              </td>` : ''}
          </tr>`)}
      </tbody>
    </table>
    ${editable ? html`<button class="btn" data-accion="agregar-item" type="button">Agregar ítem</button>` : ''}`;
}

function filaTotales(etiqueta, valor, moneda, { resta = false, sinNegativo = false } = {}) {
  if (valor === 0 && !sinNegativo) return '';
  return html`
    <tr>
      <th>${etiqueta}</th>
      <td class="num">${resta ? '−' : ''}${formatear(Math.abs(valor), moneda, { conSimbolo: false })}</td>
    </tr>`;
}

function tablaTotales(factura, totales) {
  return html`
    <table class="tabla-totales">
      <tbody>
        ${filaTotales('Subtotal', totales.subtotal, factura.moneda, { sinNegativo: true })}
        ${filaTotales(`Descuento (${factura.descuentoPct}%)`, totales.descuento, factura.moneda, { resta: true })}
        ${filaTotales(`IVA (${factura.impuestos.ivaPct}%)`, totales.iva, factura.moneda)}
        ${filaTotales(`ReteFuente (${factura.impuestos.reteFuentePct}%)`, totales.reteFuente, factura.moneda, { resta: true })}
        ${filaTotales(`ReteICA (${factura.impuestos.reteIcaPorMil}‰)`, totales.reteIca, factura.moneda, { resta: true })}
        <tr class="tabla-totales__total">
          <th>Total</th>
          <td class="num">${formatear(totales.total, factura.moneda)}</td>
        </tr>
        ${factura.fx ? html`
        <tr>
          <th>Total en ${factura.fx.hacia}</th>
          <td class="num">${formatear(totales.totalEnBase, factura.fx.hacia)}</td>
        </tr>` : ''}
      </tbody>
    </table>`;
}

function seccionEdicion(estado, factura) {
  const c = cliente(estado, factura);
  const necesitaFx = factura.moneda !== estado.ajustes.monedaBase;
  return html`
    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Condiciones</h2>
      <div class="campo-grupo">
        <label class="campo">
          <span>Moneda</span>
          <select data-campo="moneda">
            ${MONEDAS.map((m) => html`<option value="${m}" ${attr('selected', m === factura.moneda)}>${m}</option>`)}
          </select>
        </label>
        <label class="campo">
          <span>Descuento %</span>
          <input data-campo="descuentoPct" type="number" min="0" max="100" step="0.1" value="${factura.descuentoPct}">
        </label>
      </div>
      <div class="campo-grupo">
        <label class="campo">
          <span>IVA %</span>
          <input data-campo-impuesto="ivaPct" type="number" min="0" step="0.1" value="${factura.impuestos.ivaPct}">
        </label>
        <label class="campo">
          <span>ReteFuente %</span>
          <input data-campo-impuesto="reteFuentePct" type="number" min="0" step="0.1" value="${factura.impuestos.reteFuentePct}">
        </label>
        <label class="campo">
          <span>ReteICA ‰</span>
          <input data-campo-impuesto="reteIcaPorMil" type="number" min="0" step="0.1" value="${factura.impuestos.reteIcaPorMil}">
        </label>
      </div>
      ${necesitaFx ? html`
      <div class="campo-grupo">
        <label class="campo">
          <span>Tasa ${factura.moneda} → ${estado.ajustes.monedaBase}</span>
          <input data-campo="tasaFx" type="number" min="0" step="0.0001" value="${factura.fx?.tasa ?? ''}">
        </label>
        <button class="btn" data-accion="obtener-tasa" type="button">Obtener tasa</button>
      </div>` : ''}
      <label class="campo">
        <span>Notas</span>
        <textarea data-campo="notas" rows="2">${factura.notas}</textarea>
      </label>
      <p class="tarjeta__ayuda">Cliente: ${c?.nombre} · vence a los ${estado.ajustes.pago.diasVencimiento} días de emitida.</p>
    </section>`;
}

export function vistaFacturaDetalle(estado, { id }) {
  const factura = estado.facturas.find((f) => f.id === id);
  if (!factura) {
    return html`<div class="vacio"><h2>Esta factura no existe</h2><a class="btn" href="#/facturas">Volver a Facturas</a></div>`;
  }

  const c = cliente(estado, factura);
  const editable = esEditable(factura);
  const efectivo = estadoEfectivo(factura);
  const totales = totalesDe(factura);

  return html`
    <header class="vista__cabecera">
      <h1>${factura.numero ?? 'Borrador'} <span class="chip chip--${efectivo}">${ETIQUETA_ESTADO[efectivo]}</span></h1>
      <div class="vista__acciones">
        ${editable ? html`<button class="btn btn--peligro" data-accion="eliminar-borrador" type="button">Descartar</button>` : ''}
        ${editable ? html`<button class="btn btn--primario" data-accion="emitir-factura" type="button">Emitir</button>` : ''}
        ${!editable && factura.estado !== 'anulada' ? html`<button class="btn" data-accion="imprimir-factura" type="button">Imprimir / PDF</button>` : ''}
        ${!editable && factura.estado !== 'anulada' && totalPagado(factura) === 0 ? html`<button class="btn btn--peligro" data-accion="anular-factura" type="button">Anular</button>` : ''}
      </div>
    </header>

    <p><a href="#/facturas">← Todas las facturas</a></p>

    <div class="detalle-factura">
      <div class="detalle-factura__principal">
        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Ítems</h2>
          ${tablaItems(factura, editable)}
        </section>
        ${editable ? seccionEdicion(estado, factura) : ''}
        ${!editable ? seccionPagos(factura) : ''}
      </div>
      <aside class="detalle-factura__lateral">
        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Totales</h2>
          ${tablaTotales(factura, totales)}
          ${!editable ? html`<p class="tarjeta__ayuda">Saldo pendiente: <strong class="num">${formatear(saldoPendiente(factura), factura.moneda)}</strong></p>` : ''}
          ${efectivo === 'enviada' ? html`<p class="tarjeta__ayuda">${diasParaVencer(factura) < 0 ? 'Venció' : `Vence en ${diasParaVencer(factura)} días`} (${factura.venceEn}).</p>` : ''}
        </section>
      </aside>
    </div>

    <div id="area-impresion" hidden>${plantillaImpresion(estado, factura, totales, c)}</div>`;
}

function seccionPagos(factura) {
  return html`
    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Pagos</h2>
      ${factura.pagos.length === 0 ? html`<p class="tarjeta__vacio">Sin pagos registrados.</p>` : html`
      <table class="tabla">
        <thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="num">Monto</th><th></th></tr></thead>
        <tbody>
          ${factura.pagos.map((p) => html`
            <tr>
              <td>${p.fecha}</td><td>${p.metodo}</td><td>${p.referencia || '—'}</td>
              <td class="num">${formatear(p.monto, factura.moneda)}</td>
              <td><button class="btn btn--icono btn--peligro" data-accion="eliminar-pago" data-id="${p.id}" type="button">✕</button></td>
            </tr>`)}
        </tbody>
      </table>`}
      ${factura.estado !== 'anulada' ? html`<button class="btn" data-accion="registrar-pago" type="button">Registrar pago</button>` : ''}
    </section>`;
}

function plantillaImpresion(estado, factura, totales, c) {
  const { negocio, pago } = estado.ajustes;
  return html`
    <div class="factura-impresa">
      <header class="factura-impresa__cabecera">
        <div>
          <h1>${negocio.nombre}</h1>
          <p>NIT ${negocio.nit || '—'} · ${negocio.direccion}</p>
          <p>${negocio.email} ${negocio.telefono}</p>
        </div>
        <div class="factura-impresa__numero">
          <h2>${factura.numero}</h2>
          <p>Emitida: ${factura.emitidaEn}</p>
          <p>Vence: ${factura.venceEn}</p>
        </div>
      </header>
      <section>
        <h3>Cliente</h3>
        <p>${c?.nombre} · ${c?.identificacion || '—'}</p>
        <p>${c?.email}</p>
      </section>
      <table class="factura__tabla">
        <thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>
          ${factura.items.map((it) => html`
            <tr><td>${it.descripcion}</td><td class="num">${it.cantidad}</td>
              <td class="num">${formatear(it.precioUnitario, factura.moneda)}</td>
              <td class="num">${formatear(multiplicar(it.precioUnitario, it.cantidad), factura.moneda)}</td></tr>`)}
        </tbody>
      </table>
      <div class="factura__totales">${tablaTotales(factura, totales)}</div>
      ${factura.fx ? html`<p class="factura-impresa__fx">Tasa de cambio ${factura.fx.desde} → ${factura.fx.hacia}: ${factura.fx.tasa} (${factura.fx.fuente}, ${factura.fx.capturadaEn.slice(0, 10)})</p>` : ''}
      <section>
        <h3>Métodos de pago</h3>
        ${pago.metodos.map((m) => html`<p>${m.etiqueta}: ${m.detalle || '—'}</p>`)}
      </section>
      ${factura.notas ? html`<p class="factura-impresa__notas">${factura.notas}</p>` : ''}
    </div>`;
}

/* ==========================================================
   Modales: ítem, pago
   ========================================================== */

function formularioItem(factura, item) {
  const it = item ?? { descripcion: '', cantidad: '', precioUnitario: 0 };
  return html`
    <h2>${item ? 'Editar ítem' : 'Agregar ítem'}</h2>
    <form class="formulario" data-form="item" novalidate>
      <label class="campo">
        <span>Descripción</span>
        <input name="descripcion" type="text" value="${it.descripcion}" required autofocus>
      </label>
      <div class="campo-grupo">
        <label class="campo">
          <span>Cantidad</span>
          <input name="cantidad" type="number" min="0.01" step="0.01" value="${it.cantidad}" required>
        </label>
        <label class="campo">
          <span>Precio unitario</span>
          <input name="precioUnitario" type="text" inputmode="decimal" value="${formatear(it.precioUnitario, factura.moneda, { conSimbolo: false })}" required>
        </label>
      </div>
      <p class="campo__vista-previa">Subtotal: <strong id="item-subtotal-vivo" class="num">${formatear(multiplicar(it.precioUnitario, Number(it.cantidad) || 0), factura.moneda)}</strong></p>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">${item ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
}

function abrirFormularioItem(factura, item) {
  abrirModal(formularioItem(factura, item));
  const form = document.querySelector('[data-form="item"]');

  /* Vista previa reactiva: el subtotal se recalcula en cada tecla, antes de
     guardar nada. No usa el store — es puramente visual. */
  const nodoSubtotal = document.getElementById('item-subtotal-vivo');
  const actualizarVistaPrevia = () => {
    const cantidad = Number(form.cantidad.value) || 0;
    const precioUnitario = parsear(form.precioUnitario.value, factura.moneda) ?? 0;
    nodoSubtotal.textContent = formatear(multiplicar(precioUnitario, cantidad), factura.moneda);
  };
  form?.addEventListener('input', actualizarVistaPrevia);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;
    const datos = leerFormulario(form);
    const precioUnitario = parsear(datos.precioUnitario, factura.moneda);
    if (precioUnitario === null) { toastError('Precio unitario inválido.'); return; }

    const cambios = { descripcion: datos.descripcion, cantidad: datos.cantidad, precioUnitario };
    if (item) store.actualizarItemFactura(factura.id, item.id, cambios);
    else store.agregarItemFactura(factura.id, cambios);
    cerrarModal();
  });
}

function formularioPago(factura) {
  return html`
    <h2>Registrar pago</h2>
    <form class="formulario" data-form="pago" novalidate>
      <div class="campo-grupo">
        <label class="campo">
          <span>Fecha</span>
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" required>
        </label>
        <label class="campo">
          <span>Monto</span>
          <input name="monto" type="text" inputmode="decimal" value="${formatear(saldoPendiente(factura), factura.moneda, { conSimbolo: false })}" required>
        </label>
      </div>
      <label class="campo">
        <span>Método</span>
        <input name="metodo" type="text" value="" placeholder="Nequi, PayPal...">
      </label>
      <label class="campo">
        <span>Referencia</span>
        <input name="referencia" type="text" value="">
      </label>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">Registrar</button>
      </div>
    </form>`;
}

function abrirFormularioPago(factura) {
  abrirModal(formularioPago(factura));
  const form = document.querySelector('[data-form="pago"]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;
    const datos = leerFormulario(form);
    const monto = parsear(datos.monto, factura.moneda);
    if (monto === null) { toastError('Monto inválido.'); return; }

    try {
      store.registrarPago(factura.id, { fecha: datos.fecha, monto, metodo: datos.metodo, referencia: datos.referencia });
      exito('Pago registrado.');
      cerrarModal();
    } catch (err) {
      toastError(err.message);
    }
  });
}

/* ==========================================================
   Acciones
   ========================================================== */

function actualizarCampo(factura, campo, valor) {
  store.actualizarFactura(factura.id, { [campo]: valor });
}

export function alActualizar(estado, { id }) {
  const factura = estado.facturas.find((f) => f.id === id);
  if (!factura || !esEditable(factura)) return;

  document.querySelectorAll('[data-campo]').forEach((el) => {
    el.addEventListener('change', () => {
      const campo = el.dataset.campo;
      if (campo === 'descuentoPct') return actualizarCampo(factura, campo, Number(el.value));
      if (campo === 'moneda') return actualizarCampo(factura, campo, el.value);
      if (campo === 'notas') return actualizarCampo(factura, campo, el.value);
      if (campo === 'tasaFx') {
        const tasa = Number(el.value);
        if (!tasa) return;
        actualizarCampo(factura, 'fx', { desde: factura.moneda, hacia: estado.ajustes.monedaBase, tasa, fuente: 'manual', capturadaEn: new Date().toISOString() });
      }
    });
  });

  document.querySelectorAll('[data-campo-impuesto]').forEach((el) => {
    el.addEventListener('change', () => {
      actualizarCampo(factura, 'impuestos', { ...factura.impuestos, [el.dataset.campoImpuesto]: Number(el.value) });
    });
  });
}

export const accionesFacturaDetalle = {
  'agregar-item': (id, estado, boton, evento, params) => {
    const factura = estado.facturas.find((f) => f.id === params.id);
    abrirFormularioItem(factura, null);
  },
  'editar-item': (itemId, estado, boton, evento, params) => {
    const factura = estado.facturas.find((f) => f.id === params.id);
    const item = factura.items.find((it) => it.id === itemId);
    abrirFormularioItem(factura, item);
  },
  'eliminar-item': (itemId, estado, boton, evento, params) => {
    store.eliminarItemFactura(params.id, itemId);
  },
  'eliminar-borrador': async (id, estado, boton, evento, params) => {
    const ok = await confirmar('¿Descartar este borrador? No se puede deshacer.');
    if (!ok) return;
    store.eliminarBorrador(params.id);
    navegar('/facturas');
  },
  'emitir-factura': (id, estado, boton, evento, params) => {
    try {
      store.emitirFactura(params.id);
      exito('Factura emitida.');
    } catch (err) {
      toastError(err.message);
    }
  },
  'anular-factura': async (id, estado, boton, evento, params) => {
    const ok = await confirmar('¿Anular esta factura? Las horas incluidas quedarán libres para volver a facturarse.');
    if (!ok) return;
    try {
      store.anularFactura(params.id);
      exito('Factura anulada.');
    } catch (err) {
      toastError(err.message);
    }
  },
  'registrar-pago': (id, estado, boton, evento, params) => {
    const factura = estado.facturas.find((f) => f.id === params.id);
    abrirFormularioPago(factura);
  },
  'eliminar-pago': async (pagoId, estado, boton, evento, params) => {
    const ok = await confirmar('¿Eliminar este pago?');
    if (!ok) return;
    store.eliminarPago(params.id, pagoId);
  },
  'obtener-tasa': async (id, estado, boton, evento, params) => {
    const factura = estado.facturas.find((f) => f.id === params.id);
    try {
      const registro = await obtenerTasa(factura.moneda, estado.ajustes.monedaBase, estado.fxCache);
      store.guardarTasaFx(claveTasa(factura.moneda, estado.ajustes.monedaBase), registro);
      store.actualizarFactura(factura.id, { fx: { desde: factura.moneda, hacia: estado.ajustes.monedaBase, tasa: registro.tasa, fuente: registro.fuente, capturadaEn: new Date().toISOString() } });
      if (registro.vencida) aviso('No se pudo consultar la tasa actual: se usó la última guardada.');
      else exito('Tasa actualizada.');
    } catch (err) {
      toastError(err.message);
    }
  },
  'imprimir-factura': () => {
    document.getElementById('area-impresion').hidden = false;
    window.print();
    document.getElementById('area-impresion').hidden = true;
  },
};
