/**
 * Resumen: qué te deben, qué vence pronto, en qué proyectos hay horas sin
 * facturar, cómo van los ingresos y qué pasó últimamente. Nada se recalcula
 * y se guarda aparte: todo sale de `estado` con las funciones de `domain/`.
 *
 * Las cifras de las tarjetas KPI entran con una animación de conteo
 * (`alActualizar`, para que también se anime si los datos cambian sin
 * salir del dashboard) — puro DOM/`requestAnimationFrame`, sin librerías,
 * y se desactiva sola si el sistema pide `prefers-reduced-motion`.
 */

import { html } from '../core/render.js';
import { formatear } from '../domain/money.js';
import { horasDecimales, hoyLocal, sumarDias, ultimosMeses, etiquetaMes } from '../domain/time.js';
import { estadoEfectivo, saldoPendiente, diasParaVencer, totalesDe } from '../domain/invoice.js';
import { animarBarras } from '../ui/graficos.js';

const DIAS_ALERTA_VENCIMIENTO = 5;
const DIAS_ACTIVIDAD_HORAS = 30;
const MESES_INGRESOS = 6;
const MAX_EVENTOS_ACTIVIDAD = 6;
const DURACION_CONTADOR_MS = 700;

const nombreCliente = (estado, id) => estado.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente';
const nombreProyecto = (estado, id) => estado.proyectos.find((p) => p.id === id)?.nombre ?? 'Proyecto';
const facturaEsReal = (f) => f.estado !== 'borrador' && f.estado !== 'anulada';

function porCobrarPorMoneda(facturas) {
  const porMoneda = new Map();
  for (const factura of facturas) {
    const efectivo = estadoEfectivo(factura);
    if (efectivo !== 'enviada' && efectivo !== 'vencida') continue;
    const saldo = saldoPendiente(factura);
    if (saldo <= 0) continue;
    porMoneda.set(factura.moneda, (porMoneda.get(factura.moneda) ?? 0) + saldo);
  }
  return [...porMoneda.entries()];
}

function facturasPorVencer(facturas, hoy) {
  return facturas
    .filter((f) => estadoEfectivo(f, hoy) === 'enviada' && diasParaVencer(f, hoy) <= DIAS_ALERTA_VENCIMIENTO)
    .sort((a, b) => a.venceEn.localeCompare(b.venceEn));
}

function horasSinFacturar(estado) {
  const porProyecto = new Map();
  for (const registro of estado.registros) {
    if (!registro.facturable || registro.facturaId) continue;
    porProyecto.set(registro.proyectoId, (porProyecto.get(registro.proyectoId) ?? 0) + registro.segundos);
  }
  return [...porProyecto.entries()]
    .map(([proyectoId, segundos]) => ({ proyecto: estado.proyectos.find((p) => p.id === proyectoId), segundos }))
    .filter((f) => f.proyecto)
    .sort((a, b) => b.segundos - a.segundos);
}

const facturadoHistorico = (estado) =>
  estado.facturas.filter(facturaEsReal).reduce((acc, f) => acc + totalesDe(f).totalEnBase, 0);

const horasRecientes = (estado, hoy) => {
  const desde = sumarDias(hoy, -DIAS_ACTIVIDAD_HORAS);
  return estado.registros
    .filter((r) => r.fecha >= desde && r.fecha <= hoy)
    .reduce((acc, r) => acc + r.segundos, 0);
};

function ingresosPorMes(estado) {
  const meses = ultimosMeses(MESES_INGRESOS);
  const porMes = new Map(meses.map((m) => [m, 0]));
  for (const f of estado.facturas) {
    if (!facturaEsReal(f) || !f.emitidaEn) continue;
    const clave = f.emitidaEn.slice(0, 7);
    if (porMes.has(clave)) porMes.set(clave, porMes.get(clave) + totalesDe(f).totalEnBase);
  }
  return meses.map((mes) => ({ mes, monto: porMes.get(mes) }));
}

