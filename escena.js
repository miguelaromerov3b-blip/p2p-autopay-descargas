// Animacion del inicio: una compra real de 100 USDT que el bot paga sola.
// Sin JavaScript, o con "reducir movimiento", queda el estado final (orden completada).
// Solo corre mientras la escena esta a la vista, para no gastar en PCs modestas.
(() => {
  const escena = document.getElementById("escena");
  if (!escena || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const $ = (s) => escena.querySelector(s);
  const chip = $("[data-chip]");
  const pago = $("[data-pago]");
  const banco = $("[data-banco]");
  const progreso = $("[data-progreso]");
  const bancoEstado = $("[data-banco-estado]");
  const boton = $("[data-boton]");
  const log = $("[data-log]");
  const crono = $("[data-crono]");
  const mensajes = [...escena.querySelectorAll("[data-msg]")];
  const lineas = [...log.children].map((li) => li.cloneNode(true));
  const mensaje = (n) => mensajes.find((m) => m.dataset.msg === String(n));

  let relojes = [];
  let cuadro = 0;
  let aLaVista = false;
  let esperando = true;

  function ponerCrono(s) {
    crono.textContent = `00:${String(Math.round(s)).padStart(2, "0")}`;
  }

  function correrCrono(desde, hasta, ms) {
    cancelAnimationFrame(cuadro);
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / ms);
      ponerCrono(desde + (hasta - desde) * t);
      if (t < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
  }

  function ponerChip(clase, texto) {
    chip.className = `chip ${clase}`;
    chip.textContent = texto;
  }

  function mostrar(n) {
    const m = mensaje(n);
    m.classList.add("visible", "entrando");
    requestAnimationFrame(() => requestAnimationFrame(() => m.classList.remove("entrando")));
  }

  function linea(i) {
    log.append(lineas[i].cloneNode(true));
  }

  function guardarBanco() {
    banco.style.transition = "none";
    banco.className = "banco";
    banco.style.transform = "";
    void banco.offsetWidth;
    banco.style.transition = "";
  }

  function reiniciar() {
    mensajes.forEach((m) => {
      m.classList.toggle("visible", m.dataset.msg === "0");
      m.style.visibility = "";
    });
    log.replaceChildren();
    ponerChip("chip-pend", "Pendiente de pago");
    boton.classList.remove("hecho", "pulsado");
    pago.classList.remove("leyendo");
    guardarBanco();
    progreso.style.transition = "none";
    progreso.style.transform = "scaleX(0)";
    bancoEstado.textContent = "Enviando transferencia…";
    ponerCrono(0);
  }

  // El comprobante sale del banco y "vuela" hasta el chat de la orden.
  function volar() {
    const destino = mensaje(5);
    destino.classList.add("visible");
    destino.style.visibility = "hidden";
    const a = banco.getBoundingClientRect();
    const b = destino.querySelector(".mini-recibo").getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    banco.classList.add("volando");
    banco.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px) scale(${b.width / a.width})`;
    relojes.push(setTimeout(() => {
      guardarBanco();
      destino.style.visibility = "";
      destino.classList.add("entrando");
      requestAnimationFrame(() => requestAnimationFrame(() => destino.classList.remove("entrando")));
      correrCrono(33, 36, 600);
      linea(5);
    }, 720));
  }

  const guion = [
    [300, () => linea(0)],
    [1400, () => {
      pago.classList.remove("leyendo");
      void pago.offsetWidth;
      pago.classList.add("leyendo");
      correrCrono(0, 2, 800);
      linea(1);
    }],
    [2800, () => {
      pago.classList.remove("leyendo");
      banco.classList.add("visible");
      linea(2);
      ponerCrono(3);
      requestAnimationFrame(() => {
        progreso.style.transition = "transform 2.4s cubic-bezier(.3, .1, .3, 1)";
        progreso.style.transform = "scaleX(1)";
      });
      correrCrono(3, 31, 2400);
    }],
    [5400, () => {
      banco.classList.add("exito");
      bancoEstado.textContent = "Transferencia exitosa";
      linea(3);
    }],
    [6600, () => {
      banco.classList.add("flash");
      correrCrono(31, 33, 500);
      linea(4);
    }],
    [7600, volar],
    [9400, () => boton.classList.add("pulsado")],
    [9650, () => {
      boton.classList.remove("pulsado");
      boton.classList.add("hecho");
      ponerChip("chip-pago", "Pagado");
      mostrar(6);
      correrCrono(36, 38, 400);
      linea(6);
    }],
    [11800, () => {
      ponerChip("chip-ok", "Completada");
      mostrar(7);
    }],
    [16500, () => ciclo()],
  ];

  function ciclo() {
    relojes.forEach(clearTimeout);
    relojes = [];
    if (!aLaVista || document.hidden) {
      esperando = true;
      return;
    }
    esperando = false;
    reiniciar();
    for (const [ms, accion] of guion) relojes.push(setTimeout(accion, ms));
  }

  new IntersectionObserver(([e]) => {
    aLaVista = e.isIntersecting;
    if (aLaVista && esperando) ciclo();
  }, { threshold: 0.3 }).observe(escena);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && aLaVista && esperando) ciclo();
  });
})();
