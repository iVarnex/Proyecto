# Panel de facturación freelance multi-moneda
### Guía de construcción — HTML + CSS + JS vanilla

---

## 0. Alcance y decisiones de arquitectura

Antes de escribir código, fija estas decisiones. Cambiarlas después cuesta caro.

| Decisión | Elección | Por qué |
|---|---|---|
| Framework | Ninguno. ES Modules nativos | El proyecto cabe en vanilla y demuestra que entiendes lo que un framework hace por ti |
| Build | Ninguno. `<script type="module">` | Abres `index.html` y funciona. Sin npm, sin bundler |
| Persistencia | `localStorage` con esquema versionado | Suficiente para datos de un solo usuario. IndexedDB solo si guardas adjuntos binarios |
| Estado | Store central + re-render por vista | Una sola fuente de verdad. Sin sincronizar DOM a mano |
| Ruteo | Hash router (`#/clientes`, `#/facturas/f-003`) | Funciona con `file://` y sin servidor |
| Dinero | Enteros en unidad mínima (centavos) | **Innegociable.** Ver sección 6 |
| PDF | `window.print()` + CSS `@media print` | Cero dependencias. `pdf-lib` solo si necesitas control milimétrico |

**Lo que SÍ hace la app:**
clientes → proyectos → registro de horas (manual + cronómetro) → facturas → cobros → alertas de vencimiento.

**Lo que NO hace (y está bien):**
multiusuario, backend, autenticación, contabilidad completa, integración bancaria real.

---

## 1. Estructura de archivos

```
panel-facturacion/
│
├── index.html                  # Único HTML. Shell + <template> por vista
├── manifest.json               # Opcional: PWA instalable
│
├── css/
│   ├── tokens.css              # Variables: color, espaciado, tipografía
│   ├── base.css                # Reset, tipografía base, elementos nativos
│   ├── layout.css              # Sidebar, contenedor, grid de la app
│   ├── components.css          # Botones, cards, tablas, badges, modal, inputs
│   └── print.css               # @media print — solo la factura
│
├── js/
│   ├── main.js                 # Punto de entrada: arranca store, router, listeners
│   │
│   ├── core/
│   │   ├── store.js            # Estado + suscripciones + acciones
│   │   ├── db.js               # localStorage: load, save, migraciones
│   │   ├── router.js           # Hash router
│   │   └── render.js           # html`` tagged template + helpers de DOM
│   │
│   ├── domain/                 # ← Lógica pura. Sin DOM. Testeable.
│   │   ├── money.js            # Enteros, formateo, aritmética
│   │   ├── fx.js               # Tasas de cambio, conversión, caché
│   │   ├── time.js             # Duraciones, cronómetro, agrupación por día
│   │   ├── invoice.js          # Numeración, cálculo de totales, estados
│   │   ├── tax.js              # IVA, retenciones — configurable
│   │   └── id.js               # Generación de IDs
│   │
│   ├── views/                  # ← Una función por pantalla. Recibe estado, devuelve HTML
│   │   ├── dashboard.js
│   │   ├── clientes.js
│   │   ├── proyectos.js
│   │   ├── horas.js
│   │   ├── facturas.js
│   │   ├── factura-detalle.js
│   │   └── ajustes.js
│   │
│   └── ui/
│       ├── modal.js            # Modal genérico con promesa
│       ├── toast.js            # Notificaciones
│       └── form.js             # Lectura/validación de formularios
│
└── data/
    └── seed.json               # Datos de ejemplo para desarrollo
```

**Regla que sostiene todo esto:** nada dentro de `domain/` puede tocar `document`, `window` ni `localStorage`. Si una función de `domain/` necesita la fecha actual, se la pasas como parámetro. Así puedes probarla sin navegador y sin mocks.

---

## 2. Modelo de datos

Todo el estado vive en un solo objeto. Esto es lo que se serializa a `localStorage`.

