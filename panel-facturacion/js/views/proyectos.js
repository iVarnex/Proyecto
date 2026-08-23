import { html, attr } from '../core/render.js';
import { formatear, parsear } from '../domain/money.js';
import { abrirModal, cerrarModal, confirmar } from '../ui/modal.js';
import { leerFormulario, formularioValido, marcarErrores } from '../ui/form.js';
import { activarFiltro } from '../ui/filtro.js';
import { exito, error as toastError } from '../ui/toast.js';
import * as store from '../core/store.js';

const ETIQUETA_ESTADO_PROYECTO = { activo: 'Activo', pausado: 'Pausado', cerrado: 'Cerrado' };

const nombreCliente = (estado, id) => estado.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente';
const monedaEfectiva = (estado, proyecto) => proyecto.moneda ?? estado.clientes.find((c) => c.id === proyecto.clienteId)?.moneda;
const tarifaEfectiva = (estado, proyecto) => proyecto.tarifaHora ?? estado.clientes.find((c) => c.id === proyecto.clienteId)?.tarifaHora ?? 0;

export function vistaProyectos(estado) {
  const { proyectos } = estado;

  if (estado.clientes.length === 0) {
    return html`
      <div class="vacio">
        <h2>Necesitas un cliente primero</h2>
        <p>Los proyectos se agrupan bajo un cliente.</p>
        <a class="btn btn--primario" href="#/clientes">Ir a Clientes</a>
      </div>`;
  }

  if (proyectos.length === 0) {
    return html`
      <div class="vacio">
        <h2>Aún no tienes proyectos</h2>
        <p>Crea uno para poder registrar horas contra él.</p>
        <button class="btn btn--primario" data-accion="nuevo-proyecto" type="button">Agregar proyecto</button>
      </div>`;
  }

  return html`
    <header class="vista__cabecera">
      <h1>Proyectos</h1>
      <button class="btn btn--primario" data-accion="nuevo-proyecto" type="button">Agregar proyecto</button>
    </header>
    <div class="barra-busqueda">
      <input type="search" id="buscar-proyectos" placeholder="Buscar por proyecto o cliente..." aria-label="Buscar proyectos">
    </div>
    <table class="tabla" id="tabla-proyectos">
      <thead>
        <tr><th>Proyecto</th><th>Cliente</th><th class="num">Tarifa/hora</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>
        ${proyectos.map((p) => html`
          <tr data-buscar="${(p.nombre + ' ' + nombreCliente(estado, p.clienteId)).toLowerCase()}">
            <td><span class="punto-color" style="background:${p.color}"></span> ${p.nombre}</td>
            <td>${nombreCliente(estado, p.clienteId)}</td>
            <td class="num">${formatear(tarifaEfectiva(estado, p), monedaEfectiva(estado, p))}</td>
            <td><span class="chip chip--${p.estado}">${ETIQUETA_ESTADO_PROYECTO[p.estado]}</span></td>
            <td class="tabla__acciones">
              <button class="btn btn--icono" data-accion="editar-proyecto" data-id="${p.id}" type="button">Editar</button>
              <button class="btn btn--icono btn--peligro" data-accion="eliminar-proyecto" data-id="${p.id}" type="button">Eliminar</button>
            </td>
          </tr>`)}
        <tr data-sin-resultados hidden><td colspan="5">Ningún proyecto coincide con la búsqueda.</td></tr>
      </tbody>
    </table>`;
}

export function alActualizar() {
  activarFiltro(document.getElementById('buscar-proyectos'), document.getElementById('tabla-proyectos'));
}

function formularioProyecto(estado, proyecto) {
  const p = proyecto ?? { clienteId: estado.clientes[0]?.id, nombre: '', tarifaHora: null, moneda: null, presupuestoHoras: null, estado: 'activo', color: '#4f8fd6' };
  return html`
    <h2>${proyecto ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
    <form class="formulario" data-form="proyecto" novalidate>
      <label class="campo">
        <span>Cliente</span>
        <select name="clienteId" required>
          ${estado.clientes.map((c) => html`<option value="${c.id}" ${attr('selected', c.id === p.clienteId)}>${c.nombre}</option>`)}
        </select>
      </label>
      <label class="campo">
        <span>Nombre del proyecto</span>
        <input name="nombre" type="text" value="${p.nombre}" required autofocus>
      </label>
      <label class="campo">
        <span>Tarifa por hora (vacío = hereda la del cliente)</span>
        <input name="tarifaHora" type="text" inputmode="decimal" value="${p.tarifaHora === null ? '' : formatear(p.tarifaHora, p.moneda ?? 'COP', { conSimbolo: false })}">
      </label>
      <label class="campo">
        <span>Presupuesto de horas (opcional)</span>
        <input name="presupuestoHoras" type="number" min="0" step="0.5" value="${p.presupuestoHoras ?? ''}">
      </label>
      <div class="campo-grupo">
        <label class="campo">
          <span>Estado</span>
          <select name="estado">
            ${Object.entries(ETIQUETA_ESTADO_PROYECTO).map(([valor, etiqueta]) => html`
              <option value="${valor}" ${attr('selected', valor === p.estado)}>${etiqueta}</option>`)}
          </select>
        </label>
        <label class="campo">
          <span>Color</span>
          <input name="color" type="color" value="${p.color}">
        </label>
      </div>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">${proyecto ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
}

function abrirFormularioProyecto(estado, proyecto) {
  abrirModal(formularioProyecto(estado, proyecto));

  const form = document.querySelector('[data-form="proyecto"]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;

    const datos = leerFormulario(form);
    const cliente = estado.clientes.find((c) => c.id === datos.clienteId);
    let tarifaHora = null;
    if (datos.tarifaHora.trim() !== '') {
      tarifaHora = parsear(datos.tarifaHora, cliente.moneda);
      if (tarifaHora === null) {
        marcarErrores(form, { tarifaHora: 'Ingresa un valor numérico válido o déjalo vacío.' });
        return;
      }
    }

    const cambios = {
      clienteId: datos.clienteId,
      nombre: datos.nombre,
      tarifaHora,
      presupuestoHoras: datos.presupuestoHoras,
      estado: datos.estado,
      color: datos.color,
    };

    try {
      if (proyecto) {
        store.actualizarProyecto(proyecto.id, cambios);
        exito('Proyecto actualizado.');
      } else {
        store.crearProyecto(cambios);
        exito('Proyecto agregado.');
      }
      cerrarModal();
    } catch (err) {
      toastError(err.message);
    }
  });
}

export const accionesProyectos = {
  'nuevo-proyecto': (id, estado) => abrirFormularioProyecto(estado, null),

  'editar-proyecto': (id, estado) => {
    const proyecto = estado.proyectos.find((p) => p.id === id);
    if (proyecto) abrirFormularioProyecto(estado, proyecto);
  },

  'eliminar-proyecto': async (id, estado) => {
    const proyecto = estado.proyectos.find((p) => p.id === id);
    const ok = await confirmar(`¿Eliminar el proyecto ${proyecto?.nombre}?`);
    if (!ok) return;
    try {
      store.eliminarProyecto(id);
      exito('Proyecto eliminado.');
    } catch (err) {
      toastError(err.message);
    }
  },
};
