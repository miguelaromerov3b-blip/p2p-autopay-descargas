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
  if (caja) caja.replaceChildren(...planes.map((p) => {
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

// Los botones de cada plan (en Licencias y en Descargar) bajan al formulario
// con ese plan ya elegido.
function elegirPlanAlPulsar() {
  document.addEventListener("click", (e) => {
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
}

// Los botones de descarga bajan el instalador directo: de las versiones publicadas
// en GitHub se toma la mas nueva y se pone el enlace de su .exe. Si GitHub no
// responde, el boton sigue llevando a la pagina de la ultima version.
async function enlazarInstalador() {
  const versiones = (await leerVersiones())
    .filter((v) => (v.assets || []).some((a) => a.name.toLowerCase().endsWith(".exe")))
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const version = versiones[0];
  if (!version) return;
  const exe = version.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
  document.querySelectorAll("a[data-descarga]").forEach((a) => { a.href = exe.browser_download_url; });
  const numero = String(version.tag_name || "").replace(/^v/, "");
  if (numero) document.querySelectorAll("[data-version]").forEach((el) => { el.textContent = numero; });
}

// Total publico de descargas: suma lo que GitHub cuenta de cada .exe publicado,
// en todas las versiones. Si GitHub no responde, el contador queda escondido.
let totalDescargas = 0;

function pintarDescargas(total, animar) {
  const siguiente = (total + 1).toLocaleString("es-VE");
  document.querySelectorAll("[data-siguiente]").forEach((el) => { el.textContent = siguiente; });
  const cifras = document.querySelectorAll("[data-descargas]");
  const poner = (n) => cifras.forEach((el) => { el.textContent = n.toLocaleString("es-VE"); });
  if (!animar || matchMedia("(prefers-reduced-motion: reduce)").matches) { poner(total); return; }
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / 1200);
    poner(Math.round(total * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// Todas las versiones publicadas (una sola consulta a GitHub para el contador
// y para las novedades).
let versionesPublicadas = null;
function leerVersiones() {
  versionesPublicadas ??= fetch("https://api.github.com/repos/miguelaromerov3b-blip/p2p-autopay-descargas/releases?per_page=100", {
    headers: { Accept: "application/vnd.github+json" },
  }).then((r) => {
    if (!r.ok) throw new Error(`versiones: ${r.status}`);
    return r.json();
  }).then((lista) => lista.filter((v) => !v.draft && !v.prerelease && v.published_at));
  return versionesPublicadas;
}

async function mostrarTotalDescargas() {
  const versiones = await leerVersiones();
  totalDescargas = versiones.flatMap((v) => v.assets || [])
    .filter((a) => a.name.toLowerCase().endsWith(".exe"))
    .reduce((suma, a) => suma + (a.download_count || 0), 0);
  if (!totalDescargas) return;
  document.querySelectorAll("[data-contador]").forEach((el) => { el.hidden = false; });
  pintarDescargas(totalDescargas, true);
}

// Novedades: las notas de cada version tal como se publican en GitHub, la mas
// nueva arriba. Las lineas tecnicas o la que solo repite el numero no se muestran.
const LINEA_INTERNA = /^versi[oó]n\s+\d|supabase|app_reportes|python|mantis|patron del correo/i;

function notasDe(version) {
  return String(version.body || "").split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l && !LINEA_INTERNA.test(l));
}

function tarjetaCambio(version, reciente) {
  const li = crear("li", reciente ? "cambio reciente" : "cambio");
  const cabeza = crear("div", "cambio-cabeza");
  const numero = String(version.tag_name || "").replace(/^v/, "");
  const fecha = new Date(version.published_at).toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric" });
  cabeza.append(crear("strong", null, `Versión ${numero}`), crear("span", "cambio-fecha", fecha));
  if (reciente) cabeza.append(crear("span", "nueva", "Nueva"));
  const lista = crear("ul");
  lista.append(...notasDe(version).map((n) => crear("li", null, n)));
  li.append(cabeza, lista);
  return li;
}

async function mostrarNovedades() {
  const versiones = (await leerVersiones())
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .filter((v) => notasDe(v).length);
  if (!versiones.length) return;
  const recientes = versiones.slice(0, 3);
  const viejas = versiones.slice(3);
  document.getElementById("cambios-no-verificados")
    .replaceChildren(...recientes.map((v, i) => tarjetaCambio(v, i === 0)));
  const anteriores = document.getElementById("anteriores-no-verificados");
  if (viejas.length) {
    anteriores.querySelector(".cambios").replaceChildren(...viejas.map((v) => tarjetaCambio(v, false)));
    anteriores.hidden = false;
  }
}

// Al pulsar Descargar, el contador suma la descarga del visitante y le da la bienvenida.
let yaSumada = false;
function sumarMiDescarga() {
  if (yaSumada || !totalDescargas) return;
  yaSumada = true;
  totalDescargas += 1;
  pintarDescargas(totalDescargas, false);
  document.querySelectorAll("[data-impulso]").forEach((el) => {
    el.textContent = `¡Bienvenido! Eres la descarga número ${totalDescargas.toLocaleString("es-VE")}.`;
  });
  document.querySelectorAll("[data-descargas]").forEach((el) => {
    el.classList.add("sube");
    setTimeout(() => el.classList.remove("sube"), 300);
  });
}

function contarDescargas() {
  document.querySelectorAll("a[data-descarga]").forEach((a) => {
    a.addEventListener("click", () => {
      sumarMiDescarga();
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
Promise.allSettled([enlazarInstalador(), mostrarTotalDescargas(), mostrarNovedades(), cargarPlanes(), cargarVideos(), cargarAjustes()]);