```js
{
  schemaVersion: 3,

  ajustes: {
    negocio: {
      nombre: "Tu nombre o razón social",
      nit: "1234567890-1",
      direccion: "",
      email: "",
      telefono: "",
      regimen: "simplificado"      // afecta si aplicas IVA
    },
    monedaBase: "COP",             // en la que ves reportes y totales
    consecutivo: {
      prefijo: "FV-",
      siguiente: 14,
      padding: 4                   // FV-0014
    },
    impuestos: {
      ivaPct: 19.0,
      reteFuentePct: 11.0,         // servicios — verifica tu caso
      reteIcaPorMil: 6.9,          // varía por municipio
      aplicarIvaPorDefecto: true
    },
    pago: {
      metodos: [
        { tipo: "nequi",  etiqueta: "Nequi",  detalle: "300 000 0000" },
        { tipo: "paypal", etiqueta: "PayPal", detalle: "tu@correo.com" }
      ],
      diasVencimiento: 15
    }
  },

  clientes: [
    {
      id: "cli_k3n8",
      nombre: "Acme S.A.S.",
      contacto: "María Pérez",
      email: "maria@acme.co",
      identificacion: "900123456-7",
      pais: "CO",
      moneda: "COP",               // moneda en la que se le factura
      tarifaHora: 8500000,         // ← centavos. 85.000,00 COP
      notas: "",
      activo: true,
      creadoEn: "2026-01-15T10:00:00.000Z"
    }
  ],

  proyectos: [
    {
      id: "pry_2a9f",
      clienteId: "cli_k3n8",
      nombre: "Rediseño del portal",
      tarifaHora: null,            // null = hereda la del cliente
      moneda: null,                // null = hereda la del cliente
      presupuestoHoras: 120,
      estado: "activo",            // activo | pausado | cerrado
      color: "#4f8fd6"
    }
  ],

  registros: [                     // entradas de tiempo
    {
      id: "reg_88bc",
      proyectoId: "pry_2a9f",
      fecha: "2026-02-03",         // día local, YYYY-MM-DD
      inicioTs: 1770123600000,     // epoch ms — null si fue entrada manual
      finTs:    1770132600000,
      segundos: 9000,              // fuente de verdad de la duración
      descripcion: "Maquetación del header",
      facturable: true,
      facturaId: null              // se llena al facturar
    }
  ],

  facturas: [
    {
      id: "fac_5d21",
      numero: "FV-0013",
      clienteId: "cli_k3n8",
      estado: "enviada",           // borrador | enviada | pagada | vencida | anulada
      emitidaEn: "2026-02-05",
      venceEn: "2026-02-20",
      moneda: "USD",               // moneda de la factura

      // Snapshot de tasa. NUNCA se recalcula. Ver sección 6.
      fx: {
        desde: "USD",
        hacia: "COP",
        tasa: 4218.55,
        fuente: "TRM Superfinanciera",
        capturadaEn: "2026-02-05T14:00:00.000Z"
      },

      items: [
        {
          id: "itm_1",
          descripcion: "Desarrollo frontend — febrero",
          cantidad: 24.5,          // horas
          precioUnitario: 2000,    // centavos: 20,00 USD/hora
          registroIds: ["reg_88bc", "reg_88bd"]
        }
      ],

      // Snapshot de impuestos al momento de emitir
      impuestos: {
        ivaPct: 0,                 // exportación de servicios
        reteFuentePct: 0,
        reteIcaPorMil: 0
      },

      // Totales congelados (calculados al emitir, no en cada render)
      totales: {
        subtotal: 49000,
        descuento: 0,
        iva: 0,
        reteFuente: 0,
        reteIca: 0,
        total: 49000,
        totalEnBase: 206709000     // 490,00 USD × 4218,55 → COP
      },

      pagos: [
        { fecha: "2026-02-18", monto: 49000, metodo: "paypal", referencia: "8XJ..." }
      ],

      notas: "Gracias por su confianza."
    }
  ],

  fxCache: {                       // tasas descargadas
    "USD_COP": { tasa: 4218.55, ts: 1770307200000, fuente: "open.er-api" }
  }
}
```

### Por qué hay campos "duplicados"

`tarifaHora` está en el cliente y en el proyecto. `moneda` también. Y los totales están guardados en vez de calculados.

No es redundancia: es **snapshot**. Una factura emitida es un documento histórico. Si el cliente sube su tarifa en marzo, la factura de enero no puede cambiar. Todo lo que afecta un documento emitido se congela dentro de él.

Regla práctica: **borrador = calculado en vivo. Emitido = congelado.**

---

## 3. Persistencia con migraciones

`js/core/db.js`