function actividadReciente(estado) {
  const eventos = [];
  for (const f of estado.facturas) {
    if (f.emitidaEn) {
      eventos.push({ fecha: f.emitidaEn, tipo: 'factura', href: `#/facturas/${f.id}`, texto: `Factura ${f.numero} emitida a ${nombreCliente(estado, f.clienteId)}` });
    }
    for (const p of f.pagos) {
      eventos.push({ fecha: p.fecha, tipo: 'pago', href: `#/facturas/${f.id}`, texto: `Pago de ${formatear(p.monto, f.moneda)} de ${nombreCliente(estado, f.clienteId)}` });
    }
  }
  for (const r of estado.registros) {
    eventos.push({ fecha: r.fecha, tipo: 'horas', href: '#/horas', texto: `${horasDecimales(r.segundos).toFixed(2)} h en ${nombreProyecto(estado, r.proyectoId)}` });
  }
  return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, MAX_EVENTOS_ACTIVIDAD);
}

const urgenciaDe = (dias) => (dias < 0 ? 'peligro' : dias <= 2 ? 'aviso' : 'info');

function tileKpi({ etiqueta, valor, moneda, sufijo = '' }) {
  return html`
    <section class="tarjeta tarjeta--kpi">
      <span class="kpi__etiqueta">${etiqueta}</span>
      <span class="kpi__cifra num" data-contador data-valor="${valor}" data-moneda="${moneda ?? ''}" data-sufijo="${sufijo}">
        ${moneda ? formatear(0, moneda) : `0${sufijo}`}
      </span>
    </section>`;
}

