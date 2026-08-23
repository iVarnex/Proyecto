/**
 * Registro de horas: entrada manual + cronómetro.
 *
 * El cronómetro no repinta la vista entera cada segundo (eso perdería el
 * foco y sería carísimo de re-renderizar). `alActualizar` arranca un intervalo
 * que solo actualiza el nodo `#cronometro-tiempo`; la verdad sigue siendo
 * `segundosTranscurridos(inicioTs, pausas)` contra `Date.now()`, no un
 * contador que el intervalo incrementa.
 */

import { html, attr } from '../core/render.js';
import {
  agruparPorDia, etiquetaDia, formatearDuracion, horasDecimales, segundosTranscurridos,
  hoyLocal, inicioDeSemana, sumarDias, NOMBRES_DIA,
} from '../domain/time.js';
import { abrirModal, cerrarModal, confirmar } from '../ui/modal.js';
import { leerFormulario, formularioValido } from '../ui/form.js';
import { animarBarras } from '../ui/graficos.js';
import { exito, error as toastError } from '../ui/toast.js';
import * as store from '../core/store.js';

const nombreProyecto = (estado, id) => estado.proyectos.find((p) => p.id === id)?.nombre ?? 'Proyecto';
const colorProyecto = (estado, id) => estado.proyectos.find((p) => p.id === id)?.color ?? 'var(--texto-suave)';

function widgetCronometro(estado) {
  const { cronometro } = estado;
  if (!cronometro) {
    if (estado.proyectos.length === 0) return '';
    return html`
      <div class="cronometro">
        <select id="cronometro-proyecto" aria-label="Proyecto del cronómetro">
          ${estado.proyectos.filter((p) => p.estado === 'activo').map((p) => html`<option value="${p.id}">${p.nombre}</option>`)}
        </select>
        <button class="btn btn--primario" data-accion="iniciar-cronometro" type="button">▶ Iniciar cronómetro</button>
      </div>`;
  }

  const enPausa = cronometro.pausas.at(-1)?.fin === undefined;
  return html`
    <div class="cronometro cronometro--activo ${enPausa ? '' : 'cronometro--corriendo'}">
      <span class="cronometro__pulso" aria-hidden="true"></span>
      <div class="cronometro__info">
        <span class="cronometro__proyecto">${nombreProyecto(estado, cronometro.proyectoId)}</span>
        <span id="cronometro-tiempo" class="cronometro__tiempo num">${formatearDuracion(segundosTranscurridos(cronometro.inicioTs, cronometro.pausas))}</span>
      </div>
      <div class="cronometro__acciones">
        ${enPausa
      ? html`<button class="btn" data-accion="reanudar-cronometro" type="button">▶ Reanudar</button>`
      : html`<button class="btn" data-accion="pausar-cronometro" type="button">⏸ Pausar</button>`}
        <button class="btn btn--primario" data-accion="detener-cronometro" type="button">⏹ Detener</button>
        <button class="btn btn--icono" data-accion="descartar-cronometro" type="button" title="Descartar sin guardar">✕</button>
      </div>
    </div>`;
}

/** Franja de 7 columnas (lun–dom) con el total de horas de la semana en curso, para ubicarse de un vistazo. */
function resumenSemanal(estado, hoy) {
  const lunes = inicioDeSemana(hoy);
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const porDia = new Map(dias.map((d) => [d, 0]));
  for (const r of estado.registros) if (porDia.has(r.fecha)) porDia.set(r.fecha, porDia.get(r.fecha) + r.segundos);

  const max = Math.max(1, ...porDia.values());
  return html`
    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Esta semana</h2>
      <div class="grafico-barras grafico-barras--compacto">
        ${dias.map((d, i) => html`
          <div class="grafico-barras__columna ${d === hoy ? 'grafico-barras__columna--hoy' : ''}">
            <span class="grafico-barras__valor num">${porDia.get(d) > 0 ? horasDecimales(porDia.get(d)).toFixed(1) : ''}</span>
            <div class="grafico-barras__pista">
              <div class="grafico-barras__barra" style="height:0%" data-alto="${(100 * porDia.get(d)) / max}"></div>
            </div>
            <span class="grafico-barras__etiqueta">${NOMBRES_DIA[i]}</span>
          </div>`)}
      </div>
    </section>`;
}

