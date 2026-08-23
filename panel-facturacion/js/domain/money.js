/**
 * Dinero como enteros en la unidad mínima.
 *
 * 85.000,00 COP se guarda como 8500000. Nunca se usa float para almacenar ni
 * para sumar: 0.1 + 0.2 === 0.30000000000000004 y ese error se acumula factura
 * tras factura hasta que los totales dejan de cuadrar.
 *
 * Módulo puro: no toca document, window ni localStorage.
 */

const DECIMALES = { COP: 2, USD: 2, EUR: 2, MXN: 2, ARS: 2, PEN: 2, BRL: 2, JPY: 0, CLP: 0 };
const DECIMALES_POR_DEFECTO = 2;

/** Un separador seguido de exactamente 3 dígitos es de miles, salvo que la parte entera sea 0. */
const DIGITOS_DE_GRUPO = 3;

export const decimalesDe = (moneda) => DECIMALES[moneda] ?? DECIMALES_POR_DEFECTO;

export const factorDe = (moneda) => 10 ** decimalesDe(moneda);

export const MONEDAS = Object.keys(DECIMALES);

/**
 * Convierte lo que el usuario escribe en centavos.
 *
 * Acepta "85.000,50" (es-CO) y "85,000.50" (en-US). Con un solo separador la
 * forma es ambigua —"1.234" son 1234 pesos o 1,234 dólares— y se resuelve por
 * la cantidad de dígitos que lo siguen: 3 dígitos es agrupación de miles.
 *
 * @returns {number|null} centavos, o null si el texto no es un número
 */
export function parsear(texto, moneda) {
  const limpio = String(texto ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!limpio || !/\d/.test(limpio)) return null;

  const negativo = limpio.startsWith('-');
  const sinSigno = limpio.replace(/-/g, '');

  const ultimaComa = sinSigno.lastIndexOf(',');
  const ultimoPunto = sinSigno.lastIndexOf('.');

  let normalizado;
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    /* con ambos separadores, el último es el decimal */
    normalizado = ultimaComa > ultimoPunto
      ? sinSigno.replaceAll('.', '').replace(',', '.')
      : sinSigno.replaceAll(',', '');
  } else if (ultimaComa === -1 && ultimoPunto === -1) {
    normalizado = sinSigno;
  } else {
    normalizado = normalizarSeparadorUnico(sinSigno, ultimaComa !== -1 ? ',' : '.');
  }

  const valor = parseFloat(normalizado);
  if (Number.isNaN(valor)) return null;

  const centavos = Math.round(valor * factorDe(moneda));
  return negativo ? -centavos : centavos;
}

function normalizarSeparadorUnico(texto, separador) {
  const partes = texto.split(separador);

  /* "1.234.567": varios separadores iguales solo pueden ser miles */
  if (partes.length > 2) return partes.join('');

  const [entera, decimales] = partes;
  const esAgrupacion = decimales.length === DIGITOS_DE_GRUPO && entera !== '' && entera !== '0';
  return esAgrupacion ? entera + decimales : `${entera}.${decimales}`;
}

export function formatear(centavos, moneda, { conSimbolo = true } = {}) {
  const decimales = decimalesDe(moneda);
  const valor = (centavos ?? 0) / factorDe(moneda);
  return new Intl.NumberFormat('es-CO', {
    style: conSimbolo ? 'currency' : 'decimal',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

/**
 * Multiplica un entero por un decimal (horas, porcentajes) con redondeo
 * bancario (half-to-even): repartido sobre muchas líneas no sesga el total
 * hacia arriba como haría Math.round.
 */
export function multiplicar(centavos, factor) {
  const exacto = centavos * factor;
  const negativo = exacto < 0;
  const absoluto = Math.abs(exacto);

  const abajo = Math.floor(absoluto);
  const resto = absoluto - abajo;

  let redondeado;
  if (resto > 0.5) redondeado = abajo + 1;
  else if (resto < 0.5) redondeado = abajo;
  else redondeado = abajo % 2 === 0 ? abajo : abajo + 1;

  return negativo ? -redondeado : redondeado;
}

export const porcentaje = (centavos, pct) => multiplicar(centavos, pct / 100);

/**
 * Reparte un monto entre varios pesos sin perder ni inventar centavos:
 * la suma de las partes es siempre exactamente `centavos`.
 */
export function repartir(centavos, pesos) {
  const total = pesos.reduce((a, b) => a + b, 0);
  if (total === 0) return pesos.map(() => 0);

  const partes = pesos.map((p) => Math.floor((centavos * p) / total));
  let sobrante = centavos - partes.reduce((a, b) => a + b, 0);

  for (let i = 0; sobrante > 0; i = (i + 1) % partes.length, sobrante--) {
    partes[i] += 1;
  }
  return partes;
}

export const sumar = (...montos) => montos.reduce((a, b) => a + (b ?? 0), 0);
