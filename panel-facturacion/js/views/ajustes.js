import { html } from '../core/render.js';
import { leerFormulario, formularioValido } from '../ui/form.js';
import { confirmar } from '../ui/modal.js';
import { exito, error as toastError } from '../ui/toast.js';
import * as store from '../core/store.js';

export function vistaAjustes(estado) {
  const { negocio, monedaBase, consecutivo, impuestos, pago, ultimoRespaldo } = estado.ajustes;

  return html`
    <header class="vista__cabecera"><h1>Ajustes</h1></header>

    <form class="formulario tarjeta" data-form="ajustes-negocio" novalidate>
      <h2 class="tarjeta__titulo">Tu negocio</h2>
      <label class="campo"><span>Nombre o razón social</span><input name="nombre" type="text" value="${negocio.nombre}" required></label>
      <label class="campo"><span>NIT</span><input name="nit" type="text" value="${negocio.nit}"></label>
      <label class="campo"><span>Dirección</span><input name="direccion" type="text" value="${negocio.direccion}"></label>
      <div class="campo-grupo">
        <label class="campo"><span>Correo</span><input name="email" type="email" value="${negocio.email}"></label>
        <label class="campo"><span>Teléfono</span><input name="telefono" type="text" value="${negocio.telefono}"></label>
      </div>
      <label class="campo"><span>Moneda base (en la que ves reportes)</span><input name="monedaBase" type="text" maxlength="3" value="${monedaBase}" required></label>
      <button class="btn btn--primario" type="submit">Guardar</button>
    </form>

    <form class="formulario tarjeta" data-form="ajustes-facturacion" novalidate>
      <h2 class="tarjeta__titulo">Facturación</h2>
      <div class="campo-grupo">
        <label class="campo"><span>Prefijo</span><input name="prefijo" type="text" value="${consecutivo.prefijo}"></label>
        <label class="campo"><span>Siguiente número</span><input name="siguiente" type="number" min="1" value="${consecutivo.siguiente}"></label>
        <label class="campo"><span>Ceros (padding)</span><input name="padding" type="number" min="1" max="8" value="${consecutivo.padding}"></label>
      </div>
      <label class="campo"><span>Días para vencer</span><input name="diasVencimiento" type="number" min="1" value="${pago.diasVencimiento}"></label>
      <p class="tarjeta__ayuda">El consecutivo se asigna al emitir, no al crear el borrador: no dejes huecos cambiándolo a mano salvo que estés migrando de otro sistema.</p>
      <button class="btn btn--primario" type="submit">Guardar</button>
    </form>

    <form class="formulario tarjeta" data-form="ajustes-impuestos" novalidate>
      <h2 class="tarjeta__titulo">Impuestos por defecto</h2>
      <div class="campo-grupo">
        <label class="campo"><span>IVA %</span><input name="ivaPct" type="number" min="0" step="0.1" value="${impuestos.ivaPct}"></label>
        <label class="campo"><span>ReteFuente %</span><input name="reteFuentePct" type="number" min="0" step="0.1" value="${impuestos.reteFuentePct}"></label>
        <label class="campo"><span>ReteICA ‰</span><input name="reteIcaPorMil" type="number" min="0" step="0.1" value="${impuestos.reteIcaPorMil}"></label>
      </div>
      <label class="campo campo--linea">
        <input name="aplicarIvaPorDefecto" type="checkbox" ${impuestos.aplicarIvaPorDefecto ? 'checked' : ''}>
        <span>Aplicar IVA por defecto a clientes nuevos</span>
      </label>
      <p class="tarjeta__ayuda">Los clientes fuera de Colombia quedan en cero por defecto (exportación de servicios). Valida los porcentajes con un contador antes de facturar de verdad.</p>
      <button class="btn btn--primario" type="submit">Guardar</button>
    </form>

    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Métodos de pago</h2>
      <ul class="lista-simple">
        ${pago.metodos.map((m, i) => html`<li>${m.etiqueta}: ${m.detalle || '—'} <button class="btn btn--icono btn--peligro" data-accion="eliminar-metodo-pago" data-id="${i}" type="button">✕</button></li>`)}
      </ul>
      <form class="formulario formulario--linea" data-form="nuevo-metodo-pago" novalidate>
        <input name="etiqueta" type="text" placeholder="Nombre (ej. Nequi)" required>
        <input name="detalle" type="text" placeholder="Cuenta / usuario">
        <button class="btn" type="submit">Agregar</button>
      </form>
    </section>

    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Respaldo</h2>
      <p class="tarjeta__ayuda">
        Todo vive en este navegador. Si limpias sus datos, se pierde.
        ${ultimoRespaldo ? html`Último respaldo: ${ultimoRespaldo.slice(0, 10)}.` : html`<strong>Nunca has exportado un respaldo.</strong>`}
      </p>
      <div class="vista__acciones">
        <button class="btn btn--primario" data-accion="exportar-respaldo" type="button">Exportar respaldo</button>
        <label class="btn">
          Importar respaldo
          <input type="file" accept="application/json" data-accion-archivo="importar-respaldo" hidden>
        </label>
        <button class="btn btn--peligro" data-accion="borrar-todo" type="button">Borrar todos los datos</button>
      </div>
    </section>

    <section class="tarjeta">
      <h2 class="tarjeta__titulo">Modo de prueba</h2>
      <p class="tarjeta__ayuda">Carga clientes, proyectos, horas y facturas inventados para ver el panel en funcionamiento. <strong>Reemplaza los datos actuales de este navegador</strong> — úsalo para explorar la app, no en una cuenta con datos reales.</p>
      <div class="vista__acciones">
        <button class="btn" data-accion="cargar-datos-demo" type="button">Cargar datos de demostración</button>
      </div>
    </section>`;
}