```js
const CLAVE = 'facturacion.v1';
const VERSION_ACTUAL = 3;

const ESTADO_INICIAL = {
  schemaVersion: VERSION_ACTUAL,
  ajustes: { /* defaults */ },
  clientes: [], proyectos: [], registros: [], facturas: [], fxCache: {}
};

// Cada migración lleva el estado de la versión N a la N+1
const migraciones = {
  1: (e) => ({ ...e, facturas: e.facturas.map(f => ({ ...f, pagos: [] })) }),
  2: (e) => ({ ...e, ajustes: { ...e.ajustes, pago: { metodos: [], diasVencimiento: 15 } } })
};

export function cargar() {
  const crudo = localStorage.getItem(CLAVE);
  if (!crudo) return structuredClone(ESTADO_INICIAL);

  let estado;
  try {
    estado = JSON.parse(crudo);
  } catch {
    // Datos corruptos: no los pierdas silenciosamente
    localStorage.setItem(CLAVE + '.corrupto.' + Date.now(), crudo);
    return structuredClone(ESTADO_INICIAL);
  }

  let v = estado.schemaVersion ?? 1;
  while (v < VERSION_ACTUAL) {
    estado = migraciones[v](estado);
    v++;
  }
  estado.schemaVersion = VERSION_ACTUAL;
  return estado;
}

let pendiente = null;
export function guardar(estado) {
  // Debounce: no escribas en cada tecla
  clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (err) {
      if (err.name === 'QuotaExceededError') {
        // Avisa. No falles en silencio.
        document.dispatchEvent(new CustomEvent('almacenamiento-lleno'));
      }
    }
  }, 300);
}

export function exportar(estado) {
  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `respaldo-${new Date().toISOString().slice(0,10)}.json`
  });
  a.click();
  URL.revokeObjectURL(url);
}
```

El botón de **exportar respaldo** no es opcional. `localStorage` se borra cuando el usuario limpia el navegador. Ponlo visible en Ajustes y recuérdaselo cada 30 días.

---

## 4. Store: estado + suscripciones

`js/core/store.js`

```js
import { cargar, guardar } from './db.js';

let estado = cargar();
const suscriptores = new Set();

export const getEstado = () => estado;

export function suscribir(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);   // devuelve función para desuscribir
}

function emitir() {
  guardar(estado);
  suscriptores.forEach(fn => fn(estado));
}

// --- Acciones: la ÚNICA forma de modificar el estado ---

export function crearCliente(datos) {
  estado = {
    ...estado,
    clientes: [...estado.clientes, { id: nuevoId('cli'), activo: true,
                                     creadoEn: new Date().toISOString(), ...datos }]
  };
  emitir();
}

export function actualizarRegistro(id, cambios) {
  estado = {
    ...estado,
    registros: estado.registros.map(r => r.id === id ? { ...r, ...cambios } : r)
  };
  emitir();
}

export function eliminarProyecto(id) {
  // Integridad referencial a mano: no dejes registros huérfanos
  const tieneRegistrosFacturados = estado.registros
    .some(r => r.proyectoId === id && r.facturaId);
  if (tieneRegistrosFacturados) {
    throw new Error('No se puede eliminar: tiene horas ya facturadas. Ciérralo en su lugar.');
  }
  estado = {
    ...estado,
    proyectos: estado.proyectos.filter(p => p.id !== id),
    registros: estado.registros.filter(r => r.proyectoId !== id)
  };
  emitir();
}
```

**Inmutabilidad**: siempre creas un objeto nuevo, nunca mutas. Esto te da undo gratis si algún día lo quieres (guardas los últimos N estados) y hace obvio en el diff qué cambió.

---

## 5. Render sin framework

`js/core/render.js`

```js
// Escapa por defecto. Interpolar strings sin escapar es un XSS esperando pasar.
const escapar = (s) => String(s)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function html(strings, ...valores) {
  return strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const v = valores[i - 1];
    if (Array.isArray(v)) return acc + v.join('') + str;   // ya son fragmentos html
    if (v && v.__raw) return acc + v.valor + str;          // marcado explícito
    return acc + escapar(v ?? '') + str;
  }, '');
}

export const crudo = (valor) => ({ __raw: true, valor });

export function montar(contenedor, marcado) {
  contenedor.innerHTML = marcado;
}
```

Y el patrón de vista:

