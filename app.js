// Datos de la pagina desde Supabase (proyecto "p2pautopay", tablas web_*).
// La llave publicable solo puede leer planes, videos y ajustes, y solo puede
// insertar solicitudes y descargas: no lee lo que mandan otros visitantes.
// Si Supabase no responde, la pagina se queda con el contenido escrito en el HTML.
const SUPABASE_URL = "https://zgkicomjnrgtjhnjtrxm.supabase.co/rest/v1";
const SUPABASE_LLAVE = "sb_publishable_N-SIwaLCYvcD2CBh2HO9MA_suMsJFWW";
const CABECERAS = { apikey: SUPABASE_LLAVE, "Content-Type": "application/json" };

async function leer(tabla, consulta) {
  const r = await fetch(`${SUPABASE_URL}/${tabla}?${consulta}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`${tabla}: ${r.status}`);
  return r.json();
}

async function insertar(tabla, fila, opciones = {}) {
  const r = await fetch(`${SUPABASE_URL}/${tabla}`, {
    method: "POST",
    headers: { ...CABECERAS, Prefer: "return=minimal" },
    body: JSON.stringify(fila),
    ...opciones,
  });
  if (!r.ok) throw new Error(`${tabla}: ${r.status}`);
}

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

function precio(plan) {
  if (plan.precio_usdt == null) return "Por definir";
  return `$${Number(plan.precio_usdt).toLocaleString("es-VE", { maximumFractionDigits: 2 })}`;
}

async function cargarPlanes() {
  const planes = await leer("web_planes", "select=id,nombre,precio_usdt,periodo,nota,detalle,destacado,proximamente&order=orden");
  const caja = document.getElementById("planes");
  const lista = document.getElementById("solicitud-plan");
  if (!planes.length) return;
  caja.replaceChildren(...planes.map((p) => {
    const tarjeta = crear("article", p.proximamente ? "plan proximamente" : p.destacado ? "plan destacado" : "plan");
    const cabeza = crear("div", "plan-cabeza");
    cabeza.append(crear("h3", null, p.nombre));
    if (p.proximamente) cabeza.append(crear("span", "sello", "Próximamente"));
    const linea = crear("p", "precio");
    linea.append(crear("strong", null, precio(p)), crear("span", null, p.periodo || ""));
    const boton = crear("a", p.proximamente ? "boton boton-secundario" : "boton boton-principal",
      p.proximamente ? "Avísame cuando salga" : "Pedir mi licencia");
    boton.href = "#solicitud";
    boton.dataset.plan = p.id;
    tarjeta.append(cabeza, linea, crear("p", "plan-nota", p.nota || ""), crear("p", "plan-detalle", p.detalle || ""), boton);
    return tarjeta;
  }));
  lista.replaceChildren(...planes.map((p) => {
    const extra = p.proximamente ? " (lista de espera)" : "";
    const op = crear("option", null, `${p.nombre} · ${precio(p)} ${p.periodo || ""}${extra}`);
    op.value = p.id;
    if (p.destacado) op.selected = true;
    return op;
  }));
}

// Los botones de cada plan bajan al formulario con ese plan ya elegido.
function elegirPlanAlPulsar() {
  document.getElementById("planes").addEventListener("click", (e) => {
    const boton = e.target.closest("a[data-plan]");
    if (!boton) return;
    const lista = document.getElementById("solicitud-plan");
    if ([...lista.options].some((o) => o.value === boton.dataset.plan)) lista.value = boton.dataset.plan;
  });
}

async function cargarVideos() {
  const videos = await leer("web_videos", "select=titulo,descripcion,youtube_url,duracion&order=orden");
  const caja = document.getElementById("lista-videos");
  if (!videos.length) return;
  caja.replaceChildren(...videos.map((v) => {
    const listo = Boolean(v.youtube_url);
    const tarjeta = crear(listo ? "a" : "div", listo ? "video" : "video pronto");
    if (listo) { tarjeta.href = v.youtube_url; tarjeta.target = "_blank"; tarjeta.rel = "noopener"; }
    const pantalla = crear("div", "video-pantalla");
    const boton = crear("span", "reproducir");
    boton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg>';
    pantalla.append(boton, crear("span", "duracion", listo ? (v.duracion || "Ver video") : "Próximamente"));
    tarjeta.append(pantalla, crear("h3", null, v.titulo), crear("p", null, v.descripcion || ""));
    return tarjeta;
  }));
}

async function cargarAjustes() {
  const filas = await leer("web_ajustes", "select=clave,valor");
  const ajustes = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  if (ajustes.contacto_ventas) {
    document.querySelectorAll("[data-contacto]").forEach((el) => { el.textContent = ajustes.contacto_ventas; });
    document.getElementById("contacto-directo").hidden = false;
  }
  if (ajustes.version) {
    document.querySelectorAll("[data-version]").forEach((el) => { el.textContent = ajustes.version; });
  }
}

function contarDescargas() {
  document.querySelectorAll("a[data-descarga]").forEach((a) => {
    a.addEventListener("click", () => {
      insertar("web_descargas", { origen: a.dataset.descarga }, { keepalive: true }).catch(() => {});
    });
  });
}

function prepararSolicitud() {
  const form = document.getElementById("solicitud");
  const aviso = document.getElementById("solicitud-aviso");
  const boton = form.querySelector("button");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const datos = new FormData(form);
    const codigo = String(datos.get("codigo_pc") || "").trim().toUpperCase();
    if (codigo && !/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(codigo)) {
      aviso.textContent = "El código de la PC tiene la forma ABCD-1234-EFGH-5678. Lo ves en Ajustes → Licencia.";
      aviso.dataset.tipo = "error";
      return;
    }
    boton.disabled = true;
    aviso.textContent = "Enviando…";
    aviso.dataset.tipo = "";
    try {
      await insertar("web_solicitudes", {
        nombre: String(datos.get("nombre")).trim(),
        contacto: String(datos.get("contacto")).trim(),
        plan: datos.get("plan") || null,
        codigo_pc: codigo || null,
        mensaje: String(datos.get("mensaje") || "").trim() || null,
      });
      form.reset();
      aviso.textContent = "Listo, recibimos tu solicitud. Te escribimos por el contacto que dejaste.";
      aviso.dataset.tipo = "ok";
    } catch {
      aviso.textContent = "No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.";
      aviso.dataset.tipo = "error";
    } finally {
      boton.disabled = false;
    }
  });
}

contarDescargas();
elegirPlanAlPulsar();
prepararSolicitud();
Promise.allSettled([cargarPlanes(), cargarVideos(), cargarAjustes()]);
