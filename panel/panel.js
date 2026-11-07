/* Panel del negocio de P2PAutoPay.
   Lee y escribe en Supabase (tablas neg_*) con la sesion del dueno: las reglas de la
   base (RLS) solo dejan pasar a la cuenta que esta en neg_duenos. Las licencias se
   firman en el servidor (funcion neg-licencias); la llave nunca llega a esta pagina.
   Todo el texto que viene de la base se pone con textContent (nada de innerHTML). */
(() => {
  "use strict";

  const SUPABASE_URL = "https://zgkicomjnrgtjhnjtrxm.supabase.co";
  const SUPABASE_KEY = "sb_publishable_N-SIwaLCYvcD2CBh2HO9MA_suMsJFWW";
  const ILIMITADA = "9999-12-31";
  const PRECIO = { no_verificados: 80, verificados: 100, prueba: 0, dueno: 0 };
  const NOMBRE_PLAN = { no_verificados: "No verificados", verificados: "Verificados", prueba: "Persona de prueba", dueno: "Dueño", otro: "Otro" };

  // ids de web_planes (formulario de la pagina) -> plan y duracion del panel
  const PLAN_WEB = {
    ilimitada: { plan: "no_verificados", duracion: "ilimitada", nombre: "No verificados" },
    verificados: { plan: "verificados", duracion: "1", nombre: "Verificados" },
    "1m": { plan: "no_verificados", duracion: "1", nombre: "1 mes" },
    "3m": { plan: "no_verificados", duracion: "3", nombre: "3 meses" },
    "6m": { plan: "no_verificados", duracion: "6", nombre: "6 meses" },
    "12m": { plan: "no_verificados", duracion: "12", nombre: "12 meses" },
  };

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "p2pa-negocio" },
  });

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  /** el("li", {class: "x"}, "texto", otroNodo) */
  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos.flat()) {
      if (h === null || h === undefined || h === false) continue;
      n.append(h instanceof Node ? h : document.createTextNode(String(h)));
    }
    return n;
  }

  // ---------------------------------------------------------------- fechas y dinero
  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
  const aFecha = (iso) => { const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(a, m - 1, d); };
  const diasEntre = (desde, hasta) => Math.round((aFecha(hasta) - aFecha(desde)) / 86400000);
  const fechaCorta = (iso) => new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(aFecha(iso));
  const usd = (n) => "$" + Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const mesClave = (iso) => iso.slice(0, 7);
  const nombreMes = (clave, largo) => new Intl.DateTimeFormat("es-VE", { month: largo ? "long" : "short", year: largo ? "numeric" : undefined, timeZone: "UTC" })
    .format(Date.UTC(+clave.slice(0, 4), +clave.slice(5, 7) - 1, 1));
  function mesesAtras(n) {
    const [a, m] = hoy().split("-").map(Number);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(a, m - 1 - i, 1));
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  }

  let avisoTimer;
  function avisar(texto) {
    const t = $("#toast");
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Copiada. Ya puedes pegarla al cliente");
    } catch {
      avisar("No pude copiar: selecciona el texto y cópialo");
    }
  }

  function ocupado(boton, si, texto) {
    if (si) {
      boton.dataset.texto = boton.textContent;
      boton.disabled = true;
      boton.replaceChildren(el("span", { class: "girando" }, texto || "Un momento"));
    } else {
      boton.disabled = false;
      boton.textContent = boton.dataset.texto || boton.textContent;
    }
  }

  function mostrarError(nodo, texto) {
    nodo.textContent = texto || "";
    nodo.hidden = !texto;
  }

  // ---------------------------------------------------------------- pantallas
  function pantalla(id) {
    for (const p of ["cargando", "entrar", "sin-permiso", "panel"]) $("#" + p).hidden = p !== id;
  }

  let modoCrear = false;
  $("#cambiar-modo").addEventListener("click", () => {
    modoCrear = !modoCrear;
    $("#boton-entrar").textContent = modoCrear ? "Crear mi cuenta" : "Entrar";
    $("#cambiar-modo").textContent = modoCrear ? "Ya tengo cuenta: entrar" : "Es mi primera vez: crear mi cuenta";
    $("[name=clave]", $("#form-entrar")).autocomplete = modoCrear ? "new-password" : "current-password";
    mostrarError($("#entrar-error"), "");
  });

  $("#form-entrar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const correo = f.correo.value.trim();
    const clave = f.clave.value;
    const err = $("#entrar-error");
    if (!correo || !clave) return mostrarError(err, "Escribe tu correo y tu contraseña");
    if (modoCrear && clave.length < 10) return mostrarError(err, "Usa una contraseña de al menos 10 caracteres");
    const boton = $("#boton-entrar");
    ocupado(boton, true, modoCrear ? "Creando" : "Entrando");
    mostrarError(err, "");
    const r = modoCrear
      ? await sb.auth.signUp({ email: correo, password: clave })
      : await sb.auth.signInWithPassword({ email: correo, password: clave });
    ocupado(boton, false);
    if (r.error) {
      const m = r.error.message || "";
      return mostrarError(err, /confirm/i.test(m)
        ? "Tu cuenta está creada. Avísale a Claude para que la active y vuelve a entrar"
        : /invalid/i.test(m) ? "Correo o contraseña incorrectos" : "No se pudo: " + m);
    }
    if (modoCrear && !r.data.session) {
      return mostrarError(err, "Cuenta creada. Avísale a Claude en el hilo del panel para que la active");
    }
    f.clave.value = "";
    arrancar();
  });

  async function salir() {
    await sb.auth.signOut();
    location.reload();
  }
  $("#salir").addEventListener("click", salir);
  $("#salir-2").addEventListener("click", salir);

  // pestanas
  function ir(nombre) {
    for (const b of $$(".pestanas button")) {
      if (b.dataset.ir === nombre) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    for (const s of $$(".seccion")) s.hidden = s.id !== "sec-" + nombre;
    window.scrollTo({ top: 0 });
  }
  for (const b of $$(".pestanas button")) b.addEventListener("click", () => ir(b.dataset.ir));

  // dialogos: cualquier [data-cerrar] cierra el suyo
  for (const b of $$("[data-cerrar]")) b.addEventListener("click", () => b.closest("dialog").close());

  // ---------------------------------------------------------------- datos
  const D = { clientes: [], licencias: [], ventas: [], descargas: 0, instalador: null, solicitudes: [], vistas: [], llave: null };

  async function cargar() {
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [c, l, v, d, s, w] = await Promise.all([
      sb.from("neg_clientes").select("*").order("nombre"),
      sb.from("neg_licencias").select("*").order("creada", { ascending: false }),
      sb.from("neg_ventas").select("*").order("fecha", { ascending: false }).order("id", { ascending: false }),
      sb.from("web_descargas").select("id", { count: "exact", head: true }).gte("creada", hace30),
      sb.from("web_solicitudes").select("*").order("creada", { ascending: false }).limit(100),
      // candado en linea: donde se uso cada licencia (si la tabla aun no existe, se ignora)
      sb.from("lic_vistas").select("huella, pc, equipo, version, ultima").order("ultima", { ascending: false }).limit(2000),
    ]);
    const fallo = [c, l, v].find((r) => r.error);
    if (fallo) throw fallo.error;
    D.clientes = c.data;
    D.licencias = l.data;
    D.ventas = v.data;
    D.descargas = d.count || 0;
    D.solicitudes = s.data || [];
    D.vistas = w.error ? [] : w.data || [];
    pintar();
    descargasGithub();
  }

  /** Total que cuenta GitHub de los instaladores (.exe) de todas las versiones: es el
      mismo numero del contador publico de la pagina. Incluye actualizaciones. */
  async function descargasGithub() {
    try {
      const r = await fetch("https://api.github.com/repos/miguelaromerov3b-blip/p2p-autopay-descargas/releases?per_page=100",
        { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) return;
      let total = 0;
      for (const rel of await r.json()) {
        for (const a of rel.assets || []) if (/\.exe$/i.test(a.name)) total += a.download_count || 0;
      }
      D.instalador = total;
      pintarResumen(estados());
    } catch { /* sin GitHub, el embudo sigue con lo demas */ }
  }

  const clientePorId = (id) => D.clientes.find((c) => c.id === id);
  const nombreCliente = (id) => clientePorId(id)?.nombre || "Sin dueño";

  /** Estado de cada licencia: dias que le quedan, si fue reemplazada por una renovacion... */
  function estados() {
    const reemplazadas = new Set(D.licencias.filter((l) => l.renueva_id && l.estado !== "anulada").map((l) => l.renueva_id));
    const h = hoy();
    return D.licencias.map((l) => {
      const ilimitada = l.vence === ILIMITADA;
      const dias = l.vence ? diasEntre(h, l.vence) : null;
      let tipo;
      if (l.estado === "anulada") tipo = "anulada";
      else if (reemplazadas.has(l.id)) tipo = "renovada";
      else if (ilimitada) tipo = "ilimitada";
      else if (dias === null) tipo = "sin-fecha";
      else if (dias < 0) tipo = "vencida";
      else if (dias <= 7) tipo = "por-vencer";
      else tipo = "activa";
      const vigente = ["activa", "por-vencer", "ilimitada"].includes(tipo);
      return { ...l, dias, tipo, vigente, uso: uso(l) };
    });
  }

  /** Ultima vez que el programa consulto esta licencia y si la usan dos equipos a la vez. */
  function uso(l) {
    if (!l.huella) return null;
    const suyas = D.vistas.filter((v) => v.huella === l.huella);
    if (!suyas.length) return null;
    const hace24 = Date.now() - 86400000;
    const equipos = new Set(suyas.filter((v) => Date.parse(v.ultima) >= hace24).map((v) => v.equipo));
    return { ultima: suyas[0].ultima, version: suyas[0].version, clon: l.pc !== "*" && equipos.size > 1, equipos: equipos.size };
  }

  function haceCuanto(iso) {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 2) return "ahora";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return `hace ${d} ${d === 1 ? "día" : "días"}`;
  }

  function chipDias(e) {
    switch (e.tipo) {
      case "ilimitada": return el("span", { class: "chip siempre" }, "Ilimitada");
      case "activa": return el("span", { class: "chip bien" }, `${e.dias} días`);
      case "por-vencer": return el("span", { class: "chip alerta" }, e.dias === 0 ? "Vence hoy" : e.dias === 1 ? "Vence mañana" : `Vence en ${e.dias} días`);
      case "vencida": return el("span", { class: "chip mal" }, `Venció hace ${-e.dias} ${-e.dias === 1 ? "día" : "días"}`);
      case "renovada": return el("span", { class: "chip gris" }, "Renovada");
      case "anulada": return el("span", { class: "chip gris" }, "Anulada");
      default: return el("span", { class: "chip gris" }, "Sin fecha");
    }
  }

  // ---------------------------------------------------------------- pintar
  function pintar() {
    const E = estados();
    pintarResumen(E);
    pintarLicencias(E);
    pintarClientes(E);
    pintarVentas();
    llenarSelectsClientes();
  }

  function pintarResumen(E) {
    const meses = mesesAtras(6);
    const porMes = Object.fromEntries(meses.map((m) => [m, 0]));
    let total = 0;
    for (const v of D.ventas) {
      total += Number(v.monto_usd);
      const k = mesClave(v.fecha);
      if (k in porMes) porMes[k] += Number(v.monto_usd);
    }
    const actual = meses[meses.length - 1];
    const anterior = meses[meses.length - 2];
    $("#mes-actual").textContent = "Ingresos de " + nombreMes(actual, true);
    $("#ingreso-mes").textContent = usd(porMes[actual]);
    const comp = $("#ingreso-comparado");
    comp.replaceChildren();
    if (porMes[anterior] > 0) {
      const dif = porMes[actual] - porMes[anterior];
      const pct = Math.round((dif / porMes[anterior]) * 100);
      comp.append(el("span", { class: dif >= 0 ? "sube" : "baja" }, `${dif >= 0 ? "▲" : "▼"} ${Math.abs(pct)} %`),
        ` frente a ${nombreMes(anterior)} (${usd(porMes[anterior])})`);
    } else {
      comp.textContent = porMes[actual] > 0 ? `En ${nombreMes(anterior)} no hubo ventas anotadas` : "Aún no hay ventas este mes";
    }

    const vigentes = E.filter((e) => e.vigente);
    const porVencer = E.filter((e) => e.tipo === "por-vencer");
    const vencidas = E.filter((e) => e.tipo === "vencida");
    $("#c-activas").textContent = vigentes.length;
    $("#c-por-vencer").textContent = porVencer.length;
    $("#c-por-vencer").className = porVencer.length ? "alerta" : "";
    $("#c-vencidas").textContent = vencidas.length;
    $("#c-vencidas").className = vencidas.length ? "mal" : "";
    // ingreso fijo: lo que pagan al mes las suscripciones (Verificados) vigentes
    let mrr = 0;
    for (const e of vigentes.filter((x) => x.plan === "verificados" && x.tipo !== "ilimitada")) {
      const pago = D.ventas.find((v) => v.licencia_id === e.id);
      mrr += pago && e.meses ? Number(pago.monto_usd) / e.meses : PRECIO.verificados;
    }
    $("#c-mrr").textContent = usd(Math.round(mrr * 100) / 100);
    $("#c-clientes").textContent = D.clientes.length;
    $("#c-total").textContent = usd(total);

    // grafico
    const max = Math.max(...Object.values(porMes), 1);
    const g = $("#grafico");
    g.replaceChildren();
    g.setAttribute("aria-label", "Ingresos de los últimos 6 meses: " + meses.map((m) => `${nombreMes(m, true)} ${usd(porMes[m])}`).join(", "));
    const tbody = $("#grafico-tabla tbody");
    tbody.replaceChildren();
    for (const m of meses) {
      const alto = porMes[m] > 0 ? Math.max(3, (porMes[m] / max) * 100) : 0;
      const barra = el("div", { class: "barra-mes" + (m === actual ? " actual" : ""), tabindex: "0", title: `${nombreMes(m, true)}: ${usd(porMes[m])}` },
        el("b", {}, usd(porMes[m])), el("i", {}));
      barra.querySelector("i").style.height = alto + "%";
      g.append(barra);
      tbody.append(el("tr", {}, el("td", {}, nombreMes(m, true)), el("td", {}, usd(porMes[m]))));
    }
    const etiquetas = el("div", { class: "meses", "aria-hidden": "true" }, meses.map((m) => el("span", {}, nombreMes(m))));
    g.nextElementSibling?.classList?.contains("meses") && g.nextElementSibling.remove();
    g.after(etiquetas);

    // embudo
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const sol30 = D.solicitudes.filter((s) => s.creada.slice(0, 10) >= hace30).length;
    const ventasTotal = D.ventas.filter((v) => v.plan !== "otro").length;
    const pasos = [
      ["Descargas del instalador", D.instalador ?? "…", "Total de GitHub, el mismo del contador de la página (incluye actualizaciones)"],
      ["Pulsaron Descargar en la página", D.descargas, "Últimos 30 días"],
      ["Pidieron licencia", sol30, "Formulario de la página, últimos 30 días"],
      ["Compraron", ventasTotal, D.instalador ? `${((ventasTotal / D.instalador) * 100).toFixed(1)} % de las descargas` : "Pagos anotados en el panel"],
    ];
    const tope = Math.max(D.instalador || 0, D.descargas, sol30, ventasTotal, 1);
    $("#embudo").replaceChildren(...pasos.map(([t, n, sub]) => {
      const riel = el("div", { class: "riel" }, el("i", {}));
      riel.firstChild.style.width = (Number(n) || 0) / tope * 100 + "%";
      return el("li", {}, el("span", {}, t), el("strong", {}, n), riel, el("small", {}, sub));
    }));

    // cobrar
    const clones = E.filter((e) => e.vigente && e.uso?.clon);
    $("#bloque-alertas").hidden = !clones.length;
    $("#lista-alertas").replaceChildren(...clones.map(filaLicencia));
    const cobrar = E.filter((e) => e.tipo === "por-vencer" || (e.tipo === "vencida" && e.dias >= -30))
      .sort((a, b) => a.dias - b.dias);
    const lc = $("#lista-cobrar");
    lc.replaceChildren(...(cobrar.length ? cobrar.map(filaLicencia) : [el("li", { class: "vacio" }, "Nadie vence esta semana. Todo al día.")]));

    // solicitudes
    const pend = D.solicitudes.filter((s) => !s.atendida);
    $("#lista-solicitudes").replaceChildren(...(pend.length ? pend.map(filaSolicitud)
      : [el("li", { class: "vacio" }, "No hay solicitudes pendientes de la página.")]));
  }

  function filaLicencia(e) {
    const cliente = clientePorId(e.cliente_id);
    const lado = el("div", { class: "lado" }, chipDias(e));
    if (e.uso?.clon) lado.prepend(el("span", { class: "chip mal", title: "La misma licencia se abrió en otro equipo en las últimas 24 h" }, `${e.uso.equipos} equipos`));
    if (e.licencia && e.tipo !== "anulada") lado.append(el("button", { type: "button", class: "boton pequeno", onclick: () => copiar(e.licencia) }, "Copiar"));
    if (["activa", "por-vencer", "vencida"].includes(e.tipo)) {
      lado.append(el("button", { type: "button", class: "boton pequeno principal", onclick: () => abrirLicencia({ renovar: e }) }, "Renovar"));
    }
    if (e.vigente) {
      lado.append(el("button", { type: "button", class: "boton pequeno peligro", onclick: () => anular(e) }, "Anular"));
    }
    if (e.tipo === "anulada") {
      lado.append(el("button", { type: "button", class: "boton pequeno", onclick: () => reactivar(e) }, "Reactivar"));
    }
    const vence = e.tipo === "ilimitada" ? "sin vencimiento" : e.vence ? "vence " + fechaCorta(e.vence) : "";
    return el("li", {},
      el("div", {},
        el("div", { class: "titulo" }, cliente?.nombre || "Sin dueño"),
        el("div", { class: "detalle" }, [`PC ${e.pc}`, NOMBRE_PLAN[e.plan] || e.plan, vence, cliente?.contacto].filter(Boolean).join(" · ")),
        e.uso ? el("div", { class: "detalle" }, `Abierta ${haceCuanto(e.uso.ultima)}` + (e.uso.version ? ` · versión ${e.uso.version}` : "")) : null),
      lado);
  }

  function filaSolicitud(s) {
    return el("li", {},
      el("div", {},
        el("div", { class: "titulo" }, s.nombre || "Sin nombre"),
        el("div", { class: "detalle" }, [s.contacto, PLAN_WEB[s.plan]?.nombre || NOMBRE_PLAN[s.plan] || s.plan, s.codigo_pc ? "PC " + s.codigo_pc : "", fechaCorta(s.creada)].filter(Boolean).join(" · ")),
        s.mensaje ? el("div", { class: "detalle" }, "“" + s.mensaje + "”") : null),
      el("div", { class: "lado" },
        el("button", { type: "button", class: "boton pequeno", onclick: () => atenderSolicitud(s) }, "Ya la atendí"),
        el("button", { type: "button", class: "boton pequeno principal", onclick: () => abrirLicencia({ solicitud: s }) }, "Venderle")));
  }

  // ---------------------------------------------------------------- licencias
  let filtro = "vigentes";
  for (const b of $$("[data-filtro]")) {
    b.addEventListener("click", () => {
      filtro = b.dataset.filtro;
      for (const x of $$("[data-filtro]")) x.setAttribute("aria-pressed", String(x === b));
      pintarLicencias(estados());
    });
  }
  $("#buscar-licencia").addEventListener("input", () => pintarLicencias(estados()));

  function pintarLicencias(E) {
    const q = $("#buscar-licencia").value.trim().toLowerCase();
    let lista = E.filter((e) => filtro === "todas" ? true : filtro === "vigentes" ? e.vigente : e.tipo === "vencida");
    if (q) lista = lista.filter((e) => (nombreCliente(e.cliente_id) + " " + e.pc).toLowerCase().includes(q));
    const orden = (e) => e.tipo === "ilimitada" ? 1e9 : e.dias ?? 1e9;
    lista.sort((a, b) => filtro === "todas" ? 0 : orden(a) - orden(b));
    const vacio = filtro === "vigentes" ? "Aún no hay licencias vigentes. Crea la primera con «Nueva licencia» o importa tu emitidas.csv."
      : filtro === "vencidas" ? "Ninguna licencia vencida." : "Aún no hay licencias.";
    $("#lista-licencias").replaceChildren(...(lista.length ? lista.map(filaLicencia) : [el("li", { class: "vacio" }, vacio)]));
    const nota = $("#nota-llave");
    nota.textContent = D.llave
      ? `Las licencias de este panel se firman con la llave del panel (${D.llave.slice(0, 10)}…). Los clientes las pueden activar desde la versión del programa que ya trae esta llave.`
      : "";
  }

  async function anular(e) {
    if (!confirm(`¿Anular la licencia de ${nombreCliente(e.cliente_id)}?\n\nSu programa la bloquea la próxima vez que se conecte a internet (candado en línea, desde la versión que lo traiga).`)) return;
    const { error } = await sb.from("neg_licencias").update({ estado: "anulada" }).eq("id", e.id);
    if (error) return avisar("No se pudo anular: " + error.message);
    avisar("Licencia anulada");
    cargar();
  }

  async function reactivar(e) {
    const { error } = await sb.from("neg_licencias").update({ estado: "emitida" }).eq("id", e.id);
    if (error) return avisar("No se pudo reactivar: " + error.message);
    avisar("Licencia reactivada");
    cargar();
  }

  async function atenderSolicitud(s) {
    const { error } = await sb.from("web_solicitudes").update({ atendida: true }).eq("id", s.id);
    if (error) return avisar("No se pudo marcar: " + error.message);
    s.atendida = true;
    pintar();
  }

  function llenarSelectsClientes() {
    const opts = (conNuevo) => [
      ...(conNuevo ? [el("option", { value: "nuevo" }, "+ Cliente nuevo")] : [el("option", { value: "" }, "Sin cliente")]),
      ...D.clientes.map((c) => el("option", { value: String(c.id) }, c.nombre + (c.contacto ? " · " + c.contacto : ""))),
    ];
    const s1 = $("#sel-cliente"), v1 = s1.value;
    s1.replaceChildren(...opts(true));
    if (v1) s1.value = v1;
    const s2 = $("#sel-cliente-venta"), v2 = s2.value;
    s2.replaceChildren(...opts(false));
    if (v2) s2.value = v2;
  }

  const fl = $("#form-licencia");
  let renovando = null;
  let solicitudActual = null;

  function precioSugerido() {
    const plan = fl.plan.value;
    const dur = fl.duracion.value;
    if (plan === "dueno" || plan === "prueba") return 0;
    if (plan === "verificados") return dur === "ilimitada" ? "" : PRECIO.verificados * Number(dur);
    return renovando ? "" : PRECIO.no_verificados;
  }
  function actualizarMonto() {
    // persona de prueba: siempre 1 mes y sin pago
    const prueba = fl.plan.value === "prueba";
    if (prueba) fl.duracion.value = "1";
    for (const r of $$("[name=duracion]", fl)) r.disabled = prueba && r.value !== "1";
    $("#fs-pago").hidden = prueba;
    $("#nota-prueba").hidden = !prueba;
    fl.monto.value = precioSugerido();
  }
  fl.plan.addEventListener("change", actualizarMonto);
  for (const r of $$("[name=duracion]", fl)) r.addEventListener("change", actualizarMonto);
  $("#sel-cliente").addEventListener("change", () => {
    $("#cliente-nuevo").hidden = $("#sel-cliente").value !== "nuevo";
  });

  function abrirLicencia({ renovar = null, solicitud = null } = {}) {
    renovando = renovar;
    solicitudActual = solicitud;
    fl.reset();
    fl.hidden = false;
    $("#licencia-lista").hidden = true;
    mostrarError($("#licencia-error"), "");
    llenarSelectsClientes();
    $("#dlg-licencia-titulo").textContent = renovar ? "Renovar licencia" : "Nueva licencia";
    $("#bloque-cliente").hidden = !!renovar;
    $("#renovar-info").hidden = !renovar;
    if (renovar) {
      $("#renovar-info").textContent = `${nombreCliente(renovar.cliente_id)} · PC ${renovar.pc} · ` +
        (renovar.dias >= 0 ? `le quedan ${renovar.dias} días: se suman a los nuevos` : "ya venció: cuenta desde hoy");
      fl.plan.value = renovar.plan;
      if (renovar.meses && [1, 3, 6, 12].includes(renovar.meses)) fl.duracion.value = String(renovar.meses);
    } else if (solicitud) {
      fl.cliente_id.value = "nuevo";
      fl.nombre.value = solicitud.nombre || "";
      fl.contacto.value = solicitud.contacto || "";
      fl.pc.value = solicitud.codigo_pc || "";
      const pw = PLAN_WEB[solicitud.plan];
      if (pw) fl.plan.value = pw.plan;
    } else {
      fl.cliente_id.value = D.clientes.length ? String(D.clientes[0].id) : "nuevo";
    }
    $("#cliente-nuevo").hidden = fl.cliente_id.value !== "nuevo";
    if (fl.plan.value === "no_verificados" && !renovar) fl.duracion.value = "ilimitada";
    if (solicitud && PLAN_WEB[solicitud.plan]) fl.duracion.value = PLAN_WEB[solicitud.plan].duracion;
    actualizarMonto();
    $("#dlg-licencia").showModal();
  }
  for (const b of $$("[data-accion=nueva-licencia]")) b.addEventListener("click", () => abrirLicencia());

  fl.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("#licencia-error");
    mostrarError(err, "");
    let clienteId = renovando ? renovando.cliente_id : fl.cliente_id.value;
    const pc = renovando ? renovando.pc : fl.pc.value.trim();
    if (!renovando) {
      if (clienteId === "nuevo" && !fl.nombre.value.trim()) return mostrarError(err, "Escribe el nombre del dueño");
      const limpio = pc.replace(/[^A-Za-z0-9*]/g, "");
      if (pc !== "*" && limpio.length !== 16) return mostrarError(err, "El código de PC tiene 16 letras o números. Lo ve el cliente en Ajustes → Licencia");
    }
    const dur = fl.duracion.value;
    const monto = fl.monto.value === "" ? 0 : Number(fl.monto.value);
    if (!(monto >= 0)) return mostrarError(err, "El monto no es válido");

    const boton = $("#boton-generar");
    ocupado(boton, true, "Firmando");
    try {
      if (clienteId === "nuevo") {
        const { data, error } = await sb.from("neg_clientes")
          .insert({ nombre: fl.nombre.value.trim(), contacto: fl.contacto.value.trim() || null }).select().single();
        if (error) throw error;
        clienteId = data.id;
        D.clientes.push(data);
      }
      const cuerpo = {
        accion: "emitir", cliente_id: Number(clienteId), pc, plan: fl.plan.value,
        ilimitada: dur === "ilimitada", meses: dur === "ilimitada" ? null : Number(dur),
        renueva_id: renovando ? renovando.id : null,
        venta: monto > 0 && fl.plan.value !== "prueba" ? { monto_usd: monto, metodo: fl.metodo.value, nota: fl.nota.value.trim() } : null,
      };
      const { data, error } = await sb.functions.invoke("neg-licencias", { body: cuerpo });
      if (error) {
        let msg = "No se pudo generar la licencia";
        try { msg = (await error.context.json()).error || msg; } catch { /* sin detalle */ }
        throw new Error(msg);
      }
      if (solicitudActual) await sb.from("web_solicitudes").update({ atendida: true }).eq("id", solicitudActual.id);
      const lic = data.licencia;
      fl.hidden = true;
      $("#licencia-lista").hidden = false;
      $("#licencia-lista-info").textContent = `${nombreCliente(lic.cliente_id)} · PC ${lic.pc} · ` +
        (lic.vence === ILIMITADA ? "sin vencimiento" : "vence el " + fechaCorta(lic.vence));
      $("#licencia-texto").value = lic.licencia;
      $("#licencia-aviso").textContent = data.aviso || "";
      $("#licencia-aviso").hidden = !data.aviso;
      $("#copiar-nueva").onclick = () => copiar(lic.licencia);
      cargar();
    } catch (e) {
      mostrarError(err, e.message || String(e));
    } finally {
      ocupado(boton, false);
    }
  });

  // importar el historial de licencias.bat (%APPDATA%\P2PAutoPay-Dueno\emitidas.csv)
  function leerCsv(texto) {
    const filas = [];
    let fila = [], campo = "", comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (comillas) {
        if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') comillas = false;
        else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === ",") { fila.push(campo); campo = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && texto[i + 1] === "\n") i++;
        fila.push(campo); campo = "";
        if (fila.some((x) => x !== "")) filas.push(fila);
        fila = [];
      } else campo += ch;
    }
    fila.push(campo);
    if (fila.some((x) => x !== "")) filas.push(fila);
    return filas;
  }

  /** Lo que dice la licencia por dentro ({cli, pc, ini, fin}); null si no se puede leer. */
  function datosLicencia(texto) {
    try {
      const b = texto.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const crudo = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(crudo, (c) => c.charCodeAt(0))));
    } catch {
      return null;
    }
  }

  /** "2026-10-16" o "16-10-2026" -> "2026-10-16"; otra cosa -> null */
  function fechaIso(texto) {
    const t = String(texto || "").trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  $("#importar-csv").addEventListener("change", async (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = "";
    if (!archivo) return;
    const filas = leerCsv((await archivo.text()).replace(/^﻿/, ""));
    if (!filas.length) return avisar("El archivo está vacío");
    const cab = filas[0].map((x) => x.trim().toLowerCase());
    const idx = Object.fromEntries(["fecha", "cliente", "pc", "vence", "licencia"].map((k) => [k, cab.indexOf(k)]));
    if (idx.licencia < 0 || idx.pc < 0) return avisar("Ese no parece el emitidas.csv de licencias.bat");
    const yaEstan = new Set(D.licencias.map((l) => l.licencia));
    let nuevas = 0;
    for (const f of filas.slice(1)) {
      const texto = (f[idx.licencia] || "").trim();
      if (!texto.startsWith("P2PA1.") || yaEstan.has(texto)) continue;
      const nombre = (f[idx.cliente] || "Sin nombre").trim().slice(0, 120) || "Sin nombre";
      let cliente = D.clientes.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
      if (!cliente) {
        const { data, error } = await sb.from("neg_clientes").insert({ nombre }).select().single();
        if (error) return avisar("Falló al importar: " + error.message);
        cliente = data;
        D.clientes.push(data);
      }
      // fechas y PC salen de la propia licencia (el csv trae "16-10-2026" e "ilimitada")
      const datos = datosLicencia(texto);
      const pc = String(datos?.pc || f[idx.pc] || "*").trim().toUpperCase();
      const fecha = datos?.ini || fechaIso(f[idx.fecha]);
      const vence = datos?.fin || (/ilimitada/i.test(f[idx.vence] || "") ? ILIMITADA : fechaIso(f[idx.vence]));
      const { error } = await sb.from("neg_licencias").insert({
        cliente_id: cliente.id, pc: pc.slice(0, 64), plan: pc === "*" ? "dueno" : "no_verificados",
        vence, estado: "emitida", pedido: "nueva", licencia: texto,
        ...(fecha ? { creada: fecha + "T12:00:00Z", emitida: fecha + "T12:00:00Z" } : {}),
      });
      if (error) return avisar("Falló al importar: " + error.message);
      yaEstan.add(texto);
      nuevas++;
    }
    avisar(nuevas ? `Importadas ${nuevas} licencias. Anota sus pagos en Ventas si quieres verlos en los ingresos` : "No había licencias nuevas en ese archivo");
    cargar();
  });

  // ---------------------------------------------------------------- clientes
  function pintarClientes(E) {
    const lista = D.clientes.map((c) => {
      const suyas = E.filter((e) => e.cliente_id === c.id);
      const vig = suyas.filter((e) => e.vigente);
      const pagado = D.ventas.filter((v) => v.cliente_id === c.id).reduce((s, v) => s + Number(v.monto_usd), 0);
      const proxima = vig.filter((e) => e.tipo !== "ilimitada").sort((a, b) => a.dias - b.dias)[0];
      return el("li", {},
        el("div", {},
          el("div", { class: "titulo" }, c.nombre),
          el("div", { class: "detalle" }, [c.contacto, `${vig.length} ${vig.length === 1 ? "licencia vigente" : "licencias vigentes"}`, c.notas].filter(Boolean).join(" · "))),
        el("div", { class: "lado" },
          proxima ? chipDias(proxima) : vig.length ? el("span", { class: "chip siempre" }, "Ilimitada") : null,
          el("span", { class: "monto" }, usd(pagado)),
          el("button", { type: "button", class: "boton pequeno", onclick: () => abrirCliente(c) }, "Editar")));
    });
    $("#lista-clientes").replaceChildren(...(lista.length ? lista : [el("li", { class: "vacio" }, "Aún no hay clientes. Se crean solos al generar su licencia.")]));
  }

  let editandoCliente = null;
  function abrirCliente(c = null) {
    editandoCliente = c;
    const f = $("#form-cliente");
    f.reset();
    mostrarError($("#cliente-error"), "");
    $("#dlg-cliente-titulo").textContent = c ? "Editar cliente" : "Nuevo cliente";
    if (c) { f.nombre.value = c.nombre; f.contacto.value = c.contacto || ""; f.notas.value = c.notas || ""; }
    $("#dlg-cliente").showModal();
  }
  $("#nuevo-cliente").addEventListener("click", () => abrirCliente());
  $("#form-cliente").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const datos = { nombre: f.nombre.value.trim(), contacto: f.contacto.value.trim() || null, notas: f.notas.value.trim() || null };
    if (!datos.nombre) return mostrarError($("#cliente-error"), "Escribe el nombre");
    const q = editandoCliente
      ? sb.from("neg_clientes").update(datos).eq("id", editandoCliente.id)
      : sb.from("neg_clientes").insert(datos);
    const { error } = await q;
    if (error) return mostrarError($("#cliente-error"), error.message);
    $("#dlg-cliente").close();
    avisar("Cliente guardado");
    cargar();
  });

  // ---------------------------------------------------------------- ventas
  function pintarVentas() {
    const lista = D.ventas.map((v) => el("li", {},
      el("div", {},
        el("div", { class: "titulo" }, nombreCliente(v.cliente_id)),
        el("div", { class: "detalle" }, [fechaCorta(v.fecha), NOMBRE_PLAN[v.plan] || v.plan, v.metodo, v.nota].filter(Boolean).join(" · "))),
      el("div", { class: "lado" },
        el("span", { class: "monto" }, usd(v.monto_usd)),
        el("button", { type: "button", class: "boton pequeno peligro", onclick: () => borrarVenta(v) }, "Borrar"))));
    $("#lista-ventas").replaceChildren(...(lista.length ? lista : [el("li", { class: "vacio" }, "Aún no hay pagos anotados. Se anotan solos al generar una licencia con monto.")]));
  }

  async function borrarVenta(v) {
    if (!confirm(`¿Borrar el pago de ${usd(v.monto_usd)} de ${nombreCliente(v.cliente_id)}?`)) return;
    const { error } = await sb.from("neg_ventas").delete().eq("id", v.id);
    if (error) return avisar("No se pudo borrar: " + error.message);
    avisar("Pago borrado");
    cargar();
  }

  $("#nueva-venta").addEventListener("click", () => {
    const f = $("#form-venta");
    f.reset();
    llenarSelectsClientes();
    f.fecha.value = hoy();
    f.monto.value = PRECIO.no_verificados;
    mostrarError($("#venta-error"), "");
    $("#dlg-venta").showModal();
  });
  $("#form-venta").plan.addEventListener("change", (ev) => {
    const p = ev.target.value;
    if (PRECIO[p]) $("#form-venta").monto.value = PRECIO[p];
  });
  $("#form-venta").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const monto = Number(f.monto.value);
    if (!(monto > 0)) return mostrarError($("#venta-error"), "Escribe el monto");
    if (!f.fecha.value) return mostrarError($("#venta-error"), "Elige la fecha");
    const { error } = await sb.from("neg_ventas").insert({
      fecha: f.fecha.value, cliente_id: f.cliente_id.value ? Number(f.cliente_id.value) : null,
      plan: f.plan.value, monto_usd: monto, metodo: f.metodo.value, nota: f.nota.value.trim() || null,
    });
    if (error) return mostrarError($("#venta-error"), error.message);
    $("#dlg-venta").close();
    avisar("Pago anotado");
    cargar();
  });

  // ---------------------------------------------------------------- arranque
  async function arrancar() {
    pantalla("cargando");
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return pantalla("entrar");
    const { data: esDueno, error } = await sb.rpc("neg_es_dueno");
    if (error || esDueno !== true) {
      $("#sin-permiso-correo").textContent = session.user.email;
      return pantalla("sin-permiso");
    }
    try {
      await cargar();
      pantalla("panel");
    } catch (e) {
      pantalla("panel");
      avisar("No pude leer los datos: " + (e.message || e));
    }
    // la llave del panel se prepara sola la primera vez
    sb.functions.invoke("neg-licencias", { body: { accion: "llave" } }).then(({ data }) => {
      if (data?.publica) { D.llave = data.publica; pintarLicencias(estados()); }
    });
  }

  // al volver a la pestana (p. ej. en el telefono) se refrescan los datos
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("#panel").hidden) cargar().catch(() => {});
  });

  arrancar();
})();