```js
// js/views/clientes.js
import { html } from '../core/render.js';
import { formatear } from '../domain/money.js';

export function vistaClientes(estado) {
  const { clientes } = estado;

  if (clientes.length === 0) {
    return html`
      <div class="vacio">
        <h2>Aún no tienes clientes</h2>
        <p>Agrega el primero para empezar a registrar horas.</p>
        <button class="btn btn--primario" data-accion="nuevo-cliente">Agregar cliente</button>
      </div>`;
  }

  return html`
    <header class="vista__cabecera">
      <h1>Clientes</h1>
      <button class="btn btn--primario" data-accion="nuevo-cliente">Agregar cliente</button>
    </header>
    <table class="tabla">
      <thead>
        <tr><th>Cliente</th><th>Moneda</th><th class="num">Tarifa/hora</th><th>Proyectos</th><th></th></tr>
      </thead>
      <tbody>
        ${clientes.map(c => html`
          <tr>
            <td><a href="#/clientes/${c.id}">${c.nombre}</a><br><small>${c.email}</small></td>
            <td><span class="chip">${c.moneda}</span></td>
            <td class="num">${formatear(c.tarifaHora, c.moneda)}</td>
            <td>${estado.proyectos.filter(p => p.clienteId === c.id).length}</td>
            <td><button class="btn btn--icono" data-accion="editar-cliente" data-id="${c.id}">Editar</button></td>
          </tr>`)}
      </tbody>
    </table>`;
}
```

**Delegación de eventos**: un solo listener en el contenedor raíz, nunca uno por fila.

```js
// main.js
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const { accion, id } = btn.dataset;
  acciones[accion]?.(id, e);
});
```

Así puedes re-renderizar todo el HTML sin preocuparte por listeners huérfanos.

---

## 6. Dinero: la parte donde la mayoría se equivoca

### Nunca uses float para dinero

```js
0.1 + 0.2                 // 0.30000000000000004
19.99 * 3                 // 59.97000000000001
(0.615).toFixed(2)        // "0.61"  ← redondea mal
```

Guarda **enteros en la unidad mínima**. 85.000,00 COP → `8500000`. 20,00 USD → `2000`.

`js/domain/money.js`

```js
const DECIMALES = { COP: 2, USD: 2, EUR: 2, JPY: 0, CLP: 0 };

export const decimalesDe = (mon) => DECIMALES[mon] ?? 2;
export const factorDe = (mon) => 10 ** decimalesDe(mon);

/** "85.000,50" o "85000.50" → 8500050 */
export function parsear(texto, moneda) {
  const limpio = String(texto).trim().replace(/[^\d,.-]/g, '');
  // Si hay ambos separadores, el último es el decimal
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  let normalizado;
  if (ultimaComa > ultimoPunto) {
    normalizado = limpio.replaceAll('.', '').replace(',', '.');
  } else {
    normalizado = limpio.replaceAll(',', '');
  }
  const n = parseFloat(normalizado);
  if (Number.isNaN(n)) return null;
  return Math.round(n * factorDe(moneda));
}

export function formatear(centavos, moneda, { conSimbolo = true } = {}) {
  const d = decimalesDe(moneda);
  return new Intl.NumberFormat('es-CO', {
    style: conSimbolo ? 'currency' : 'decimal',
    currency: moneda,
    minimumFractionDigits: d,
    maximumFractionDigits: d
  }).format(centavos / factorDe(moneda));
}

/** Multiplicar entero por decimal (horas, porcentajes) con redondeo bancario */
export function multiplicar(centavos, factor) {
  const exacto = centavos * factor;
  const abajo = Math.floor(exacto);
  const resto = exacto - abajo;
  if (resto > 0.5) return abajo + 1;
  if (resto < 0.5) return abajo;
  return abajo % 2 === 0 ? abajo : abajo + 1;   // half-to-even
}

export const porcentaje = (centavos, pct) => multiplicar(centavos, pct / 100);

/** Reparte un monto entre N sin perder centavos por redondeo */
export function repartir(centavos, pesos) {
  const total = pesos.reduce((a, b) => a + b, 0);
  const partes = pesos.map(p => Math.floor(centavos * p / total));
  let sobrante = centavos - partes.reduce((a, b) => a + b, 0);
  for (let i = 0; sobrante > 0; i = (i + 1) % partes.length, sobrante--) partes[i]++;
  return partes;
}
```

### Conversión de monedas: dos reglas

**Regla 1 — La tasa se congela con el documento.**
Una factura emitida guarda la tasa que usaste ese día. Si mañana la TRM sube, la factura no cambia. Solo los borradores usan la tasa actual.

**Regla 2 — Guarda tanto el monto original como el convertido.**
La factura está en USD; tu reporte de ingresos está en COP. Si solo guardas uno, el otro se recalcula y tus números históricos bailan cada día.

`js/domain/fx.js`

