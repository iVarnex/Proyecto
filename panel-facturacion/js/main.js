'use strict';

/**
 * Punto de entrada: arranca el store, el router y la delegación de eventos.
 * Un solo listener de clics en `#app` para todos los `data-accion` — así
 * cualquier vista se puede re-renderizar entera sin dejar listeners huérfanos.
 *
 * Cada ruta puede declarar dos hooks distintos:
 *   - `alMontar`: corre una sola vez, al entrar a la ruta (p. ej. abrir un
 *     modal porque la URL trae un :id).
 *   - `alActualizar`: corre después de CADA render de esa ruta, incluidos
 *     los que dispara una mutación del store (p. ej. volver a enlazar los
 *     campos editables de una factura, que se recrean con cada render).
 */

import { getEstado, suscribir } from './core/store.js';
import { ruta, rutaPorDefecto, iniciarRouter } from './core/router.js';
import { montar } from './core/render.js';
import { vistaDashboard, accionesDashboard, alActualizar as alActualizarDashboard } from './views/dashboard.js';
import { vistaClientes, accionesClientes, alMontar as alMontarClientes, alActualizar as alActualizarClientes } from './views/clientes.js';
import { vistaProyectos, accionesProyectos, alActualizar as alActualizarProyectos } from './views/proyectos.js';
import { vistaHoras, accionesHoras, alActualizar as alActualizarHoras, alDesmontar as alDesmontarHoras } from './views/horas.js';
import { vistaFacturas, accionesFacturas, alActualizar as alActualizarFacturas } from './views/facturas.js';
import { vistaFacturaDetalle, accionesFacturaDetalle, alActualizar as alActualizarFacturaDetalle } from './views/factura-detalle.js';
import { vistaAjustes, accionesAjustes, alActualizar as alActualizarAjustes } from './views/ajustes.js';
import { error as toastError, aviso } from './ui/toast.js';

const app = document.getElementById('app');

const acciones = {
  ...accionesDashboard,
  ...accionesClientes,
  ...accionesProyectos,
  ...accionesHoras,
  ...accionesFacturas,
  ...accionesFacturaDetalle,
  ...accionesAjustes,
};

let paramsActuales = {};
let alDesmontarActual = null;
let rerenderActual = () => {};

function definirRuta(patron, render, { alMontar, alActualizar, alDesmontar } = {}) {
  ruta(patron, (params) => {
    alDesmontarActual?.();
    paramsActuales = params;

    rerenderActual = () => {
      montar(app, render(getEstado(), params));
      marcarNavActiva(patron);
      alActualizar?.(getEstado(), params);
    };
    rerenderActual();

    alDesmontarActual = alDesmontar ?? null;
    alMontar?.(getEstado(), params);

    /* Mover el foco al contenido nuevo en cada navegación (no en los
       re-renders que dispara el store) — sin esto, un lector de pantalla
       se queda "parado" en el enlace de la barra lateral que se acaba de
       activar y no se entera de que la página cambió. */
    app.focus({ preventScroll: true });
  });
}

definirRuta('/', vistaDashboard, { alActualizar: alActualizarDashboard });
definirRuta('/clientes', vistaClientes, { alMontar: alMontarClientes, alActualizar: alActualizarClientes });
definirRuta('/clientes/:id', vistaClientes, { alMontar: alMontarClientes, alActualizar: alActualizarClientes });
definirRuta('/proyectos', vistaProyectos, { alActualizar: alActualizarProyectos });
definirRuta('/horas', vistaHoras, { alActualizar: alActualizarHoras, alDesmontar: alDesmontarHoras });
definirRuta('/facturas', vistaFacturas, { alActualizar: alActualizarFacturas });
definirRuta('/facturas/:id', vistaFacturaDetalle, { alActualizar: alActualizarFacturaDetalle });
definirRuta('/ajustes', vistaAjustes, { alActualizar: alActualizarAjustes });

rutaPorDefecto(() => {
  montar(app, '<div class="vacio"><h2>Página no encontrada</h2><a class="btn" href="#/">Ir al dashboard</a></div>');
});

function marcarNavActiva(patron) {
  const base = '/' + (patron.split('/')[1] ?? '');
  document.querySelectorAll('.barra-lateral a').forEach((enlace) => {
    enlace.classList.toggle('activo', enlace.getAttribute('href') === `#${base}`);
  });
}

/* Repinta la vista activa ante cualquier mutación del store, venga de un
   data-accion, de un formulario o de una importación de respaldo. */
suscribir(() => rerenderActual());

document.getElementById('saltar-contenido').addEventListener('click', () => app.focus());

app.addEventListener('click', (e) => {
  const boton = e.target.closest('[data-accion]');
  if (!boton) return;
  const { accion, id } = boton.dataset;
  const manejador = acciones[accion];
  if (!manejador) return;
  try {
    manejador(id, getEstado(), boton, e, paramsActuales);
  } catch (err) {
    toastError(err.message);
  }
});

document.addEventListener('almacenamiento-lleno', () => {
  toastError('El almacenamiento del navegador está lleno. Exporta un respaldo y libera espacio.');
});

document.addEventListener('almacenamiento-error', (e) => {
  aviso(`No se pudo guardar: ${e.detail}`);
});

window.addEventListener('beforeunload', (e) => {
  if (getEstado().cronometro) {
    e.preventDefault();
    e.returnValue = '';
  }
});

iniciarRouter();
