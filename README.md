# Proyectos — Juan Gutiérrez & Camilo Escobar

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build-none-lightgrey?style=flat-square)
![Dependencies](https://img.shields.io/badge/dependencies-0-success?style=flat-square)

Dos aplicaciones web independientes construidas con HTML, CSS y JavaScript puro — sin frameworks, sin bundlers y (salvo una excepción puntual) sin dependencias externas. Cada proyecto vive en su propia carpeta, con su propio historial de decisiones y su propia forma de ejecutarse.

| Proyecto | Descripción | Demo |
|---|---|---|
| [**Sistema de Riego Inteligente**](#sistema-de-riego-inteligente) | Tablero de control para riego automatizado, con un motor de reglas determinista para diagnóstico | [Ver](https://riego-inteligente-mu.vercel.app) |
| [**Panel de Facturación**](#panel-de-facturación) | Facturación freelance multi-moneda, con impuestos colombianos configurables | [Ver](https://panel-facturacion-lyart.vercel.app) |

---

## Sistema de Riego Inteligente

Tablero de control web para un sistema de riego automatizado: sensores de humedad y temperatura, actuador de bomba y conectividad WiFi. La telemetría se simula en el navegador; el diagnóstico corre sobre un **motor de reglas determinista**, no un modelo de lenguaje ni machine learning — cada recomendación es trazable a una regla explícita y su justificación.

**Demo en vivo:** [riego-inteligente-mu.vercel.app](https://riego-inteligente-mu.vercel.app)

**Funcionalidad**

- Cinco escenarios simulados (normal, ola de calor, lluvia, fuga en el tanque, falla de sensor)
- Riego automático con histéresis sobre el umbral configurado, para evitar que la bomba oscile
- Bitácora de eventos, gráfico de series de tiempo y exportación a CSV/JSON/HTML
- Paleta de comandos (`Ctrl+K`) y navegación completa por teclado
- Tema claro/oscuro según preferencia del sistema

**Stack:** HTML5 · CSS3 (custom properties) · JavaScript (scripts clásicos, sin módulos) · [Chart.js](https://www.chartjs.org/) vía CDN — única dependencia externa del repositorio.

**Ejecutar:** abrir `riego-inteligente/index.html` con Live Server, o servir la carpeta:

```bash
cd riego-inteligente
python -m http.server 8000
```

---

## Panel de Facturación

Panel de facturación para freelancers con soporte multi-moneda: clientes, proyectos, registro de horas (entrada manual y cronómetro), facturas con impuestos configurables (IVA, retención en la fuente, ReteICA) y cobros. El dinero se maneja siempre como enteros en la unidad mínima de cada moneda — nunca en punto flotante — y una factura emitida congela sus totales, impuestos y tasa de cambio como un documento histórico.

**Demo en vivo:** [panel-facturacion-lyart.vercel.app](https://panel-facturacion-lyart.vercel.app)

**Funcionalidad**

- Ciclo completo: cliente → proyecto → horas → factura → cobro
- Facturación multi-moneda con snapshot de tasa de cambio al emitir
- Dashboard con métricas animadas, gráfico de ingresos y actividad reciente
- Exportación a PDF (impresión) y CSV, con respaldo/restauración del estado completo
- Búsqueda instantánea, atajos de teclado y modo oscuro automático

**Stack:** HTML5 · CSS3 · JavaScript (ES Modules nativos) · `localStorage` con esquema versionado — cero dependencias externas.

**Ejecutar:** los ES Modules no cargan sobre `file://`, así que hace falta un servidor local:

```bash
cd panel-facturacion
python -m http.server 8000
```

Documentación técnica y decisiones de diseño: [`panel-facturacion/README.md`](panel-facturacion/README.md)

---

## Filosofía técnica

Ambos proyectos comparten los mismos principios, aplicados de forma independiente:

- **Sin build ni dependencias de npm** — se abren y editan sin instalar nada.
- **Lógica de negocio separada de la interfaz** — testeable sin navegador.
- **Accesibilidad como requisito, no como extra** — teclado, `aria-live`, foco gestionado.
- **Explicabilidad sobre "magia"** — nada de heurísticas opacas: cada decisión del sistema se puede rastrear hasta el código que la tomó.

## Equipo

**Juan Gutiérrez** y **Camilo Escobar** — desarrolladores.
