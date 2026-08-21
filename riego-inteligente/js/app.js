'use strict';

/* ==========================================================
   Sistema de Riego Inteligente — tablero de control
   ----------------------------------------------------------
   Los datos son simulados. Para conectar el hardware real
   (ESP32 programado en Wokwi), sustituye `simulateTick()` por
   un WebSocket o un fetch periódico al endpoint del dispositivo
   y alimenta `applyReading()` con la telemetría recibida.
   ========================================================== */

const STORAGE_KEY = 'riego-inteligente:v2';
const BASE_TICK_MS = 2000;
const HISTORY_LIMIT = 240;
const LOG_LIMIT = 120;
const HYSTERESIS = 5;

/* ==========================================================
   1. Utilidades
   ========================================================== */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const todayKey = () => new Date().toISOString().slice(0, 10);
const timeLabel = (d) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Bloque Unicode de marcas diacriticas combinantes (U+0300 a U+036F).
 *  NFD las separa de la letra base y este patron las elimina. */
const DIACRITICS = new RegExp(String.fromCharCode(0x5B, 0x5C, 0x75) + "0300-" + String.fromCharCode(0x5C, 0x75) + "036f" + String.fromCharCode(0x5D), "g");

/** Normaliza texto para busquedas: minusculas y sin acentos. */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(DIACRITICS, '');

/** Descarga un contenido como archivo. */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Convierte filas a CSV con comillas escapadas. */
const toCsv = (rows) =>
  rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

/* ==========================================================
   2. Notificaciones apilables
   ========================================================== */

