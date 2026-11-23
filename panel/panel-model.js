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
  const api = { estimacion, licenciaValida, limitesAlcanzados };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelModel = api;
})(globalThis);