export function vistaHoras(estado) {
  if (estado.proyectos.length === 0) {
    return html`
      <div class="vacio">
        <h2>Necesitas un proyecto primero</h2>
        <p>Crea un proyecto para poder registrarle horas.</p>
        <a class="btn btn--primario" href="#/proyectos">Ir a Proyectos</a>
      </div>`;
  }

  const hoy = hoyLocal();
  const dias = agruparPorDia(estado.registros).reverse();
  const maxDia = Math.max(1, ...dias.map((d) => d.segundos));

  return html`
    <header class="vista__cabecera">
      <h1>Horas</h1>
      <button class="btn btn--primario" data-accion="nuevo-registro" type="button">Registrar horas</button>
    </header>

    ${widgetCronometro(estado)}

    ${dias.length === 0 ? html`
      <div class="vacio">
        <h2>Aún no has registrado horas</h2>
        <p>Usa el cronómetro o registra una entrada manual.</p>
      </div>` : html`
      ${resumenSemanal(estado, hoy)}
      ${dias.map((dia) => html`
      <section class="dia">
        <div class="dia__cabecera">
          <h2>${etiquetaDia(dia.fecha)} · ${dia.fecha}</h2>
          <span class="num">${horasDecimales(dia.segundos).toFixed(2)} h</span>
        </div>
        <div class="dia__pista">
          <div class="dia__relleno" style="width:0%" data-ancho="${(100 * dia.segundos) / maxDia}"></div>
        </div>
        <ul class="registros-dia">
          ${dia.registros.map((r) => html`
            <li class="registro-fila ${r.facturaId ? 'registro-fila--facturada' : ''}" style="border-left-color:${colorProyecto(estado, r.proyectoId)}">
              <div class="registro-fila__texto">
                <span class="registro-fila__proyecto">${nombreProyecto(estado, r.proyectoId)}</span>
                <span class="registro-fila__descripcion">${r.descripcion || 'Sin descripción'}</span>
              </div>
              <div class="registro-fila__meta">
                ${r.facturable ? '' : html`<span class="chip">No facturable</span>`}
                ${r.facturaId ? html`<span class="chip chip--info">Facturada</span>` : ''}
                <span class="num">${horasDecimales(r.segundos).toFixed(2)} h</span>
                ${r.facturaId ? '' : html`
                  <button class="btn btn--icono" data-accion="editar-registro" data-id="${r.id}" type="button">Editar</button>
                  <button class="btn btn--icono btn--peligro" data-accion="eliminar-registro" data-id="${r.id}" type="button">Eliminar</button>`}
              </div>
            </li>`)}
        </ul>
      </section>`)}
    `}`;
}

let idIntervalo = null;

export function alActualizar(estado) {
  animarBarras();

  clearInterval(idIntervalo);
  if (!estado.cronometro) return;

  idIntervalo = setInterval(() => {
    const c = store.getEstado().cronometro;
    const nodo = document.getElementById('cronometro-tiempo');
    if (!c || !nodo) { clearInterval(idIntervalo); return; }
    nodo.textContent = formatearDuracion(segundosTranscurridos(c.inicioTs, c.pausas));
  }, 1000);
}

export function alDesmontar() {
  clearInterval(idIntervalo);
}

function formularioRegistro(estado, registro) {
  const r = registro ?? { proyectoId: estado.proyectos[0]?.id, fecha: hoyLocal(), horas: '', descripcion: '', facturable: true };
  return html`
    <h2>${registro ? 'Editar registro' : 'Registrar horas'}</h2>
    <form class="formulario" data-form="registro" novalidate>
      <label class="campo">
        <span>Proyecto</span>
        <select name="proyectoId" required>
          ${estado.proyectos.map((p) => html`<option value="${p.id}" ${attr('selected', p.id === r.proyectoId)}>${p.nombre}</option>`)}
        </select>
      </label>
      <div class="campo-grupo">
        <label class="campo">
          <span>Fecha</span>
          <input name="fecha" type="date" value="${r.fecha}" required>
        </label>
        <label class="campo">
          <span>Horas</span>
          <input name="horas" type="number" min="0.05" step="0.05" value="${r.horas}" required>
        </label>
      </div>
      <label class="campo">
        <span>Descripción</span>
        <input name="descripcion" type="text" value="${r.descripcion}">
      </label>
      <label class="campo campo--linea">
        <input name="facturable" type="checkbox" ${attr('checked', r.facturable)}>
        <span>Facturable</span>
      </label>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">${registro ? 'Guardar' : 'Registrar'}</button>
      </div>
    </form>`;
}

function abrirFormularioRegistro(estado, registro) {
  abrirModal(formularioRegistro(estado, registro));

  const form = document.querySelector('[data-form="registro"]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;

    const datos = leerFormulario(form);
    const cambios = {
      proyectoId: datos.proyectoId,
      fecha: datos.fecha,
      segundos: Math.round(datos.horas * 3600),
      descripcion: datos.descripcion,
      facturable: datos.facturable,
    };

    try {
      if (registro) {
        store.actualizarRegistro(registro.id, cambios);
        exito('Registro actualizado.');
      } else {
        store.crearRegistro(cambios);
        exito('Horas registradas.');
      }
      cerrarModal();
    } catch (err) {
      toastError(err.message);
    }
  });
}

export const accionesHoras = {
  'nuevo-registro': (id, estado) => abrirFormularioRegistro(estado, null),

  'editar-registro': (id, estado) => {
    const registro = estado.registros.find((r) => r.id === id);
    if (!registro) return;
    abrirFormularioRegistro(estado, { ...registro, horas: horasDecimales(registro.segundos) });
  },

  'eliminar-registro': async (id) => {
    const ok = await confirmar('¿Eliminar este registro de horas?');
    if (!ok) return;
    try {
      store.eliminarRegistro(id);
      exito('Registro eliminado.');
    } catch (err) {
      toastError(err.message);
    }
  },

  'iniciar-cronometro': () => {
    const proyectoId = document.getElementById('cronometro-proyecto')?.value;
    if (!proyectoId) { toastError('Crea un proyecto activo primero.'); return; }
    try {
      store.iniciarCronometro(proyectoId);
    } catch (err) {
      toastError(err.message);
    }
  },

  'pausar-cronometro': () => store.pausarCronometro(),
  'reanudar-cronometro': () => store.reanudarCronometro(),

  'detener-cronometro': () => {
    try {
      store.detenerCronometro('');
      exito('Registro guardado.');
    } catch (err) {
      toastError(err.message);
    }
  },

  'descartar-cronometro': async () => {
    const ok = await confirmar('¿Descartar el tiempo del cronómetro sin guardarlo?');
    if (ok) store.descartarCronometro();
  },
};