const Toast = {
  stack: $('toastStack'),
  icons: { good: '✓', info: 'ℹ', warning: '⚠', critical: '✕' },

  show(message, type = 'info', ms = 4000) {
    const node = document.createElement('div');
    node.className = `toast toast--${type}`;
    node.setAttribute('role', type === 'critical' ? 'alert' : 'status');
    node.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${this.icons[type]}</span>
      <span class="toast-msg">${escapeHtml(message)}</span>
      <button class="toast-close" type="button" aria-label="Cerrar aviso">✕</button>`;

    const dismiss = () => {
      node.classList.add('is-leaving');
      node.addEventListener('animationend', () => node.remove(), { once: true });
    };
    node.querySelector('.toast-close').addEventListener('click', dismiss);
    this.stack.appendChild(node);
    if (ms) setTimeout(dismiss, ms);
  },
};

/* ==========================================================
   3. Estado y persistencia
   ========================================================== */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const saved = loadState();
const isFreshDay = !saved || saved.stats?.dateKey !== todayKey();

const state = {
  /* preferencias persistidas */
  theme: saved?.theme ?? null,
  mode: saved?.mode ?? 'auto',
  threshold: saved?.threshold ?? 35,
  pumpManual: saved?.pumpManual ?? false,
  chartRange: saved?.chartRange ?? 60,
  assistantOpen: saved?.assistantOpen ?? true,

  /* telemetría */
  soil: 42,
  temp: 24,
  humidity: 55,
  tank: 80,
  lastGoodSoil: 42,

  /* actuadores y banderas */
  pumpOn: false,
  autoIrrigating: false,
  tankAlerted: false,
  sensorFault: false,

  /* simulación */
  running: true,
  speed: 1,
  scenario: 'normal',

  /* datos */
  history: saved?.history ?? [],
  log: saved?.log ?? [],
  stats: isFreshDay
    ? { dateKey: todayKey(), irrigations: 0, pumpMinutes: 0, waterSaved: 0 }
    : saved.stats,

  /* vista */
  showTable: false,
  logQuery: '',
  logFilter: 'all',
};

if (state.history.length) {
  const last = state.history[state.history.length - 1];
  state.soil = last.soil ?? state.soil;
  state.temp = last.temp ?? state.temp;
  state.humidity = last.humidity ?? state.humidity;
  state.tank = last.tank ?? state.tank;
  state.lastGoodSoil = state.soil;
}

function saveState() {
  const payload = {
    theme: state.theme,
    mode: state.mode,
    threshold: state.threshold,
    pumpManual: state.pumpManual,
    chartRange: state.chartRange,
    assistantOpen: state.assistantOpen,
    history: state.history,
    log: state.log,
    stats: state.stats,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* almacenamiento lleno o no disponible: se continúa solo en memoria */
  }
}

/* ==========================================================
   4. Tema
   ========================================================== */

function applyTheme() {
  const root = document.documentElement;
  if (state.theme) {
    root.setAttribute('data-theme', state.theme);
  } else {
    root.removeAttribute('data-theme');
  }
  $('themeToggle').setAttribute('aria-pressed', String(state.theme === 'dark'));
}

function toggleTheme() {
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = state.theme ? state.theme === 'dark' : prefersDark;
  state.theme = isDark ? 'light' : 'dark';
  applyTheme();
  restyleChart();
  drawSparkline();
  saveState();
  Toast.show(`Tema ${state.theme === 'dark' ? 'oscuro' : 'claro'} activado`, 'info', 2000);
}

applyTheme();

/* ==========================================================
   5. Diálogos accesibles (modal genérico)
   ========================================================== */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

function openDialog(overlay, focusTarget) {
  lastFocused = document.activeElement;
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  (focusTarget || overlay.querySelector(FOCUSABLE))?.focus();
  overlay._trap = (e) => trapFocus(e, overlay);
  document.addEventListener('keydown', overlay._trap, true);
}

function closeDialog(overlay) {
  overlay.hidden = true;
  if (!$$('.modal-overlay:not([hidden]), .palette-overlay:not([hidden])').length) {
    document.body.classList.remove('modal-open');
  }
  document.removeEventListener('keydown', overlay._trap, true);
  lastFocused?.focus();
}

function trapFocus(e, overlay) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDialog(overlay);
    return;
  }
  if (e.key !== 'Tab') return;
  const items = $$(FOCUSABLE, overlay).filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const [first, last] = [items[0], items[items.length - 1]];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* cerrar al pulsar sobre el fondo */
$$('.modal-overlay').forEach((ov) => {
  ov.addEventListener('mousedown', (e) => {
    if (e.target === ov) closeDialog(ov);
  });
});

$('aboutToggle').addEventListener('click', () => openDialog($('aboutModal'), $('aboutClose')));
$('aboutClose').addEventListener('click', () => closeDialog($('aboutModal')));
$('shortcutsClose').addEventListener('click', () => closeDialog($('shortcutsModal')));

$('resetLocalData').addEventListener('click', () => {
  if (confirm('¿Borrar toda la configuración, bitácora y estadísticas guardadas en este navegador?')) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
});

/* ==========================================================
   6. Controles del sistema (acciones reutilizables)
   ========================================================== */

function setMode(mode, announce = true) {
  state.mode = mode;
  const isAuto = mode === 'auto';
  $('modeAuto').classList.toggle('is-active', isAuto);
  $('modeAuto').setAttribute('aria-checked', String(isAuto));
  $('modeManual').classList.toggle('is-active', !isAuto);
  $('modeManual').setAttribute('aria-checked', String(!isAuto));
  $('pumpToggle').disabled = isAuto;
  $('pumpHint').textContent = isAuto ? 'Controlada automáticamente' : 'Control manual activo';
  if (!isAuto) state.pumpOn = state.pumpManual;
  renderPump();
  saveState();
  if (announce) Toast.show(`Modo ${isAuto ? 'automático' : 'manual'} activado`, 'info', 2000);
}

function setPump(on) {
  if (state.mode !== 'manual') {
    Toast.show('Cambia a modo manual para controlar la bomba', 'warning');
    return;
  }
  state.pumpManual = on;
  state.pumpOn = on;
  renderPump();
  logEvent(on ? 'Bomba encendida manualmente' : 'Bomba apagada manualmente', 'good');
  saveState();
}

function setThreshold(value, announce = false) {
  state.threshold = clamp(Math.round(value), 10, 70);
  $('thresholdSlider').value = String(state.threshold);
  $('thresholdValue').textContent = `${state.threshold}%`;
  refreshChartData();
  saveState();
  if (announce) Toast.show(`Umbral fijado en ${state.threshold}%`, 'info', 2000);
}

function refillTank() {
  state.tank = 100;
  state.tankAlerted = false;
  if (state.scenario === 'leak') setScenario('normal');
  renderSensors();
  logEvent('Tanque recargado al 100%', 'good');
  Toast.show('Tanque recargado', 'good', 2500);
  saveState();
}

/* ---------- simulación ---------- */

let timer = null;

function scheduleTick() {
  clearInterval(timer);
  if (state.running) timer = setInterval(simulateTick, BASE_TICK_MS / state.speed);
}

function setRunning(run) {
  state.running = run;
  $('playPause').setAttribute('aria-pressed', String(run));
  $('playPauseIcon').textContent = run ? '⏸' : '▶';
  $('playPauseLabel').textContent = run ? 'Pausar' : 'Reanudar';
  $('connStatus').className = `badge ${run ? 'badge--warning' : 'badge--critical'}`;
  $('connStatus').lastChild.textContent = run ? ' Simulación activa' : ' Simulación en pausa';
  scheduleTick();
}

function setSpeed(mult) {
  state.speed = mult;
  $$('[data-speed]').forEach((b) => {
    const on = Number(b.dataset.speed) === mult;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
  scheduleTick();
}

/* ---------- escenarios ---------- */

const SCENARIOS = {
  normal: { label: 'Normal', soilDrain: 1, tankDrain: 0, sensorFault: false },
  heat:   { label: 'Ola de calor', soilDrain: 2.6, tempTarget: 36, humidityTarget: 20, sensorFault: false },
  rain:   { label: 'Lluvia', soilDrain: -1.8, tempTarget: 16, humidityTarget: 92, sensorFault: false },
  leak:   { label: 'Fuga en tanque', soilDrain: 1, tankDrain: 1.4, sensorFault: false },
  fault:  { label: 'Falla de sensor', soilDrain: 1, sensorFault: true },
};

function setScenario(key, announce = true) {
  state.scenario = key;
  const sc = SCENARIOS[key];
  state.sensorFault = !!sc.sensorFault;

  $$('[data-scenario]').forEach((b) => {
    const on = b.dataset.scenario === key;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });

  if (key !== 'normal') {
    logEvent(`Escenario aplicado: ${sc.label}`, key === 'fault' || key === 'leak' ? 'critical' : 'warning');
  }
  if (announce) {
    Toast.show(`Escenario: ${sc.label}`, key === 'normal' ? 'info' : 'warning', 3000);
  }
  renderSensors();
  runAssistant();
}

/* ==========================================================
   7. Bitácora
   ========================================================== */

const STATUS_LABEL = { good: 'OK', warning: 'Atención', critical: 'Crítico', info: 'Info' };

function logEvent(text, status) {
  state.log.unshift({ time: new Date().toISOString(), event: text, status });
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
  renderLog();
}

function visibleLog() {
  const q = norm(state.logQuery);
  return state.log.filter((e) => {
    if (state.logFilter !== 'all' && e.status !== state.logFilter) return false;
    return !q || norm(e.event).includes(q);
  });
}

function renderLog() {
  const rows = visibleLog();
  $('logCount').textContent = state.log.length;

  if (!rows.length) {
    $('logBody').innerHTML = `<tr class="empty-row"><td colspan="3">${
      state.log.length ? 'Ningún registro coincide con el filtro.' : 'Sin eventos registrados todavía.'
    }</td></tr>`;
    return;
  }

  $('logBody').innerHTML = rows.map((e) => `
    <tr>
      <td class="col-time">${timeLabel(new Date(e.time))}</td>
      <td>${escapeHtml(e.event)}</td>
      <td><span class="row-badge row-badge--${e.status}">${STATUS_LABEL[e.status] || e.status}</span></td>
    </tr>`).join('');
}

$('logFilter').addEventListener('input', (e) => {
  state.logQuery = e.target.value;
  renderLog();
});

$$('[data-logfilter]').forEach((b) => b.addEventListener('click', () => {
  state.logFilter = b.dataset.logfilter;
  $$('[data-logfilter]').forEach((x) => {
    const on = x === b;
    x.classList.toggle('is-active', on);
    x.setAttribute('aria-checked', String(on));
  });
  renderLog();
}));

$('clearLog').addEventListener('click', () => {
  if (!state.log.length) return;
  if (!confirm('¿Vaciar la bitácora de eventos?')) return;
  state.log = [];
  renderLog();
  saveState();
  Toast.show('Bitácora vaciada', 'info', 2000);
});

/* ==========================================================
   8. Exportación
   ========================================================== */

const EXPORTERS = {
  'log-csv': () => {
    download(`bitacora-riego-${todayKey()}.csv`, toCsv([
      ['Hora', 'Evento', 'Estado'],
      ...state.log.map((e) => [new Date(e.time).toLocaleString('es'), e.event, STATUS_LABEL[e.status]]),
    ]), 'text/csv');
    Toast.show('Bitácora exportada en CSV', 'good');
  },

  'telemetry-csv': () => {
    download(`telemetria-riego-${todayKey()}.csv`, toCsv([
      ['Marca de tiempo', 'Humedad suelo (%)', 'Temperatura (C)', 'Humedad ambiente (%)', 'Tanque (%)', 'Umbral (%)'],
      ...state.history.map((p) => [
        new Date(p.t).toLocaleString('es'),
        p.soil?.toFixed(1), p.temp?.toFixed(1), p.humidity?.toFixed(1), p.tank?.toFixed(1), state.threshold,
      ]),
    ]), 'text/csv');
    Toast.show('Telemetría exportada en CSV', 'good');
  },

  json: () => {
    download(`proyecto-riego-${todayKey()}.json`, JSON.stringify({
      proyecto: 'Sistema de Riego Inteligente',
      equipo: ['Juan Gutiérrez', 'Camilo Escobar'],
      exportado: new Date().toISOString(),
      configuracion: { modo: state.mode, umbral: state.threshold, escenario: state.scenario },
      estadisticas: state.stats,
      diagnostico: RiegoAssistant.evaluate(snapshot()),
      telemetria: state.history,
      bitacora: state.log,
    }, null, 2), 'application/json');
    Toast.show('Proyecto exportado en JSON', 'good');
  },

  report: () => {
    const diag = RiegoAssistant.evaluate(snapshot());
    const html = buildReport(diag);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      Toast.show('Informe abierto en una pestaña nueva', 'good');
    } else {
      download(`informe-riego-${todayKey()}.html`, html, 'text/html');
      Toast.show('Informe descargado (el navegador bloqueó la pestaña)', 'info', 5000);
    }
  },
};

function buildReport(diag) {
  const row = (a, b) => `<tr><th>${a}</th><td>${b}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe — Sistema de Riego Inteligente</title>
<style>
 body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#111;line-height:1.6}
 h1{font-size:24px;margin-bottom:4px} h2{font-size:16px;margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:6px}
 .meta{color:#666;font-size:13px;margin-top:0}
 table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}
 th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top}
 th{width:38%;color:#444;font-weight:600}
 .f{margin:10px 0;padding:10px 12px;border-left:3px solid #999;background:#fafafa}
 .critical{border-color:#d03b3b} .warning{border-color:#fab219} .info{border-color:#2a78d6} .good{border-color:#0ca30c}
 .f strong{display:block} .f span{font-size:13px;color:#555}
 footer{margin-top:40px;border-top:1px solid #ddd;padding-top:12px;font-size:12px;color:#666}
 @media print{body{margin:0}}
</style></head><body>
<h1>Sistema de Riego Inteligente</h1>
<p class="meta">Informe generado el ${new Date().toLocaleString('es')} · Juan Gutiérrez y Camilo Escobar</p>

<h2>1. Estado actual del sistema</h2>
<table>
${row('Índice de salud', `${diag.score} / 100`)}
${row('Humedad de suelo', `${state.soil.toFixed(1)} %`)}
${row('Temperatura', `${state.temp.toFixed(1)} °C`)}
${row('Humedad ambiente', `${state.humidity.toFixed(1)} %`)}
${row('Nivel del tanque', `${state.tank.toFixed(1)} %`)}
${row('Modo de operación', state.mode === 'auto' ? 'Automático' : 'Manual')}
${row('Umbral configurado', `${state.threshold} %`)}
${row('Estado de la bomba', state.pumpOn ? 'Encendida' : 'Apagada')}
${row('Escenario', SCENARIOS[state.scenario].label)}
</table>

<h2>2. Estadísticas del día</h2>
<table>
${row('Riegos activados', state.stats.irrigations)}
${row('Minutos de bomba', state.stats.pumpMinutes.toFixed(1))}
${row('Agua ahorrada estimada', `${Math.round(state.stats.waterSaved)} L`)}
${row('Lecturas registradas', state.history.length)}
</table>

<h2>3. Diagnóstico del asistente</h2>
<p style="font-size:13px;color:#666">Sistema experto determinista basado en reglas explícitas (no emplea aprendizaje automático).</p>
${diag.findings.map((f) => `<div class="f ${f.severity}"><strong>${escapeHtml(f.title)}</strong><span>${escapeHtml(f.detail)}</span></div>`).join('')}

<h2>4. Bitácora de eventos</h2>
<table><tr><th style="width:22%">Hora</th><th style="width:58%">Evento</th><th>Estado</th></tr>
${state.log.slice(0, 40).map((e) => `<tr><td>${timeLabel(new Date(e.time))}</td><td>${escapeHtml(e.event)}</td><td>${STATUS_LABEL[e.status]}</td></tr>`).join('')}
</table>

<footer>Proyecto STEM interdisciplinario · ODS 6 (Agua limpia y saneamiento) y ODS 12 (Producción y consumo responsables).</footer>
</body></html>`;
}

/* menú de exportación */
const exportMenu = $('exportMenu');
const exportBtn = $('exportBtn');

function closeExportMenu() {
  exportMenu.hidden = true;
  exportBtn.setAttribute('aria-expanded', 'false');
}

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = exportMenu.hidden;
  exportMenu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', String(open));
});

$$('[data-export]').forEach((b) => b.addEventListener('click', () => {
  closeExportMenu();
  EXPORTERS[b.dataset.export]?.();
}));

document.addEventListener('click', closeExportMenu);
exportMenu.addEventListener('click', (e) => e.stopPropagation());

/* ==========================================================
   9. Asistente de diagnóstico
   ========================================================== */

function snapshot() {
  return {
    soil: state.soil, temp: state.temp, humidity: state.humidity, tank: state.tank,
    threshold: state.threshold, mode: state.mode, pumpOn: state.pumpOn,
    sensorFault: state.sensorFault, stats: state.stats, history: state.history,
  };
}

const ASSISTANT_ACTIONS = {
  'refill-tank': refillTank,
  'set-mode-auto': () => setMode('auto'),
  'pump-off': () => { state.pumpManual = false; state.pumpOn = false; state.autoIrrigating = false; renderPump(); },
  'threshold-up': () => setThreshold(state.threshold + 5, true),
};

let lastCriticalIds = new Set();

function runAssistant() {
  const diag = RiegoAssistant.evaluate(snapshot());

  /* índice de salud */
  const tone = diag.score >= 80 ? 'good' : diag.score >= 50 ? 'warning' : 'critical';
  const word = diag.score >= 80 ? 'Óptima' : diag.score >= 50 ? 'Regular' : 'Crítica';
  $('healthScore').textContent = diag.score;
  $('healthWord').textContent = word;
  $('healthChip').dataset.tone = tone;
  $('healthRing').style.setProperty('--pct', `${diag.score}%`);

  /* tarjetas de hallazgos */
  $('assistantBody').innerHTML = diag.findings.map((f) => `
    <article class="finding finding--${f.severity}">
      <span class="finding-icon" aria-hidden="true">${Toast.icons[f.severity]}</span>
      <div class="finding-text">
        <strong>${escapeHtml(f.title)}</strong>
        <p>${escapeHtml(f.detail)}</p>
      </div>
      ${f.action ? `<button class="finding-action" type="button" data-action="${f.action.command}">${escapeHtml(f.action.label)}</button>` : ''}
    </article>`).join('');

  $$('[data-action]', $('assistantBody')).forEach((b) =>
    b.addEventListener('click', () => ASSISTANT_ACTIONS[b.dataset.action]?.()));

  /* avisa una sola vez por cada hallazgo crítico nuevo */
  const criticals = diag.findings.filter((f) => f.severity === 'critical');
  for (const f of criticals) {
    if (!lastCriticalIds.has(f.id)) Toast.show(f.title, 'critical', 6000);
  }
  lastCriticalIds = new Set(criticals.map((f) => f.id));
}

$('assistantToggle').addEventListener('click', () => {
  state.assistantOpen = !state.assistantOpen;
  $('assistantBody').hidden = !state.assistantOpen;
  $('assistantToggle').textContent = state.assistantOpen ? 'Ocultar' : 'Mostrar';
  $('assistantToggle').setAttribute('aria-expanded', String(state.assistantOpen));
  saveState();
});

/* ==========================================================
   10. Render de sensores y actuadores
   ========================================================== */

function paint(valueEl, statusEl, value, decimals, text, tone) {
  valueEl.textContent = value === null ? '--' : value.toFixed(decimals);
  statusEl.textContent = text;
  statusEl.className = `stat-sub is-${tone}`;
}

function renderSensors() {
  /* humedad de suelo (respeta la falla de sensor) */
  if (state.sensorFault) {
    paint($('soilValue'), $('soilStatus'), null, 0, 'Sensor sin señal', 'critical');
  } else {
    const tone = state.soil < 15 ? 'critical' : state.soil < state.threshold ? 'warning' : 'good';
    paint($('soilValue'), $('soilStatus'), state.soil, 0,
      tone === 'good' ? 'Nivel adecuado' : tone === 'warning' ? 'Por debajo del umbral' : 'Suelo muy seco', tone);
  }

  const tTone = (state.temp < 10 || state.temp > 34) ? 'critical' : (state.temp < 15 || state.temp > 30) ? 'warning' : 'good';
  paint($('tempValue'), $('tempStatus'), state.temp, 1,
    tTone === 'good' ? 'Rango normal' : tTone === 'warning' ? 'Fuera de rango ideal' : 'Temperatura extrema', tTone);

  const hTone = (state.humidity < 20 || state.humidity > 85) ? 'warning' : 'good';
  paint($('humidityValue'), $('humidityStatus'), state.humidity, 0,
    hTone === 'good' ? 'Rango normal' : 'Fuera de rango', hTone);

  const kTone = state.tank < 15 ? 'critical' : state.tank < 30 ? 'warning' : 'good';
  paint($('tankValue'), $('tankStatus'), state.tank, 0,
    kTone === 'good' ? 'Suministro suficiente' : kTone === 'warning' ? 'Nivel bajo' : 'Recarga urgente', kTone);

  drawSparkline();
}

function renderPump() {
  $('pumpToggle').setAttribute('aria-pressed', String(state.pumpOn));
  $('pumpToggleLabel').textContent = state.pumpOn ? 'Encendida' : 'Apagada';
}

function renderSummary() {
  $('irrigationsToday').textContent = state.stats.irrigations;
  $('pumpMinutesToday').textContent = state.stats.pumpMinutes.toFixed(1);
  $('waterSavedToday').textContent = Math.round(state.stats.waterSaved);
}

/* minigráfico dentro de la tarjeta de humedad */
function drawSparkline() {
  const cv = $('soilSpark');
  const pts = state.history.slice(-40).map((p) => p.soil).filter((v) => typeof v === 'number');
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth || 150;
  const h = 28;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (pts.length < 2) return;

  const min = Math.min(...pts, state.threshold) - 3;
  const max = Math.max(...pts, state.threshold) + 3;
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h - ((v - min) / (max - min)) * h;

  /* línea del umbral */
  ctx.strokeStyle = cssVar('--text-muted');
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y(state.threshold));
  ctx.lineTo(w, y(state.threshold));
  ctx.stroke();

  /* serie */
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cssVar('--series-1');
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

/* ==========================================================
   11. Gráfico principal (Chart.js)
   ========================================================== */

let chart;

function rangedHistory() {
  return state.chartRange === 'all' ? state.history : state.history.slice(-Number(state.chartRange));
}

function buildChart() {
  chart = new Chart($('moistureChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [
      {
        label: 'Humedad de suelo',
        data: [],
        borderColor: cssVar('--series-1'),
        backgroundColor: cssVar('--series-1-soft'),
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: cssVar('--series-1'),
        pointHoverBorderColor: cssVar('--surface-1'),
        pointHoverBorderWidth: 2,
        tension: 0.3, fill: true,
      },
      {
        label: 'Umbral mínimo',
        data: [],
        borderColor: cssVar('--text-muted'),
        borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false, tension: 0,
      },
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--surface-2'),
          titleColor: cssVar('--text-primary'),
          bodyColor: cssVar('--text-secondary'),
          borderColor: cssVar('--border'),
          borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: true,
          callbacks: { label: (i) => `${i.dataset.label}: ${i.formattedValue}%` },
        },
      },
      scales: {
        y: { min: 0, max: 100, grid: { color: cssVar('--gridline') },
             ticks: { color: cssVar('--text-muted'), callback: (v) => `${v}%` } },
        x: { grid: { display: false },
             ticks: { color: cssVar('--text-muted'), maxTicksLimit: 6, maxRotation: 0 } },
      },
    },
  });
}

function refreshChartData() {
  const pts = rangedHistory();
  if (chart) {
    chart.data.labels = pts.map((p) => timeLabel(new Date(p.t)));
    chart.data.datasets[0].data = pts.map((p) => p.soil);
    chart.data.datasets[1].data = pts.map(() => state.threshold);
    chart.update('none');
  }
  if (state.showTable) renderDataTable(pts);
  drawSparkline();
}

function restyleChart() {
  if (!chart) return;
  const d = chart.data.datasets;
  d[0].borderColor = cssVar('--series-1');
  d[0].backgroundColor = cssVar('--series-1-soft');
  d[0].pointHoverBackgroundColor = cssVar('--series-1');
  d[0].pointHoverBorderColor = cssVar('--surface-1');
  d[1].borderColor = cssVar('--text-muted');
  const tt = chart.options.plugins.tooltip;
  tt.backgroundColor = cssVar('--surface-2');
  tt.titleColor = cssVar('--text-primary');
  tt.bodyColor = cssVar('--text-secondary');
  tt.borderColor = cssVar('--border');
  chart.options.scales.y.grid.color = cssVar('--gridline');
  chart.options.scales.y.ticks.color = cssVar('--text-muted');
  chart.options.scales.x.ticks.color = cssVar('--text-muted');
  chart.update('none');
}

/* vista de tabla equivalente (requisito de accesibilidad) */
function renderDataTable(pts = rangedHistory()) {
  const rows = [...pts].reverse();
  $('dataBody').innerHTML = rows.length
    ? rows.map((p) => {
        const below = p.soil < state.threshold;
        return `<tr>
          <td class="col-time">${timeLabel(new Date(p.t))}</td>
          <td class="num">${p.soil?.toFixed(1) ?? '--'}%</td>
          <td class="num">${state.threshold}%</td>
          <td><span class="row-badge row-badge--${below ? 'warning' : 'good'}">${below ? 'Bajo umbral' : 'En rango'}</span></td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="4">Sin lecturas.</td></tr>';
}

function setView(showTable) {
  state.showTable = showTable;
  $('chartView').hidden = showTable;
  $('tableView').hidden = !showTable;
  $('viewToggle').textContent = showTable ? 'Ver gráfico' : 'Ver tabla';
  $('viewToggle').setAttribute('aria-pressed', String(showTable));
  if (showTable) renderDataTable();
}

$('viewToggle').addEventListener('click', () => setView(!state.showTable));

$$('[data-range]').forEach((b) => b.addEventListener('click', () => {
  state.chartRange = b.dataset.range === 'all' ? 'all' : Number(b.dataset.range);
  $$('[data-range]').forEach((x) => {
    const on = x === b;
    x.classList.toggle('is-active', on);
    x.setAttribute('aria-checked', String(on));
  });
  refreshChartData();
  saveState();
}));

/* ==========================================================
   12. Bucle de simulación
   ========================================================== */

function rolloverDay() {
  if (state.stats.dateKey !== todayKey()) {
    state.stats = { dateKey: todayKey(), irrigations: 0, pumpMinutes: 0, waterSaved: 0 };
    logEvent('Nuevo día: estadísticas reiniciadas', 'good');
  }
}

/** Acerca `value` a `target` de forma gradual. */
const drift = (value, target, rate) => value + (target - value) * rate;

function simulateTick() {
  rolloverDay();
  const sc = SCENARIOS[state.scenario];

  /* --- lógica de control --- */
  const wasIrrigating = state.autoIrrigating;

  if (state.mode === 'auto') {
    if (state.sensorFault) {
      state.autoIrrigating = false; // sin lectura fiable no se riega
    } else if (!state.autoIrrigating && state.soil < state.threshold) {
      state.autoIrrigating = true;
    } else if (state.autoIrrigating && state.soil >= state.threshold + HYSTERESIS) {
      state.autoIrrigating = false;
    }
    state.pumpOn = state.autoIrrigating;
  } else {
    state.pumpOn = state.pumpManual;
  }

  /* la bomba no puede trabajar sin agua */
  if (state.pumpOn && state.tank <= 0) {
    state.pumpOn = false;
    state.autoIrrigating = false;
    if (!state.tankAlerted) {
      state.tankAlerted = true;
      logEvent('Bomba detenida: tanque vacío', 'critical');
    }
  }

  if (state.mode === 'auto' && state.autoIrrigating && !wasIrrigating) {
    state.stats.irrigations += 1;
    state.stats.waterSaved += 1.5 + Math.random();
    logEvent('Riego automático activado (humedad bajo el umbral)', 'warning');
  } else if (state.mode === 'auto' && !state.autoIrrigating && wasIrrigating) {
    logEvent('Riego automático detenido (humedad recuperada)', 'good');
  }

  /* --- evolución física --- */
  if (state.pumpOn) {
    state.stats.pumpMinutes += BASE_TICK_MS / 60000;
    state.soil = clamp(state.soil + 2.2 + Math.random() * 1.2, 0, 100);
    state.tank = clamp(state.tank - 0.4 - Math.random() * 0.3, 0, 100);
  } else {
    state.soil = clamp(state.soil - (0.6 + Math.random() * 0.8) * sc.soilDrain, 0, 100);
  }

  if (sc.tankDrain) state.tank = clamp(state.tank - sc.tankDrain, 0, 100);

  state.temp = clamp(
    sc.tempTarget !== undefined
      ? drift(state.temp, sc.tempTarget, 0.12) + (Math.random() - 0.5) * 0.4
      : state.temp + (Math.random() - 0.5) * 0.8,
    5, 40);

  state.humidity = clamp(
    sc.humidityTarget !== undefined
      ? drift(state.humidity, sc.humidityTarget, 0.12) + (Math.random() - 0.5) * 1.5
      : state.humidity + (Math.random() - 0.5) * 3,
    10, 95);

  if (!state.sensorFault) state.lastGoodSoil = state.soil;

  /* --- alerta de tanque --- */
  if (state.tank < 10 && !state.tankAlerted) {
    state.tankAlerted = true;
    logEvent('Nivel del tanque crítico: se recomienda recargar', 'critical');
  } else if (state.tank > 20) {
    state.tankAlerted = false;
  }

  /* --- registro y render --- */
  state.history.push({
    t: new Date().toISOString(),
    soil: state.soil, temp: state.temp, humidity: state.humidity, tank: state.tank,
  });
  if (state.history.length > HISTORY_LIMIT) state.history.shift();

  refreshChartData();
  renderSensors();
  renderPump();
  renderSummary();
  updateAlert();
  runAssistant();
  saveState();
}

/* ==========================================================
   13. Banner de alerta
   ========================================================== */

let alertDismissed = false;

function updateAlert() {
  const low = !state.sensorFault && state.soil < state.threshold;
  if (low && !alertDismissed) {
    $('alertBanner').hidden = false;
    $('alertDetail').textContent = state.mode === 'auto'
      ? 'El sistema activó el riego automático.'
      : 'Considera activar la bomba manualmente.';
  } else if (!low) {
    $('alertBanner').hidden = true;
    alertDismissed = false;
  }
}

$('alertDismiss').addEventListener('click', () => {
  $('alertBanner').hidden = true;
  alertDismissed = true;
});

/* ==========================================================
   14. Paleta de comandos
   ========================================================== */

const COMMANDS = [
  { id: 'theme', label: 'Cambiar tema claro/oscuro', hint: 'T', keys: 'tema color oscuro claro', run: toggleTheme },
  { id: 'auto', label: 'Modo automático', hint: 'A', keys: 'modo automatico auto', run: () => setMode('auto') },
  { id: 'manual', label: 'Modo manual', hint: 'M', keys: 'modo manual', run: () => setMode('manual') },
  { id: 'pump-on', label: 'Encender bomba', keys: 'bomba encender regar', run: () => setPump(true) },
  { id: 'pump-off', label: 'Apagar bomba', keys: 'bomba apagar detener', run: () => setPump(false) },
  { id: 'refill', label: 'Recargar tanque', keys: 'tanque agua recargar llenar', run: refillTank },
  { id: 'thr-up', label: 'Subir umbral 5%', keys: 'umbral subir aumentar', run: () => setThreshold(state.threshold + 5, true) },
  { id: 'thr-down', label: 'Bajar umbral 5%', keys: 'umbral bajar reducir', run: () => setThreshold(state.threshold - 5, true) },
  { id: 'toggle-run', label: 'Pausar / reanudar simulación', hint: 'Espacio', keys: 'pausa reanudar simulacion play', run: () => setRunning(!state.running) },
  { id: 'speed-1', label: 'Velocidad 1×', keys: 'velocidad normal', run: () => setSpeed(1) },
  { id: 'speed-2', label: 'Velocidad 2×', keys: 'velocidad rapida', run: () => setSpeed(2) },
  { id: 'speed-5', label: 'Velocidad 5×', keys: 'velocidad muy rapida', run: () => setSpeed(5) },
  { id: 'sc-normal', label: 'Escenario: Normal', keys: 'escenario normal restablecer', run: () => setScenario('normal') },
  { id: 'sc-heat', label: 'Escenario: Ola de calor', keys: 'escenario calor sequia', run: () => setScenario('heat') },
  { id: 'sc-rain', label: 'Escenario: Lluvia', keys: 'escenario lluvia agua', run: () => setScenario('rain') },
  { id: 'sc-leak', label: 'Escenario: Fuga en tanque', keys: 'escenario fuga tanque', run: () => setScenario('leak') },
  { id: 'sc-fault', label: 'Escenario: Falla de sensor', keys: 'escenario falla sensor error', run: () => setScenario('fault') },
  { id: 'view', label: 'Alternar gráfico / tabla', hint: 'G', keys: 'tabla grafico vista datos', run: () => setView(!state.showTable) },
  { id: 'exp-log', label: 'Exportar bitácora (CSV)', hint: 'E', keys: 'exportar csv bitacora', run: EXPORTERS['log-csv'] },
  { id: 'exp-tel', label: 'Exportar telemetría (CSV)', keys: 'exportar csv telemetria datos', run: EXPORTERS['telemetry-csv'] },
  { id: 'exp-json', label: 'Exportar proyecto (JSON)', keys: 'exportar json proyecto', run: EXPORTERS.json },
  { id: 'exp-rep', label: 'Generar informe imprimible', keys: 'informe reporte imprimir pdf', run: EXPORTERS.report },
  { id: 'clear', label: 'Limpiar bitácora', keys: 'limpiar borrar bitacora', run: () => $('clearLog').click() },
  { id: 'shortcuts', label: 'Ver atajos de teclado', hint: '?', keys: 'atajos teclado ayuda', run: () => openDialog($('shortcutsModal'), $('shortcutsClose')) },
  { id: 'about', label: 'Acerca del proyecto', hint: 'I', keys: 'acerca proyecto equipo ayuda', run: () => openDialog($('aboutModal'), $('aboutClose')) },
];

const palette = { overlay: $('paletteOverlay'), input: $('paletteInput'), list: $('paletteList'), items: [], index: 0 };

function openPalette() {
  palette.input.value = '';
  renderPalette('');
  openDialog(palette.overlay, palette.input);
}

function renderPalette(query) {
  const q = norm(query.trim());
  palette.items = q
    ? COMMANDS.filter((c) => norm(c.label).includes(q) || norm(c.keys).includes(q))
    : COMMANDS;
  palette.index = 0;

  palette.list.innerHTML = palette.items.length
    ? palette.items.map((c, i) => `
        <li role="option" class="palette-item${i === 0 ? ' is-active' : ''}" data-i="${i}" aria-selected="${i === 0}">
          <span>${escapeHtml(c.label)}</span>
          ${c.hint ? `<kbd>${escapeHtml(c.hint)}</kbd>` : ''}
        </li>`).join('')
    : '<li class="palette-empty">Sin coincidencias</li>';

  $$('.palette-item', palette.list).forEach((li) => {
    li.addEventListener('mouseenter', () => highlight(Number(li.dataset.i)));
    li.addEventListener('click', () => runPalette(Number(li.dataset.i)));
  });
}

function highlight(i) {
  palette.index = i;
  $$('.palette-item', palette.list).forEach((li, k) => {
    const on = k === i;
    li.classList.toggle('is-active', on);
    li.setAttribute('aria-selected', String(on));
    if (on) li.scrollIntoView({ block: 'nearest' });
  });
}

function runPalette(i) {
  const cmd = palette.items[i];
  if (!cmd) return;
  closeDialog(palette.overlay);
  cmd.run();
}

palette.input.addEventListener('input', (e) => renderPalette(e.target.value));

palette.input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlight(Math.min(palette.index + 1, palette.items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight(Math.max(palette.index - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPalette(palette.index);
  }
});

palette.overlay.addEventListener('mousedown', (e) => {
  if (e.target === palette.overlay) closeDialog(palette.overlay);
});

$('paletteBtn').addEventListener('click', openPalette);

/* ==========================================================
   15. Atajos de teclado
   ========================================================== */

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'Abrir la paleta de comandos'],
  ['?', 'Mostrar esta ayuda'],
  ['Espacio', 'Pausar o reanudar la simulación'],
  ['T', 'Alternar tema claro / oscuro'],
  ['A', 'Modo automático'],
  ['M', 'Modo manual'],
  ['B', 'Encender / apagar la bomba (modo manual)'],
  ['R', 'Recargar el tanque'],
  ['G', 'Alternar entre gráfico y tabla'],
  ['E', 'Exportar la bitácora en CSV'],
  ['I', 'Acerca del proyecto'],
  ['↑ / ↓', 'Ajustar el umbral en ±1%'],
  ['Esc', 'Cerrar el diálogo abierto'],
];

$('shortcutList').innerHTML = SHORTCUTS
  .map(([k, d]) => `<div class="shortcut-row"><dt>${k.split(' + ').map((p) => `<kbd>${escapeHtml(p)}</kbd>`).join(' + ')}</dt><dd>${escapeHtml(d)}</dd></div>`)
  .join('');

/** ¿El foco está en un campo de texto? Entonces no capturamos letras sueltas. */
const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;

document.addEventListener('keydown', (e) => {
  /* Ctrl+K funciona incluso escribiendo */
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }

  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!palette.overlay.hidden || $$('.modal-overlay:not([hidden])').length) return;

  const k = e.key.toLowerCase();
  const map = {
    ' ': () => setRunning(!state.running),
    t: toggleTheme,
    a: () => setMode('auto'),
    m: () => setMode('manual'),
    b: () => setPump(!state.pumpOn),
    r: refillTank,
    g: () => setView(!state.showTable),
    e: EXPORTERS['log-csv'],
    i: () => openDialog($('aboutModal'), $('aboutClose')),
    '?': () => openDialog($('shortcutsModal'), $('shortcutsClose')),
    arrowup: () => setThreshold(state.threshold + 1),
    arrowdown: () => setThreshold(state.threshold - 1),
  };

  const action = map[k];
  if (action) {
    e.preventDefault();
    action();
  }
});

/* ==========================================================
   16. Enlace de los controles restantes
   ========================================================== */

$('themeToggle').addEventListener('click', toggleTheme);
$('modeAuto').addEventListener('click', () => setMode('auto'));
$('modeManual').addEventListener('click', () => setMode('manual'));
$('pumpToggle').addEventListener('click', () => setPump(!state.pumpOn));
$('refillTank').addEventListener('click', refillTank);
$('playPause').addEventListener('click', () => setRunning(!state.running));
$('stepOnce').addEventListener('click', () => simulateTick());
$('thresholdSlider').addEventListener('input', (e) => setThreshold(Number(e.target.value)));

$$('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
$$('[data-scenario]').forEach((b) => b.addEventListener('click', () => setScenario(b.dataset.scenario)));

addEventListener('resize', drawSparkline);

/* ==========================================================
   17. Arranque
   ========================================================== */

$('ruleCount').textContent = RiegoAssistant.RULES.length;

setThreshold(state.threshold);
setMode(state.mode, false);
setSpeed(1);
setRunning(true);

/* restaura el rango del gráfico guardado */
$$('[data-range]').forEach((b) => {
  const on = (b.dataset.range === 'all' ? 'all' : Number(b.dataset.range)) === state.chartRange;
  b.classList.toggle('is-active', on);
  b.setAttribute('aria-checked', String(on));
});

$('assistantBody').hidden = !state.assistantOpen;
$('assistantToggle').textContent = state.assistantOpen ? 'Ocultar' : 'Mostrar';

buildChart();
refreshChartData();
renderSensors();
renderPump();
renderSummary();
renderLog();
runAssistant();

if (saved && (state.log.length || state.history.length)) {
  Toast.show('Sesión restaurada desde este navegador', 'info', 4000);
}