```js
const VIGENCIA_MS = 4 * 60 * 60 * 1000;   // 4 horas

export async function obtenerTasa(desde, hacia, cache, ahora = Date.now()) {
  if (desde === hacia) return { tasa: 1, fuente: 'identidad', ts: ahora };

  const clave = `${desde}_${hacia}`;
  const guardada = cache[clave];
  if (guardada && ahora - guardada.ts < VIGENCIA_MS) return guardada;

  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${desde}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const datos = await r.json();
    const tasa = datos.rates?.[hacia];
    if (!tasa) throw new Error(`Sin tasa para ${hacia}`);
    return { tasa, ts: ahora, fuente: 'open.er-api' };
  } catch (err) {
    // Degradación: usa la caché vencida antes que fallar
    if (guardada) return { ...guardada, vencida: true };
    throw new Error('No se pudo obtener la tasa. Ingrésala manualmente.');
  }
}

export function convertir(centavos, tasa, monedaOrigen, monedaDestino) {
  const valor = centavos / factorDe(monedaOrigen);
  return Math.round(valor * tasa * factorDe(monedaDestino));
}
```

**Siempre deja editar la tasa a mano.** La API se cae, tu cliente pactó una tasa fija, o facturas en Colombia y necesitas la TRM oficial de la Superfinanciera de ese día exacto, no la de un agregador. Un campo `<input>` junto a la tasa con un botón "Actualizar" resuelve los tres casos.

Cuando uses una tasa vencida o manual, márcalo en la UI: `<span class="chip chip--aviso">Tasa manual</span>`.

---

## 7. Cronómetro que no miente

El error clásico: acumular con `setInterval`. Si el usuario cambia de pestaña, el navegador estrangula el intervalo y pierdes minutos.

**Solución:** el intervalo solo pinta. La verdad son los timestamps.

`js/domain/time.js`

```js
export function segundosTranscurridos(inicioTs, pausas = [], ahora = Date.now()) {
  const bruto = ahora - inicioTs;
  const pausado = pausas.reduce((acc, p) => acc + ((p.fin ?? ahora) - p.inicio), 0);
  return Math.floor((bruto - pausado) / 1000);
}

export function formatearDuracion(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/** Horas decimales para facturar, redondeadas al bloque de facturación */
export function horasFacturables(segundos, bloqueMinutos = 15) {
  const minutos = segundos / 60;
  const bloques = Math.ceil(minutos / bloqueMinutos);
  return (bloques * bloqueMinutos) / 60;
}
```

Y en la UI:

```js
let idIntervalo = null;

function iniciarCronometro(proyectoId) {
  const inicio = Date.now();
  store.iniciarCronometro({ proyectoId, inicioTs: inicio });
  idIntervalo = setInterval(pintarCronometro, 1000);
}

function pintarCronometro() {
  const c = store.getEstado().cronometro;
  if (!c) return;
  // Recalcula desde el timestamp, no incrementa un contador
  document.querySelector('#cronometro').textContent =
    formatearDuracion(segundosTranscurridos(c.inicioTs, c.pausas));
}

// Al recargar la página, si había un cronómetro corriendo, se retoma solo:
// el inicioTs está en localStorage y el cálculo es contra Date.now().
window.addEventListener('beforeunload', (e) => {
  if (store.getEstado().cronometro) {
    e.preventDefault();
    e.returnValue = '';   // "¿Seguro que quieres salir?"
  }
});
```

### Fechas: usa el día local, no el UTC

```js
// MAL: en Colombia (UTC-5) a las 8 p.m. esto devuelve el día siguiente
new Date().toISOString().slice(0, 10);

// BIEN:
export function hoyLocal(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
```

---

## 8. Facturas: numeración, cálculo y estados

### Numeración

El consecutivo debe ser **irrepetible y sin huecos**. Se asigna al **emitir**, no al crear el borrador.

```js
export function siguienteNumero(consecutivo) {
  const { prefijo, siguiente, padding } = consecutivo;
  return prefijo + String(siguiente).padStart(padding, '0');
}

export function emitirFactura(estado, facturaId, ahora = new Date()) {
  const f = estado.facturas.find(x => x.id === facturaId);
  if (f.estado !== 'borrador') throw new Error('La factura ya fue emitida.');
  if (f.items.length === 0) throw new Error('Agrega al menos un ítem antes de emitir.');

  const numero = siguienteNumero(estado.ajustes.consecutivo);
  const emitidaEn = hoyLocal(ahora);
  const venceEn = sumarDias(emitidaEn, estado.ajustes.pago.diasVencimiento);

  return {
    ...estado,
    facturas: estado.facturas.map(x => x.id !== facturaId ? x : {
      ...x,
      numero, emitidaEn, venceEn,
      estado: 'enviada',
      totales: calcularTotales(x),           // ← congela
      impuestos: { ...x.impuestos }          // ← congela
    }),
    ajustes: {
      ...estado.ajustes,
      consecutivo: { ...estado.ajustes.consecutivo,
                     siguiente: estado.ajustes.consecutivo.siguiente + 1 }
    }
  };
}
```

