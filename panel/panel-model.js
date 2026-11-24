(function (root) {
  'use strict';
  function estimacion(licencias, ventas) {
    let monto = 0, sinDatos = 0;
    for (const l of licencias.filter(x => x.vigente && x.plan === 'verificados' && x.tipo !== 'ilimitada')) {
      const vinculados = ventas.filter(v => v.licencia_id === l.id);
      const pago = vinculados[0];
      if (vinculados.length !== 1 || pago.monto_usd == null || !Number.isFinite(Number(pago.monto_usd)) || !(Number(pago.monto_usd) > 0) || !(Number(l.meses) > 0)) { sinDatos++; continue; }
      monto += Number(pago.monto_usd) / Number(l.meses);
    }
    return { monto, sinDatos };
  }
  function licenciaValida(licencias, cliente, licencia) {
    return !licencia || (!!cliente && licencias.some(l => String(l.id) === String(licencia) && String(l.cliente_id) === String(cliente)));
  }
  function limitesAlcanzados(resultados, limites) {
    return resultados.flatMap((r, i) => !r.error && (r.data || []).length >= limites[i] ? [i] : []);
  }
  function centavos(value) {
    const m = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!m) throw new Error('Monto inválido');
    const n = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(n) || n > 999999999999) throw new Error('Monto fuera de rango');
    return n;
  }
  function resultadoRegistrado(ventas, gastos, mes) {
    const suma = xs => xs.reduce((total, x) => { const n = total + centavos(x.monto_usd); if (!Number.isSafeInteger(n) || n > 4503599627370496) throw new Error('Total fuera de rango'); return n; }, 0);
    const pagos = suma(ventas.filter(x => x.fecha.slice(0, 7) === mes));
    const gastosMes = suma(gastos.filter(x => x.fecha.slice(0, 7) === mes));
    const total = suma(gastos);
    return { pagos: pagos / 100, gastos: gastosMes / 100, resultado: (pagos - gastosMes) / 100, gastosTotal: total / 100 };
  }
  function completo(r) {
    return !!r && !r.error && Array.isArray(r.data) && Number.isSafeInteger(r.count) && r.count >= 0 && r.data.length === r.count;
  }
  function filtrarGastoOriginal(q, g) {
    for (const k of ['id', 'fecha', 'descripcion', 'categoria', 'monto_usd', 'nota']) q = g[k] === null ? q.is(k, null) : q.eq(k, g[k]);
    return q;
  }
  function clavePendiente(proyecto, usuario) {
    if (typeof proyecto !== 'string' || !proyecto || typeof usuario !== 'string' || !usuario.trim()) throw new Error('No se puede identificar la cuenta autenticada.');
    return 'p2p.gasto.pendiente.v2:' + encodeURIComponent(proyecto) + ':' + encodeURIComponent(usuario);
  }
  function verificarPendiente(pendiente, datos) {
    if (!pendiente || !pendiente.id || !pendiente.datos) throw new Error('El intento pendiente no se puede leer con seguridad.');
    if (JSON.stringify(pendiente.datos) !== JSON.stringify(datos)) throw new Error('Hay un intento pendiente con otros datos. Cierra y vuelve a abrir para resolverlo primero.');
  }
  const api = { estimacion, licenciaValida, limitesAlcanzados, resultadoRegistrado, centavos, completo, filtrarGastoOriginal, clavePendiente, verificarPendiente };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelModel = api;
})(globalThis);