function guardarFormulario(form, { alGuardar }) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!formularioValido(form)) return;
    try {
      alGuardar(leerFormulario(form));
      exito('Ajustes guardados.');
    } catch (err) {
      toastError(err.message);
    }
  });
}

export function alActualizar() {
  const negocio = document.querySelector('[data-form="ajustes-negocio"]');
  if (negocio) guardarFormulario(negocio, {
    alGuardar: (d) => store.actualizarAjustes({
      negocio: { ...store.getEstado().ajustes.negocio, nombre: d.nombre, nit: d.nit, direccion: d.direccion, email: d.email, telefono: d.telefono },
      monedaBase: d.monedaBase.toUpperCase(),
    }),
  });

  const facturacion = document.querySelector('[data-form="ajustes-facturacion"]');
  if (facturacion) guardarFormulario(facturacion, {
    alGuardar: (d) => store.actualizarAjustes({
      consecutivo: { prefijo: d.prefijo, siguiente: d.siguiente, padding: d.padding },
      pago: { ...store.getEstado().ajustes.pago, diasVencimiento: d.diasVencimiento },
    }),
  });

  const impuestos = document.querySelector('[data-form="ajustes-impuestos"]');
  if (impuestos) guardarFormulario(impuestos, {
    alGuardar: (d) => store.actualizarAjustes({
      impuestos: { ivaPct: d.ivaPct, reteFuentePct: d.reteFuentePct, reteIcaPorMil: d.reteIcaPorMil, aplicarIvaPorDefecto: d.aplicarIvaPorDefecto },
    }),
  });

  const nuevoMetodo = document.querySelector('[data-form="nuevo-metodo-pago"]');
  nuevoMetodo?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = leerFormulario(nuevoMetodo);
    const metodos = [...store.getEstado().ajustes.pago.metodos, { tipo: d.etiqueta.toLowerCase(), etiqueta: d.etiqueta, detalle: d.detalle }];
    store.actualizarAjustes({ pago: { ...store.getEstado().ajustes.pago, metodos } });
    nuevoMetodo.reset();
    exito('Método de pago agregado.');
  });

  document.querySelector('[data-accion-archivo="importar-respaldo"]')?.addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const ok = await confirmar('Importar reemplazará todos los datos actuales por los del respaldo. ¿Continuar?');
    if (!ok) { e.target.value = ''; return; }
    try {
      await store.importarRespaldoDesdeArchivo(archivo);
      exito('Respaldo importado.');
    } catch (err) {
      toastError(err.message);
    }
    e.target.value = '';
  });
}

export const accionesAjustes = {
  'eliminar-metodo-pago': (indice) => {
    const metodos = store.getEstado().ajustes.pago.metodos.filter((_, i) => String(i) !== indice);
    store.actualizarAjustes({ pago: { ...store.getEstado().ajustes.pago, metodos } });
  },

  'exportar-respaldo': () => {
    store.exportarRespaldo();
    exito('Respaldo descargado.');
  },

  'borrar-todo': async () => {
    const ok = await confirmar('Esto borra TODOS los datos guardados en este navegador de forma permanente. ¿Continuar?', { textoConfirmar: 'Borrar todo' });
    if (!ok) return;
    store.borrarTodo();
    exito('Datos borrados.');
  },

  'cargar-datos-demo': async () => {
    const ok = await confirmar('Esto reemplaza todos los datos actuales de este navegador por datos de demostración inventados. ¿Continuar?', { textoConfirmar: 'Cargar demostración' });
    if (!ok) return;
    try {
      await store.cargarDatosDemo();
      exito('Datos de demostración cargados.');
    } catch (err) {
      toastError(err.message);
    }
  },
};