Una factura emitida **no se edita ni se borra**. Se anula y se crea otra. Bloquea los inputs cuando `estado !== 'borrador'`.

### Cálculo de totales — el orden importa

```js
// js/domain/tax.js
export function calcularTotales(factura) {
  const { items, descuentoPct = 0, impuestos, moneda, fx } = factura;

  // 1. Subtotal: suma de líneas
  const subtotal = items.reduce(
    (acc, it) => acc + multiplicar(it.precioUnitario, it.cantidad), 0
  );

  // 2. Descuento sobre el subtotal
  const descuento = porcentaje(subtotal, descuentoPct);
  const base = subtotal - descuento;

  // 3. IVA sobre la base (después del descuento)
  const iva = porcentaje(base, impuestos.ivaPct);

  // 4. Retenciones sobre la BASE, no sobre base+IVA
  const reteFuente = porcentaje(base, impuestos.reteFuentePct);
  const reteIca = multiplicar(base, impuestos.reteIcaPorMil / 1000);

  // 5. Total: las retenciones RESTAN (el cliente las paga a la DIAN por ti)
  const total = base + iva - reteFuente - reteIca;

  const totalEnBase = fx ? convertir(total, fx.tasa, moneda, fx.hacia) : total;

  return { subtotal, descuento, base, iva, reteFuente, reteIca, total, totalEnBase };
}
```

> **Nota fiscal:** los porcentajes y el orden reflejan el caso común de servicios en Colombia, pero cambian según tu régimen, si eres declarante, el municipio (ReteICA) y si exportas servicios (que suele estar excluido de IVA). Deja todo configurable en Ajustes y valida los porcentajes con un contador antes de facturar de verdad. La app calcula lo que le digas; no decide por ti.

### Estados y transiciones

```
borrador ──emitir──▶ enviada ──registrar pago──▶ pagada
                        │
                        ├──vence sin pago──▶ vencida ──pago──▶ pagada
                        │
                        └──anular──▶ anulada
```

`vencida` **no se guarda**: se calcula al vuelo. Si la guardas, se desactualiza sola.

```js
export function estadoEfectivo(factura, hoy = hoyLocal()) {
  if (factura.estado !== 'enviada') return factura.estado;
  const pagado = factura.pagos.reduce((a, p) => a + p.monto, 0);
  if (pagado >= factura.totales.total) return 'pagada';
  if (factura.venceEn < hoy) return 'vencida';
  return 'enviada';
}

export function diasParaVencer(factura, hoy = hoyLocal()) {
  return Math.round((new Date(factura.venceEn) - new Date(hoy)) / 86400000);
}
```

### Pagos parciales

Un cliente abona la mitad. Guarda cada pago como registro con su fecha y método; nunca sobrescribas el total. El saldo es `total - sum(pagos)`.

Si el pago llega en otra moneda (facturaste en USD, te pagaron en COP), guarda el monto **recibido realmente** y la tasa de ese día. La diferencia cambiaria es información que vas a querer ver.

---

## 9. Facturar horas

El flujo que conecta todo:

```js
export function crearBorradorDesdeHoras(estado, clienteId, { desde, hasta, agruparPor }) {
  const proyectosDelCliente = estado.proyectos
    .filter(p => p.clienteId === clienteId).map(p => p.id);

  const candidatos = estado.registros.filter(r =>
    proyectosDelCliente.includes(r.proyectoId) &&
    r.facturable &&
    r.facturaId === null &&                      // ← no facturar dos veces
    r.fecha >= desde && r.fecha <= hasta
  );

  if (candidatos.length === 0) {
    throw new Error('No hay horas pendientes de facturar en ese periodo.');
  }

  const cliente = estado.clientes.find(c => c.id === clienteId);

  // agruparPor: 'proyecto' | 'dia' | 'registro'
  const grupos = agrupar(candidatos, agruparPor, estado.proyectos);

  const items = grupos.map(g => {
    const proyecto = estado.proyectos.find(p => p.id === g.proyectoId);
    const tarifa = proyecto?.tarifaHora ?? cliente.tarifaHora;
    return {
      id: nuevoId('itm'),
      descripcion: g.etiqueta,
      cantidad: horasFacturables(g.segundos),
      precioUnitario: tarifa,
      registroIds: g.registros.map(r => r.id)
    };
  });

  return { /* factura borrador con esos items */ };
}
```