export function vistaDashboard(estado) {
  if (estado.clientes.length === 0) {
    return html`
      <div class="vacio">
        <h2>Bienvenido a tu panel de facturación</h2>
        <p>Empieza agregando tu primer cliente.</p>
        <a class="btn btn--primario" href="#/clientes">Ir a Clientes</a>
      </div>`;
  }

  const hoy = hoyLocal();
  const porCobrar = porCobrarPorMoneda(estado.facturas);
  const porVencer = facturasPorVencer(estado.facturas, hoy);
  const sinFacturar = horasSinFacturar(estado);
  const ingresos = ingresosPorMes(estado);
  const actividad = actividadReciente(estado);
  const maxIngreso = Math.max(1, ...ingresos.map((m) => m.monto));
  const maxHorasSinFacturar = Math.max(1, ...sinFacturar.map((f) => f.segundos));

  return html`
    <header class="vista__cabecera">
      <h1>Dashboard</h1>
    </header>

    <div class="tarjetas">
      ${tileKpi({ etiqueta: 'Facturado (histórico)', valor: facturadoHistorico(estado), moneda: estado.ajustes.monedaBase })}
      ${tileKpi({ etiqueta: `Horas (últimos ${DIAS_ACTIVIDAD_HORAS} días)`, valor: horasDecimales(horasRecientes(estado, hoy)), sufijo: ' h' })}
      ${tileKpi({ etiqueta: 'Clientes activos', valor: estado.clientes.filter((c) => c.activo).length })}
      <section class="tarjeta tarjeta--kpi">
        <span class="kpi__etiqueta">Por cobrar</span>
        ${porCobrar.length === 0
      ? html`<p class="tarjeta__vacio">Nada pendiente.</p>`
      : html`<div class="kpi__multi">
            ${porCobrar.map(([moneda, monto]) => html`<span class="kpi__cifra kpi__cifra--chica num">${formatear(monto, moneda)}</span>`)}
          </div>`}
      </section>
    </div>

    <div class="tablero-panel">
      <div class="tablero-panel__principal">
        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Ingresos — últimos ${MESES_INGRESOS} meses</h2>
          <div class="grafico-barras">
            ${ingresos.map(({ mes, monto }) => html`
              <div class="grafico-barras__columna">
                <span class="grafico-barras__valor num">${monto > 0 ? formatear(monto, estado.ajustes.monedaBase, { conSimbolo: false }) : ''}</span>
                <div class="grafico-barras__pista">
                  <div class="grafico-barras__barra" style="height:0%" data-alto="${(100 * monto) / maxIngreso}"></div>
                </div>
                <span class="grafico-barras__etiqueta">${etiquetaMes(mes)}</span>
              </div>`)}
          </div>
        </section>

        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Horas sin facturar</h2>
          ${sinFacturar.length === 0
      ? html`<p class="tarjeta__vacio">Todo lo facturable ya está en una factura.</p>`
      : html`<ul class="barras-horizontales">
            ${sinFacturar.map(({ proyecto, segundos }) => html`
              <li class="barra-horizontal">
                <div class="barra-horizontal__cabecera">
                  <a href="#/proyectos">${proyecto.nombre}</a>
                  <span class="num">${horasDecimales(segundos).toFixed(2)} h</span>
                </div>
                <div class="barra-horizontal__pista">
                  <div class="barra-horizontal__relleno" style="width:0%;background:${proyecto.color}" data-ancho="${(100 * segundos) / maxHorasSinFacturar}"></div>
                </div>
              </li>`)}
          </ul>`}
        </section>
      </div>

      <aside class="tablero-panel__lateral">
        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Por vencer</h2>
          ${porVencer.length === 0
      ? html`<p class="tarjeta__vacio">Ninguna factura vence en los próximos ${DIAS_ALERTA_VENCIMIENTO} días.</p>`
      : html`<ul class="lista-avisos">
            ${porVencer.map((f) => {
        const dias = diasParaVencer(f, hoy);
        const urgencia = urgenciaDe(dias);
        const etiquetaDias = dias < 0 ? `venció hace ${Math.abs(dias)} d` : dias === 0 ? 'vence hoy' : `vence en ${dias} d`;
        return html`
              <li class="aviso aviso--${urgencia}">
                <div class="aviso__cuerpo">
                  <a href="#/facturas/${f.id}">${f.numero}</a>
                  <span class="aviso__cliente">${nombreCliente(estado, f.clienteId)}</span>
                </div>
                <div class="aviso__cifras">
                  <span class="num">${formatear(saldoPendiente(f), f.moneda)}</span>
                  <span class="chip chip--${urgencia}">${etiquetaDias}</span>
                </div>
              </li>`;
      })}
          </ul>`}
        </section>

        <section class="tarjeta">
          <h2 class="tarjeta__titulo">Actividad reciente</h2>
          ${actividad.length === 0
      ? html`<p class="tarjeta__vacio">Todavía no hay movimiento.</p>`
      : html`<ul class="actividad">
          ${actividad.map((e) => html`
            <li class="actividad__item">
              <span class="actividad__punto actividad__punto--${e.tipo}" aria-hidden="true"></span>
              <a href="${e.href}">${e.texto}</a>
              <span class="actividad__fecha">${e.fecha}</span>
            </li>`)}
        </ul>`}
        </section>
      </aside>
    </div>`;
}

function animarContadores() {
  const prefiereMovimiento = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  document.querySelectorAll('[data-contador]').forEach((nodo) => {
    const valorFinal = Number(nodo.dataset.valor) || 0;
    const moneda = nodo.dataset.moneda || null;
    const sufijo = nodo.dataset.sufijo || '';
    const pintar = (valor) => {
      nodo.textContent = moneda ? formatear(Math.round(valor), moneda) : `${Math.round(valor * 100) / 100}${sufijo}`;
    };

    if (!prefiereMovimiento || valorFinal === 0) { pintar(valorFinal); return; }

    const inicio = performance.now();
    const paso = (ahora) => {
      const progreso = Math.min(1, (ahora - inicio) / DURACION_CONTADOR_MS);
      const suavizado = 1 - (1 - progreso) ** 3;
      pintar(valorFinal * suavizado);
      if (progreso < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}

export function alActualizar() {
  animarContadores();
  animarBarras();
}

export const accionesDashboard = {};
