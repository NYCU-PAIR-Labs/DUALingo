(async function () {
  /* sticky nav: hairline once scrolled, highlight the section in view */
  const nav = document.getElementById("topnav");
  const links = [...nav.querySelectorAll("nav a")];
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const spy = new IntersectionObserver(
    (es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.hash === "#" + e.target.id));
    }),
    { rootMargin: "-45% 0px -50% 0px" }
  );
  links.forEach((a) => {
    const s = document.querySelector(a.hash);
    if (s) spy.observe(s);
  });

  /* videos: load and play only while on screen (and not at all under reduced motion) */
  const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vio = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && !calm) e.target.play().catch(() => {});
    else e.target.pause();
  }), { rootMargin: "200px" });
  document.querySelectorAll("video[data-autoplay]").forEach((v) => {
    if (calm) v.controls = true;
    vio.observe(v);
  });

  /* explorer: fetched and built only when the section comes near */
  const explore = document.getElementById("explore");
  await new Promise((go) => {
    const o = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { o.disconnect(); go(); }
    }, { rootMargin: "800px 0px" });
    o.observe(explore);
  });
  try {
    if (!document.createElement("canvas").getContext("webgl")) throw new Error("no WebGL");
  } catch (err) {
    explore.querySelector(".explorer").innerHTML =
      '<p class="footnote" style="padding:40px;text-align:center">The 3D viewer needs WebGL, which this browser does not provide.</p>';
    return;
  }
  const [all, selection] = await Promise.all([
    fetch("static/data/objects.json").then((r) => r.json()),
    fetch("static/data/selection.json").then((r) => r.json()),
  ]);
  const byKey = Object.fromEntries(all.map((e) => [e.key, e]));
  const sets = Object.fromEntries(
    Object.entries(selection).map(([k, keys]) => [k, keys.map((key) => byKey[key]).filter(Boolean)])
  );

  const strip = document.getElementById("strip");
  const ex = new DUALingo.Explorer(document.getElementById("explore"), {
    onChange: (i) => {
      strip.querySelectorAll(".thumb").forEach((t, k) => t.classList.toggle("on", k === i));
      const on = strip.children[i];
      if (on) strip.scrollTo({ left: on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2, behavior: "smooth" });
    },
  });

  /* mouse drag scrolls the strip; a click without movement still opens the object.
     Touch keeps the browser's native swipe. */
  let drag = null, dragged = false;
  strip.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    drag = { x: ev.clientX, left: strip.scrollLeft };
    dragged = false;
  });
  window.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    if (!dragged && Math.abs(dx) > 5) {
      dragged = true;
      strip.classList.add("dragging");
    }
    if (dragged) strip.scrollLeft = drag.left - dx;
  });
  window.addEventListener("pointerup", () => {
    drag = null;
    strip.classList.remove("dragging");
  });
  // swallow the click that ends a drag, so dragging never switches the object
  strip.addEventListener("click", (ev) => {
    if (dragged) {
      ev.stopPropagation();
      dragged = false;
    }
  }, true);

  let thumbObs = null;
  function useSet(name) {
    const list = sets[name];
    ex.setList(list);
    strip.innerHTML = list
      .map((e, i) => `<button class="thumb" data-i="${i}"><span class="num">${i + 1}</span><div class="ph"></div><span>${e.name}</span></button>`)
      .join("");
    if (thumbObs) thumbObs.disconnect();
    thumbObs = new IntersectionObserver((es) => es.forEach(async (en) => {
      if (!en.isIntersecting) return;
      thumbObs.unobserve(en.target);
      const e = list[+en.target.dataset.i];
      const url = await DUALingo.thumbnail(e, 0, 208);
      const img = new Image();
      img.src = url;
      img.alt = e.name;
      img.draggable = false;
      en.target.querySelector(".ph").replaceWith(img);
    }), { root: strip, rootMargin: "0px 300px" });
    strip.querySelectorAll(".thumb").forEach((t) => {
      thumbObs.observe(t);
      t.addEventListener("click", () => ex.show(+t.dataset.i));
    });
    ex.show(0);
  }

  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
      useSet(b.dataset.set);
    })
  );
  useSet("annotations");
})();