Al emitir, marca los registros: `facturaId = factura.id`. Al anular, libéralos.

---

## 10. PDF sin librerías

`css/print.css`

```css
@media print {
  /* Oculta todo menos la factura */
  body > *:not(#area-impresion) { display: none !important; }

  @page {
    size: letter;               /* carta, estándar en Colombia */
    margin: 18mm 15mm;
  }

  #area-impresion {
    display: block !important;
    color: #000;
    font-size: 10.5pt;
  }

  /* Evita cortes feos */
  .factura__tabla thead { display: table-header-group; }
  .factura__tabla tr    { break-inside: avoid; }
  .factura__totales     { break-inside: avoid; }

  a[href]::after { content: ""; }      /* no imprimas las URLs */
}
```

```js
function imprimirFactura(id) {
  const factura = store.getEstado().facturas.find(f => f.id === id);
  document.querySelector('#area-impresion').innerHTML = plantillaFactura(factura, estado);
  window.print();   // el usuario elige "Guardar como PDF"
}
```

Si más adelante necesitas generar el PDF sin diálogo (envío automático por correo, por ejemplo), ahí sí trae `pdf-lib` vía CDN. Antes no.

**En la plantilla incluye:** tus datos y NIT, los del cliente, número y fechas, tabla de ítems, desglose de impuestos línea por línea, total en letras si facturas formalmente en Colombia, métodos de pago (Nequi y PayPal con sus datos) y — si la factura está en moneda extranjera — la tasa usada y su fuente.

---

## 11. CSS: tokens y estructura

`css/tokens.css`

```css
:root {
  /* Escala tipográfica: una razón, no números al azar */
  --texto-xs:  0.75rem;
  --texto-sm:  0.875rem;
  --texto-base: 1rem;
  --texto-lg:  1.25rem;
  --texto-xl:  1.75rem;

  /* Espaciado en múltiplos de 4 */
  --e-1: 0.25rem; --e-2: 0.5rem; --e-3: 0.75rem;
  --e-4: 1rem;    --e-6: 1.5rem; --e-8: 2rem; --e-12: 3rem;

  --radio: 6px;
  --borde: 1px solid var(--linea);

  /* Semánticos, no "azul1/azul2" */
  --fondo:        #fbfbfa;
  --superficie:   #ffffff;
  --linea:        #e4e4e0;
  --texto:        #1c1c1a;
  --texto-suave:  #6b6b66;
  --acento:       #2d5f8a;

  --exito:  #2e7d52;
  --aviso:  #b8860b;
  --peligro:#b3401f;

  --num: 'SF Mono', 'Cascadia Code', ui-monospace, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #161614; --superficie: #201f1d; --linea: #34332f;
    --texto: #ebe9e4; --texto-suave: #9a978f;
  }
}
```

**Detalle que importa en una app de dinero:** todas las cifras alineadas a la derecha, con fuente monoespaciada y `font-variant-numeric: tabular-nums`. Cuando los dígitos ocupan el mismo ancho, escanear una columna de totales es instantáneo.

```css
.num {
  text-align: right;
  font-family: var(--num);
  font-variant-numeric: tabular-nums;
}
.num--negativo { color: var(--peligro); }
```

Layout base con grid:

```css
.app {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}
@media (max-width: 768px) {
  .app { grid-template-columns: 1fr; }
  .barra-lateral { position: fixed; inset: 0 auto 0 0; transform: translateX(-100%); }
  .barra-lateral[data-abierta] { transform: none; }
}
```

Y el piso de calidad, sin negociar: foco visible con teclado (`:focus-visible`), `prefers-reduced-motion` respetado, contraste AA en texto sobre fondo, y toda acción alcanzable con Tab.

---

## 12. Ruta de construcción por fases

Construye vertical, no horizontal. Termina un flujo completo antes de empezar el siguiente.

**Fase 1 — Esqueleto (2–3 sesiones)**
`index.html` + tokens + store + db + router. Una sola vista que muestre "Hola". Verifica que el estado sobrevive a un F5.

