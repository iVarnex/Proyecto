# Panel de facturación freelance multi-moneda

Vanilla HTML/CSS/JS (ES Modules nativos, sin build ni npm) para clientes → proyectos → horas → facturas → cobros. Construido siguiendo `panel-facturacion-guia.md`.

Este README explica **decisiones**, no funciones — para eso está el código, que se explica solo.

## Por qué

**Dinero como enteros en centavos, nunca float.** `0.1 + 0.2 !== 0.3` y ese error se acumula factura tras factura hasta que los totales dejan de cuadrar. `js/domain/money.js` guarda todo en la unidad mínima de cada moneda (2 decimales para COP/USD, 0 para JPY/CLP) y multiplica horas × tarifa con redondeo bancario (half-to-even) para no sesgar el total hacia arriba cuando se reparte sobre muchas líneas.

**Borrador = calculado en vivo. Emitido = congelado.** Una factura emitida es un documento histórico: si el cliente sube su tarifa en marzo, la factura de enero no puede cambiar. Por eso `totales`, `impuestos` y la tasa de cambio (`fx`) se guardan dentro de la factura en el momento de emitir (`domain/invoice.js:emitirFactura`) en vez de recalcularse en cada render. Un borrador, en cambio, no tiene `totales` guardados: `totalesDe()` los calcula al vuelo cada vez.

**El consecutivo se asigna al emitir, no al crear el borrador.** Si se asignara al crear, borradores descartados dejarían huecos en la numeración — un problema real en Colombia, donde la DIAN espera consecutivos sin saltos.

**El cronómetro no usa `setInterval` para acumular tiempo.** El navegador estrangula los intervalos en pestañas en segundo plano y se pierden minutos. La verdad son los timestamps (`inicioTs` + `pausas`); el intervalo en `views/horas.js` solo repinta un nodo cada segundo, calculando siempre contra `Date.now()`.

**Fechas en día local, no UTC.** `new Date().toISOString().slice(0,10)` da el día equivocado después de las 7 p.m. en Colombia (UTC-5). `hoyLocal()` ajusta por el offset del navegador antes de convertir.

**`domain/` no toca `document`, `window` ni `localStorage`.** Es la parte del código que de verdad importa que esté bien — cálculo de totales, impuestos, numeración, duraciones — y se puede probar desde `test.html` sin abrir un navegador de verdad ni escribir mocks. La fecha/hora actual siempre entra por parámetro.

**Un solo `click` delegado en `#app`, no un listener por fila.** Cada acción vive en `data-accion` + un mapa `acciones` armado en `main.js` a partir de lo que exporta cada vista. Así una vista se puede re-renderizar entera (por ejemplo, tras guardar un cliente) sin dejar listeners huérfanos.

**Dos hooks de ciclo de vida por ruta, no uno.** `alMontar` corre una sola vez al entrar a la ruta (por ejemplo, abrir el modal de edición cuando la URL trae `#/clientes/:id`). `alActualizar` corre después de *cada* render de esa ruta — incluidos los que dispara el propio store — porque hay DOM que se recrea en cada render y necesita que sus listeners se vuelvan a enlazar (los campos editables de una factura borrador, los formularios de Ajustes).

**Los impuestos son configurables, no hardcodeados.** IVA, ReteFuente y ReteICA cambian según el régimen, si eres declarante, el municipio y si exportas servicios. La app calcula lo que se le diga en Ajustes; no decide por ti. Los porcentajes por defecto (19 % / 11 % / 6,9‰) son el caso común de servicios en Colombia y **hay que validarlos con un contador** antes de facturar de verdad.

**Las retenciones restan y se calculan sobre la base, no sobre base + IVA.** El cliente las paga a la DIAN en tu nombre; por eso el orden en `calcularTotales` es fijo: subtotal → descuento → IVA sobre la base → retenciones sobre la base → total.

**`html\`\`` devuelve un objeto, no un string.** Anidar una llamada a `html` dentro de otra (`${cond ? html\`<b>x</b>\` : ''}`) sin envolverla en un array la escapaba dos veces — el navegador mostraba literalmente `&lt;b&gt;x&lt;/b&gt;` como texto en vez de negrita. Pasaba en varias vistas (los ítems y totales de una factura, el aviso de "sin respaldo" en Ajustes) porque es el patrón obvio de escribir un condicional. `html\`\`` ahora devuelve `{ __raw, valor, toString() }`: el propio motor lo reconoce como marcado ya renderizado, y el `toString()` mantiene todo lo demás (`montar`, `.join('')` dentro de un `.map()`) funcionando sin tocar una sola vista.

**`#app` no lleva `aria-live`.** Cualquier mutación del store re-renderiza la vista activa entera (ver más arriba), así que marcar `#app` como región viva haría que un lector de pantalla reanunciara toda la página en cada clic — inusable. En su lugar, cada navegación mueve el foco a mano a `#app` (`main.js`), y el botón "Saltar al contenido" **no** es un `<a href="#app">`: el hash es el estado del router, y ese `href` se interpretaría como una ruta inexistente.

