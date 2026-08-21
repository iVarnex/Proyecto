'use strict';

/* ==========================================================
   Asistente de diagnóstico — motor de reglas
   ----------------------------------------------------------
   NO es un modelo de lenguaje ni aprendizaje automático: es un
   sistema experto determinista. Cada recomendación proviene de
   una regla explícita y auditable declarada en RULES.
   Esto lo hace ideal para el aula: el estudiante puede leer la
   condición, predecir la salida y verificarla.

   Contrato:
     evaluate(snapshot) -> { score, findings[], trend }
   ========================================================== */

(function (global) {

  /** Severidades ordenadas de mayor a menor prioridad. */
  const SEVERITY_RANK = { critical: 0, warning: 1, info: 2, good: 3 };

  /**
   * Pendiente de humedad por minuto usando regresión lineal simple
   * sobre las últimas `n` muestras. Devuelve null si no hay datos.
   */
  function moistureTrend(history, n = 12) {
    const pts = history.slice(-n);
    if (pts.length < 4) return null;

    const t0 = new Date(pts[0].t).getTime();
    const xs = pts.map((p) => (new Date(p.t).getTime() - t0) / 60000); // minutos
    const ys = pts.map((p) => p.soil);

    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;

    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    if (den === 0) return null;
    return num / den; // puntos porcentuales por minuto
  }

  /**
   * Catálogo de reglas. Cada regla:
   *   id       identificador estable
   *   test(s)  condición sobre el snapshot -> boolean
   *   build(s) descriptor de la recomendación
   *   penalty  cuánto descuenta del índice de salud si se dispara
   */
  const RULES = [
    {
      id: 'sensor-fault',
      penalty: 40,
      test: (s) => s.sensorFault,
      build: () => ({
        severity: 'critical',
        title: 'Sensor de humedad sin señal',
        detail: 'El riego automático quedó suspendido por seguridad. Revisa el cableado del sensor en la simulación de Wokwi antes de continuar.',
      }),
    },
    {
      id: 'tank-critical',
      penalty: 30,
      test: (s) => s.tank < 15,
      build: (s) => ({
        severity: 'critical',
        title: 'Tanque casi vacío',
        detail: `Queda ${s.tank.toFixed(0)}% de reserva. Si la bomba sigue activa puede trabajar en seco y dañarse.`,
        action: { label: 'Recargar tanque', command: 'refill-tank' },
      }),
    },
    {
      id: 'soil-critical',
      penalty: 25,
      test: (s) => !s.sensorFault && s.soil < 15,
      build: () => ({
        severity: 'critical',
        title: 'Suelo en estrés hídrico severo',
        detail: 'Por debajo del 15% la planta ya sufre daño. Se requiere riego inmediato.',
      }),
    },
    {
      id: 'manual-idle-below-threshold',
      penalty: 20,
      test: (s) => !s.sensorFault && s.mode === 'manual' && !s.pumpOn && s.soil < s.threshold,
      build: () => ({
        severity: 'warning',
        title: 'Humedad bajo el umbral y bomba apagada',
        detail: 'Estás en modo manual y nadie está regando. Enciende la bomba o devuelve el control al automático.',
        action: { label: 'Cambiar a automático', command: 'set-mode-auto' },
      }),
    },
    {
      id: 'overwatering',
      penalty: 15,
      test: (s) => s.pumpOn && s.soil > 85,
      build: () => ({
        severity: 'warning',
        title: 'Riesgo de encharcamiento',
        detail: 'El suelo supera el 85% y la bomba sigue encendida. El exceso de agua asfixia la raíz y lava los nutrientes.',
        action: { label: 'Apagar bomba', command: 'pump-off' },
      }),
    },
    {
      id: 'tank-low',
      penalty: 10,
      test: (s) => s.tank >= 15 && s.tank < 30,
      build: (s) => ({
        severity: 'warning',
        title: 'Reserva de agua baja',
        detail: `El tanque está al ${s.tank.toFixed(0)}%. Programa una recarga antes del próximo ciclo.`,
        action: { label: 'Recargar tanque', command: 'refill-tank' },
      }),
    },
    {
      id: 'high-evapotranspiration',
      penalty: 10,
      test: (s) => s.temp > 30 && s.humidity < 35,
      build: () => ({
        severity: 'warning',
        title: 'Evapotranspiración elevada',
        detail: 'Calor con aire seco: el suelo pierde agua mucho más rápido. Conviene subir el umbral para anticipar el riego.',
        action: { label: 'Subir umbral +5%', command: 'threshold-up' },
      }),
    },
    {
      id: 'drying-fast',
      penalty: 8,
      test: (s) => !s.sensorFault && s.trend !== null && s.trend < -1.2 && !s.pumpOn,
      build: (s) => ({
        severity: 'warning',
        title: 'El suelo se seca rápido',
        detail: `Ritmo actual: ${s.trend.toFixed(1)} puntos por minuto. A este paso cruzará el umbral en unos ${Math.max(1, Math.round((s.soil - s.threshold) / Math.abs(s.trend)))} min.`,
      }),
    },
    {
      id: 'threshold-too-high',
      penalty: 6,
      test: (s) => s.threshold > 55,
      build: () => ({
        severity: 'info',
        title: 'Umbral muy exigente',
        detail: 'Por encima del 55% el sistema riega casi sin pausa y desperdicia agua. Revisa si el cultivo realmente lo necesita.',
      }),
    },
    {
      id: 'threshold-too-low',
      penalty: 8,
      test: (s) => s.threshold < 20,
      build: () => ({
        severity: 'warning',
        title: 'Umbral demasiado bajo',
        detail: 'Con menos de 20% el riego llega tarde y la planta alcanza a sufrir estrés. Considera subirlo.',
        action: { label: 'Subir umbral +5%', command: 'threshold-up' },
      }),
    },
    {
      id: 'fungal-risk',
      penalty: 5,
      test: (s) => s.humidity > 85 && s.soil > 70,
      build: () => ({
        severity: 'info',
        title: 'Condiciones favorables a hongos',
        detail: 'Aire muy húmedo y suelo saturado. Reducir la frecuencia de riego disminuye el riesgo sanitario.',
      }),
    },
    {
      id: 'short-cycles',
      penalty: 6,
      test: (s) => s.stats.irrigations > 8,
      build: (s) => ({
        severity: 'info',
        title: 'Ciclos de riego muy frecuentes',
        detail: `${s.stats.irrigations} activaciones hoy. Muchos arranques cortos desgastan la bomba; una banda de histéresis más amplia lo suaviza.`,
      }),
    },
    {
      id: 'temp-extreme',
      penalty: 8,
      test: (s) => s.temp > 34 || s.temp < 10,
      build: (s) => ({
        severity: 'warning',
        title: 'Temperatura fuera de rango operativo',
        detail: `${s.temp.toFixed(1)} °C. Fuera de 10–34 °C el riego pierde eficacia y algunos sensores se descalibran.`,
      }),
    },
  ];

  /**
   * Evalúa el estado y devuelve diagnóstico completo.
   * @param {object} snap - lectura actual del sistema
   */
  function evaluate(snap) {
    const s = { ...snap, trend: moistureTrend(snap.history || []) };

    const findings = [];
    let score = 100;

    for (const rule of RULES) {
      let hit = false;
      try {
        hit = rule.test(s);
      } catch {
        hit = false; // una regla defectuosa nunca debe tumbar el tablero
      }
      if (!hit) continue;
      findings.push({ id: rule.id, ...rule.build(s) });
      score -= rule.penalty;
    }

    if (!findings.length) {
      findings.push({
        id: 'all-clear',
        severity: 'good',
        title: 'Sistema estable',
        detail: 'Todas las variables están dentro de rango y no hay acciones pendientes.',
      });
    }

    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      trend: s.trend,
      findings,
    };
  }

  global.RiegoAssistant = { evaluate, moistureTrend, RULES };

})(window);