**Fase 2 — Clientes y proyectos**
CRUD completo con modal y validación. Aquí resuelves el patrón de formularios que reutilizarás en todo lo demás.

**Fase 3 — Registro de horas**
Entrada manual primero (más simple), cronómetro después. Vista de calendario semanal con totales por día.

**Fase 4 — Facturas en una sola moneda**
Borrador → ítems → emitir → imprimir. Sin FX todavía. Cierra el ciclo completo.

**Fase 5 — Multi-moneda**
Ahora sí `fx.js`, snapshot de tasas, totales en moneda base, edición manual de tasa.

**Fase 6 — Cobros y alertas**
Pagos parciales, estados vencidos, dashboard con "te deben X", "vence en 3 días".

**Fase 7 — Pulido**
Exportar/importar respaldo, atajos de teclado, estados vacíos con buena copy, dark mode, PWA.

---

## 13. Trampas que te van a morder

| Trampa | Síntoma | Solución |
|---|---|---|
| Float para dinero | El total muestra `59.97000000000001` | Enteros en centavos, siempre |
| Recalcular totales al renderizar | Facturas viejas cambian de monto | Congela `totales` al emitir |
| Recalcular FX al renderizar | Ingresos históricos bailan a diario | Snapshot de tasa en la factura |
| `setInterval` acumulativo | El cronómetro pierde tiempo en segundo plano | Calcula contra `Date.now()` |
| `toISOString()` para el día | Las horas de la noche caen al día siguiente | Ajusta por `getTimezoneOffset()` |
| Consecutivo al crear borrador | Huecos en la numeración | Asigna al emitir |
| Facturar dos veces las mismas horas | Cobras de más y el cliente reclama | Campo `facturaId` en cada registro |
| Sin migraciones de esquema | Agregas un campo y la app truena con datos viejos | `schemaVersion` desde el día 1 |
| `innerHTML` con datos del usuario | Un nombre de cliente con `<script>` | Escapa por defecto en `html\`\`` |
| Un `localStorage.setItem` por tecla | Lag al escribir en formularios | Debounce de 300ms |
| Sin exportar respaldo | El usuario limpia el navegador y pierde un año | Botón visible + recordatorio |

---

## 14. Pruebas sin framework

Como `domain/` es puro, puedes probarlo con un HTML aparte:

```html
<!-- test.html -->
<script type="module">
import { parsear, formatear, porcentaje, repartir } from './js/domain/money.js';

const pruebas = [];
const test = (nombre, fn) => pruebas.push({ nombre, fn });
const igual = (a, b) => { if (a !== b) throw new Error(`esperaba ${b}, obtuve ${a}`); };

test('parsea formato colombiano', () => igual(parsear('85.000,50', 'COP'), 8500050));
test('parsea formato inglés',     () => igual(parsear('85,000.50', 'USD'), 8500050));
test('IVA del 19%',               () => igual(porcentaje(100000, 19), 19000));
test('reparte sin perder centavos', () => {
  const p = repartir(1000, [1,1,1]);
  igual(p.reduce((a,b)=>a+b,0), 1000);
});

const salida = pruebas.map(({nombre, fn}) => {
  try { fn(); return `✅ ${nombre}`; }
  catch (e) { return `❌ ${nombre} — ${e.message}`; }
});
document.body.innerHTML = '<pre>' + salida.join('\n') + '</pre>';
</script>
```

Los casos de `money.js`, `tax.js` y `time.js` son los que de verdad te salvan. Escribe una prueba cada vez que encuentres un bug: así no vuelve.

---

## 15. Lo que hace que este proyecto se vea profesional

No es la cantidad de funciones. Es:

1. **El README explica decisiones, no features.** "Guardo dinero como enteros porque…" vale más que "App de facturación con clientes y proyectos".
2. **Los estados vacíos tienen copy útil.** "Aún no tienes clientes → Agrega el primero para empezar a registrar horas", no "No hay datos".
3. **Los errores dicen qué hacer.** "No se puede eliminar: tiene horas facturadas. Ciérralo en su lugar" en vez de "Error".
4. **La lógica de negocio está separada del DOM** y tiene pruebas.
5. **El esquema está versionado** desde el primer commit.
6. **Funciona con teclado** de principio a fin.

Con esas seis cosas, un panel de facturación bien hecho pesa más en un portafolio que tres proyectos con más pantallas y menos criterio.