**El CSV de facturas escapa fórmulas.** Un nombre de cliente o un número de factura que empiece por `=`, `+`, `-` o `@` es una fórmula para Excel aunque la celda venga entre comillas — se le antepone un `'`. Mismo patrón que ya usa `riego-inteligente/` para su propio CSV.

**Las animaciones del dashboard no usan ninguna librería.** El conteo ascendente de las tarjetas KPI y el crecimiento de las barras son `requestAnimationFrame` puro — nada de Chart.js ni GSAP. Las barras se pintan en 0% en el HTML y se les pone el valor real un frame después (`js/ui/graficos.js`), porque una transición CSS no anima un valor que ya nace en su tamaño final. Todo se desactiva solo si el sistema pide `prefers-reduced-motion`.

**La búsqueda de las tablas no pasa por el store.** Filtrar clientes, proyectos o facturas es puramente visual (`js/ui/filtro.js` oculta/muestra `<tr>` por texto), no una mutación de negocio. Si pasara por el store, cada tecla dispararía un re-render completo que recrearía el propio campo de búsqueda y le haría perder el foco a media palabra.

## Dos cosas que la guía no contempla

1. **ES Modules nativos no cargan sobre `file://`.** El navegador bloquea el `import` entre módulos por CORS aunque todo esté en el mismo disco. Hay que servir la carpeta con un servidor local — no es opcional como sugiere la sección 0 de la guía ("Abres `index.html` y funciona"). Ver más abajo.

2. **El parseo de un solo separador ambiguo.** La guía resuelve `"1.234"` asumiendo siempre 2 decimales, lo que da 12,34 en vez de 1.234 — un error de 1000× al cobrar. `js/domain/money.js:normalizarSeparadorUnico` decide por la cantidad de dígitos después del separador: exactamente 3 (y una parte entera que no sea `"0"`) es agrupación de miles, cualquier otra cosa es decimal. Cubierto en `test.html`.

## Cómo correrlo

No hay `package.json`, build, ni bundler — pero **sí hace falta un servidor local**, por el punto 1 de arriba:

```
python -m http.server 8000
```

y abrir `http://localhost:8000/`. Cualquier servidor estático sirve (Live Server de VS Code, `npx serve`, etc.); lo único que no funciona es abrir `index.html` con doble clic.

## Cargar datos de ejemplo

`data/seed.json` es un respaldo válido (mismo esquema que exporta la app). La forma más rápida es Ajustes → **Modo de prueba** → Cargar datos de demostración: pide `data/seed.json` por `fetch()` y lo carga directo, sin pasar por el selector de archivos del sistema operativo (pensado para quien visita la demo desplegada y no tiene el repositorio clonado en su disco). El botón de siempre —Ajustes → Importar respaldo → seleccionar `data/seed.json`— sigue funcionando igual. Trae 5 clientes, 6 proyectos, facturas emitidas con pagos parciales y un borrador en USD con tasa de cambio manual.

## Verificar

No hay suite automatizada de CI. Para comprobar un cambio:

1. `python -m http.server 8000` y abrir la consola del navegador: cero errores al cargar cualquier vista.
2. Abrir `test.html` con el mismo servidor: todas las pruebas de `domain/` en verde.
3. Ajustes → Modo de prueba → Cargar datos de demostración (o importar `data/seed.json` a mano) y recorrer el flujo: crear cliente → proyecto → registrar horas (manual y con cronómetro) → facturar horas sin facturar → emitir → registrar un pago → imprimir (Ctrl+P, verificar que solo se ve la factura).
4. Recargar la página (F5): el estado sobrevive porque vive en `localStorage`.
5. Exportar un respaldo desde Ajustes y volver a importarlo: los datos deben quedar idénticos. Exportar CSV desde Facturas y abrirlo en Excel/Sheets: tildes correctas, sin fórmulas activadas por error.
6. Navegar el flujo completo solo con teclado (Tab/Shift+Tab/Escape/el botón "Saltar al contenido"), incluidos los modales.

## Qué falta a propósito

- **Total en letras** en la factura impresa (común en facturación formal en Colombia): no implementado. Es una función de conversión número→texto en español que no aporta al objetivo pedagógico del proyecto (la lógica de dinero e impuestos) y se puede agregar después sin tocar el resto.
- **Vista de detalle de cliente** separada: `#/clientes/:id` reutiliza la lista y abre el formulario de edición en vez de una pantalla nueva, para no salirse de los 7 archivos de `views/` que define la guía.
- **PWA / `manifest.json`**: mencionado como opcional en la guía: no agregado.

## Equipo

Juan Gutiérrez, Camilo Escobar, Sebastian Vasquez y Juan Serrano.
