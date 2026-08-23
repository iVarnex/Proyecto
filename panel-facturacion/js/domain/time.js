/**
 * Duraciones, cronómetro y fechas locales.
 *
 * El cronómetro no acumula con setInterval: el navegador estrangula los
 * intervalos en pestañas en segundo plano y se perderían minutos. La verdad
 * son los timestamps; el intervalo solo pinta.
 *
 * Módulo puro: `ahora` siempre entra por parámetro para poder probarlo.
 */

const MS_POR_SEGUNDO = 1000;
const SEGUNDOS_POR_MINUTO = 60;
const SEGUNDOS_POR_HORA = 3600;
const MS_POR_DIA = 86400000;
const BLOQUE_FACTURABLE_MINUTOS = 15;

export function segundosTranscurridos(inicioTs, pausas = [], ahora = Date.now()) {
  const bruto = ahora - inicioTs;
  const pausado = pausas.reduce((acc, p) => acc + ((p.fin ?? ahora) - p.inicio), 0);
  return Math.max(0, Math.floor((bruto - pausado) / MS_POR_SEGUNDO));
}

export function formatearDuracion(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / SEGUNDOS_POR_HORA);
  const m = Math.floor((total % SEGUNDOS_POR_HORA) / SEGUNDOS_POR_MINUTO);
  const s = total % SEGUNDOS_POR_MINUTO;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "2:30:00" -> horas decimales para mostrar: 2,5 h */
export const horasDecimales = (segundos) => segundos / SEGUNDOS_POR_HORA;

/**
 * Horas facturables: se cobra por bloques completos, no por segundos sueltos.
 * 61 minutos con bloques de 15 se cobran como 1,25 h.
 */
export function horasFacturables(segundos, bloqueMinutos = BLOQUE_FACTURABLE_MINUTOS) {
  if (segundos <= 0) return 0;
  const minutos = segundos / SEGUNDOS_POR_MINUTO;
  const bloques = Math.ceil(minutos / bloqueMinutos);
  return (bloques * bloqueMinutos) / SEGUNDOS_POR_MINUTO;
}

/**
 * Día local en formato YYYY-MM-DD.
 * toISOString() daría el día UTC: en Colombia (UTC-5), a las 8 p.m. las horas
 * registradas caerían en el día siguiente.
 */
export function hoyLocal(fecha = new Date()) {
  const desfaseMs = fecha.getTimezoneOffset() * SEGUNDOS_POR_MINUTO * MS_POR_SEGUNDO;
  return new Date(fecha.getTime() - desfaseMs).toISOString().slice(0, 10);
}

/** Suma días a una fecha YYYY-MM-DD sin salirse del calendario local. */
export function sumarDias(fechaISO, dias) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia + dias);
  return hoyLocal(fecha);
}

/** Días entre dos fechas YYYY-MM-DD. Negativo si `hasta` ya pasó. */
export function diasEntre(desde, hasta) {
  const aFecha = (iso) => {
    const [anio, mes, dia] = iso.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  };
  return Math.round((aFecha(hasta) - aFecha(desde)) / MS_POR_DIA);
}

/** Lunes de la semana a la que pertenece la fecha. */
export function inicioDeSemana(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  const diaSemana = (fecha.getDay() + 6) % 7; // 0 = lunes
  return sumarDias(fechaISO, -diaSemana);
}

export function agruparPorDia(registros) {
  const porDia = new Map();
  for (const registro of registros) {
    const acumulado = porDia.get(registro.fecha) ?? { fecha: registro.fecha, segundos: 0, registros: [] };
    acumulado.segundos += registro.segundos;
    acumulado.registros.push(registro);
    porDia.set(registro.fecha, acumulado);
  }
  return [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export const NOMBRES_DIA = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export function etiquetaDia(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  return `${NOMBRES_DIA[(fecha.getDay() + 6) % 7]} ${dia}`;
}

export const NOMBRES_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Los últimos `cantidad` meses en formato YYYY-MM, terminando en el mes de `fecha` (incluido). */
export function ultimosMeses(cantidad, fecha = new Date()) {
  const meses = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

export const etiquetaMes = (clave) => NOMBRES_MES[Number(clave.slice(5, 7)) - 1];
