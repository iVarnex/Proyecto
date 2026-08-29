import { html, attr } from '../core/render.js';
import { formatear, parsear, MONEDAS } from '../domain/money.js';
import { abrirModal, cerrarModal, confirmar } from '../ui/modal.js';
import { leerFormulario, formularioValido, marcarErrores } from '../ui/form.js';
import { activarFiltro } from '../ui/filtro.js';
import { exito, error as toastError } from '../ui/toast.js';
import * as store from '../core/store.js';

export function vistaClientes(estado) {
  const { clientes } = estado;

  if (clientes.length === 0) {
    return html`
      <div class="vacio">
        <h2>Aún no tienes clientes</h2>
        <p>Agrega el primero para empezar a registrar horas.</p>
        <button class="btn btn--primario" data-accion="nuevo-cliente" type="button">Agregar cliente</button>
      </div>`;
  }

  return html`
    <header class="vista__cabecera">
      <h1>Clientes</h1>
      <button class="btn btn--primario" data-accion="nuevo-cliente" type="button">Agregar cliente</button>
    </header>
    <div class="barra-busqueda">
      <input type="search" id="buscar-clientes" placeholder="Buscar por nombre o correo..." aria-label="Buscar clientes">
    </div>
    <div class="table-wrap">
    <table class="tabla" id="tabla-clientes">
      <thead>
        <tr><th>Cliente</th><th>Moneda</th><th class="num">Tarifa/hora</th><th>Proyectos</th><th></th></tr>
      </thead>
      <tbody>
        ${clientes.map((c) => html`
          <tr class="${c.activo ? '' : 'fila--inactiva'}" data-buscar="${(c.nombre + ' ' + c.email).toLowerCase()}">
            <td>
              <a href="#/clientes/${c.id}">${c.nombre}</a><br>
              <small>${c.email || 'Sin correo'}</small>
            </td>
            <td><span class="chip">${c.moneda}</span></td>
            <td class="num">${formatear(c.tarifaHora, c.moneda)}</td>
            <td>${estado.proyectos.filter((p) => p.clienteId === c.id).length}</td>
            <td class="tabla__acciones">
              <button class="btn btn--icono" data-accion="editar-cliente" data-id="${c.id}" type="button">Editar</button>
              <button class="btn btn--icono btn--peligro" data-accion="eliminar-cliente" data-id="${c.id}" type="button">Eliminar</button>
            </td>
          </tr>`)}
        <tr data-sin-resultados hidden><td colspan="5">Ningún cliente coincide con la búsqueda.</td></tr>
      </tbody>
    </table>
    </div>`;
}

function formularioCliente(cliente) {
  const c = cliente ?? { nombre: '', contacto: '', email: '', identificacion: '', pais: 'CO', moneda: 'COP', tarifaHora: 0, notas: '' };
  return html`
    <h2>${cliente ? 'Editar cliente' : 'Nuevo cliente'}</h2>
    <form class="formulario" data-form="cliente" novalidate>
      <label class="campo">
        <span>Nombre o razón social</span>
        <input name="nombre" type="text" value="${c.nombre}" required autofocus>
      </label>
      <label class="campo">
        <span>Persona de contacto</span>
        <input name="contacto" type="text" value="${c.contacto}">
      </label>
      <label class="campo">
        <span>Correo</span>
        <input name="email" type="email" value="${c.email}">
      </label>
      <label class="campo">
        <span>NIT / identificación</span>
        <input name="identificacion" type="text" value="${c.identificacion}">
      </label>
      <div class="campo-grupo">
        <label class="campo">
          <span>País (ISO-2)</span>
          <input name="pais" type="text" maxlength="2" value="${c.pais}" required>
        </label>
        <label class="campo">
          <span>Moneda de facturación</span>
          <select name="moneda" required>
            ${MONEDAS.map((m) => html`<option value="${m}" ${attr('selected', m === c.moneda)}>${m}</option>`)}
          </select>
        </label>
      </div>
      <label class="campo">
        <span>Tarifa por hora</span>
        <input name="tarifaHora" type="text" inputmode="decimal" value="${formatear(c.tarifaHora, c.moneda, { conSimbolo: false })}" required>
      </label>
      <label class="campo">
        <span>Notas</span>
        <textarea name="notas" rows="2">${c.notas}</textarea>
      </label>
      <div class="modal__acciones">
        <button class="btn" data-accion="cerrar-modal" type="button">Cancelar</button>
        <button class="btn btn--primario" type="submit">${cliente ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
}

function abrirFormularioCliente(cliente) {
  abrirModal(formularioCliente(cliente));

  const form = document.querySelector('[data-form="cliente"]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;

    const datos = leerFormulario(form);
    const tarifaHora = parsear(datos.tarifaHora, datos.moneda);
    if (tarifaHora === null) {
      marcarErrores(form, { tarifaHora: 'Ingresa un valor numérico válido.' });
      return;
    }

    try {
      if (cliente) {
        store.actualizarCliente(cliente.id, { ...datos, tarifaHora });
        exito('Cliente actualizado.');
      } else {
        store.crearCliente({ ...datos, tarifaHora });
        exito('Cliente agregado.');
      }
      cerrarModal();
    } catch (err) {
      toastError(err.message);
    }
  });
}

/** `#/clientes/:id` abre el formulario de edición sobre la misma lista. */
export function alMontar(estado, { id } = {}) {
  if (!id) return;
  const cliente = estado.clientes.find((c) => c.id === id);
  if (cliente) abrirFormularioCliente(cliente);
}

export function alActualizar() {
  activarFiltro(document.getElementById('buscar-clientes'), document.getElementById('tabla-clientes'));
}

export const accionesClientes = {
  'nuevo-cliente': () => abrirFormularioCliente(null),

  'editar-cliente': (id, estado) => {
    const cliente = estado.clientes.find((c) => c.id === id);
    if (cliente) abrirFormularioCliente(cliente);
  },

  'eliminar-cliente': async (id, estado) => {
    const cliente = estado.clientes.find((c) => c.id === id);
    const ok = await confirmar(`¿Eliminar a ${cliente?.nombre}? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      store.eliminarCliente(id);
      exito('Cliente eliminado.');
    } catch (err) {
      toastError(err.message);
    }
  },
};
