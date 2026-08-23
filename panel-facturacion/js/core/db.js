/**
 * Persistencia en localStorage con esquema versionado.
 *
 * El `schemaVersion` existe desde el primer commit: agregar un campo más
 * adelante no puede tronar con los datos que el usuario ya tiene guardados.
 */

const CLAVE = 'facturacion.v1';
const VERSION_ACTUAL = 3;
const RETARDO_GUARDADO_MS = 300;

export const AJUSTES_INICIALES = {
  negocio: {
    nombre: 'Juan Gutiérrez & Camilo Escobar',
    nit: '',
    direccion: '',
    email: '',
    telefono: '',
    regimen: 'simplificado',
  },
  monedaBase: 'COP',
  consecutivo: { prefijo: 'FV-', siguiente: 1, padding: 4 },
  impuestos: {
    ivaPct: 19.0,
    reteFuentePct: 11.0,
    reteIcaPorMil: 6.9,
    aplicarIvaPorDefecto: true,
  },
  pago: {
    metodos: [
      { tipo: 'nequi', etiqueta: 'Nequi', detalle: '' },
      { tipo: 'paypal', etiqueta: 'PayPal', detalle: '' },
    ],
    diasVencimiento: 15,
  },
  ultimoRespaldo: null,
};

export const ESTADO_INICIAL = {
  schemaVersion: VERSION_ACTUAL,
  ajustes: AJUSTES_INICIALES,
  clientes: [],
  proyectos: [],
  registros: [],
  facturas: [],
  cronometro: null,
  fxCache: {},
};

/** Cada migración lleva el estado de la versión N a la N+1. */
const migraciones = {
  1: (e) => ({ ...e, facturas: e.facturas.map((f) => ({ ...f, pagos: f.pagos ?? [] })) }),
  2: (e) => ({
    ...e,
    ajustes: {
      ...e.ajustes,
      pago: e.ajustes.pago ?? { metodos: [], diasVencimiento: 15 },
    },
  }),
};

export function cargar() {
  let crudo = null;
  try {
    crudo = localStorage.getItem(CLAVE);
  } catch {
    /* modo privado o almacenamiento bloqueado: se trabaja solo en memoria */
    return structuredClone(ESTADO_INICIAL);
  }
  if (!crudo) return structuredClone(ESTADO_INICIAL);

  let estado;
  try {
    estado = JSON.parse(crudo);
  } catch {
    /* datos corruptos: se conservan aparte en vez de perderlos en silencio */
    try {
      localStorage.setItem(`${CLAVE}.corrupto.${Date.now()}`, crudo);
    } catch {
      /* si tampoco cabe la copia, seguimos: el estado inicial es lo importante */
    }
    return structuredClone(ESTADO_INICIAL);
  }

  return migrar(estado);
}

export function migrar(estado) {
  let version = estado.schemaVersion ?? 1;
  let migrado = estado;

  while (version < VERSION_ACTUAL) {
    const migracion = migraciones[version];
    if (!migracion) break;
    migrado = migracion(migrado);
    version += 1;
  }

  /* un estado de una versión futura (respaldo de otra máquina) se deja intacto */
  return {
    ...structuredClone(ESTADO_INICIAL),
    ...migrado,
    ajustes: { ...AJUSTES_INICIALES, ...(migrado.ajustes ?? {}) },
    schemaVersion: Math.max(version, estado.schemaVersion ?? VERSION_ACTUAL),
  };
}

let guardadoPendiente = null;

/** Debounce: escribir en cada tecla de un formulario da lag perceptible. */
export function guardar(estado) {
  clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(() => escribir(estado), RETARDO_GUARDADO_MS);
}

export function guardarYa(estado) {
  clearTimeout(guardadoPendiente);
  escribir(estado);
}

function escribir(estado) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      document.dispatchEvent(new CustomEvent('almacenamiento-lleno'));
      return;
    }
    document.dispatchEvent(new CustomEvent('almacenamiento-error', { detail: error.message }));
  }
}

export function exportar(estado) {
  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const enlace = Object.assign(document.createElement('a'), {
    href: url,
    download: `respaldo-facturacion-${new Date().toISOString().slice(0, 10)}.json`,
  });
  enlace.click();
  URL.revokeObjectURL(url);
}

/** Lee un respaldo y lo migra a la versión actual antes de adoptarlo. */
export async function importar(archivo) {
  const texto = await archivo.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un respaldo válido (no es JSON).');
  }
  if (!datos || !Array.isArray(datos.clientes) || !Array.isArray(datos.facturas)) {
    throw new Error('El archivo no tiene la forma de un respaldo de este panel.');
  }
  return migrar(datos);
}

export function borrarTodo() {
  clearTimeout(guardadoPendiente);
  localStorage.removeItem(CLAVE);
}
