import { validateConfig, trace, at, fitBeam, matchWaist } from "./optics.mjs";
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const types = {
  lens: "Thin lens",
  cylindrical: "Cylindrical lens",
  mirror: "Curved mirror",
  flat: "Flat mirror",
  interface: "Refractive interface",
  slab: "Dielectric slab",
  abcd: "ABCD matrix",
};
const defaults = {
  lens: { f: 100 },
  cylindrical: { fx: 100, fy: null },
  mirror: { radius: 200 },
  flat: {},
  interface: { nOut: 1.5, radius: null },
  slab: { nSlab: 1.5, thickness: 20 },
  abcd: { A: 1, B: 0, C: 0, D: 1 },
};
const fields = {
  lens: [["f", "Focal length", "mm"]],
  cylindrical: [
    ["fx", "Focal length x", "mm"],
    ["fy", "Focal length y", "mm"],
  ],
  mirror: [["radius", "Radius", "mm"]],
  flat: [],
  interface: [
    ["nOut", "Output index", ""],
    ["radius", "Radius", "mm"],
  ],
  slab: [
    ["nSlab", "Index", ""],
    ["thickness", "Thickness", "mm"],
  ],
  abcd: [
    ["A", "A", ""],
    ["B", "B", "mm"],
    ["C", "C", "mm⁻¹"],
    ["D", "D", ""],
    ["nOut", "Output index", ""],
  ],
};
const clone = (x) => structuredClone(x);
const base = {
  version: 1,
  name: "Single lens",
  wavelengthNm: 780,
  m2: 1,
  n: 1,
  input: { wx: 0.5, wy: 0.5, zx: 0, zy: 0 },
  end: 500,
  optics: [
    {
      id: "lens-1",
      type: "lens",
      label: "Lens 1",
      z: 150,
      enabled: true,
      f: 100,
    },
  ],
};
const examples = {
  focus: base,
  free: {
    ...base,
    name: "Free propagation",
    input: { wx: 0.1, wy: 0.1, zx: 250, zy: 250 },
    optics: [],
  },
  telescope: {
    ...base,
    name: "Beam expander",
    end: 800,
    optics: [
      {
        id: "lens-1",
        type: "lens",
        label: "Lens 1",
        z: 150,
        enabled: true,
        f: 50,
      },
      {
        id: "lens-2",
        type: "lens",
        label: "Lens 2",
        z: 350,
        enabled: true,
        f: 150,
      },
    ],
  },
  cylindrical: {
    ...base,
    name: "Cylindrical focus",
    optics: [
      {
        id: "lens-1",
        type: "cylindrical",
        label: "Cylinder",
        z: 150,
        enabled: true,
        fx: 100,
        fy: null,
      },
    ],
  },
};
let state = clone(base),
  undo = [],
  redo = [],
  probe = 250,
  view = [0, 500],
  model,
  drag = null,
  fitCandidate = null,
  matchCandidate = null;
let startup = "";
try {
  const encoded = location.hash.slice(1);
  if (encoded) {
    if (encoded.length > 150000)
      throw Error("Shared configuration is too large.");
    state = validateConfig(JSON.parse(decodeURIComponent(encoded)));
    startup = "Loaded configuration from link.";
  } else {
    const stored = localStorage.getItem("gaussian-beam-v1");
    if (stored) state = validateConfig(JSON.parse(stored));
  }
  trace(state);
} catch (e) {
  state = clone(base);
  startup = "Could not load saved configuration: " + e.message;
}
view = [0, state.end];
probe = Math.min(probe, state.end);
function message(text = "", error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#8e3527" : "#565851";
}
function persist() {
  if (location.hash) {
    const url = new URL(location.href);
    url.hash = encodeURIComponent(JSON.stringify(state));
    history.replaceState(null, "", url);
  }
  try {
    localStorage.setItem("gaussian-beam-v1", JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
function commit(candidate, { resetView = false, history = true } = {}) {
  try {
    const checked = validateConfig(candidate);
    trace(checked);
    if (history) {
      undo.push(clone(state));
      if (undo.length > 60) undo.shift();
      redo = [];
    }
    state = checked;
    probe = Math.min(Math.max(0, probe), state.end);
    if (resetView) view = [0, state.end];
    else {
      view = [
        Math.max(0, Math.min(view[0], state.end * 0.99)),
        Math.min(view[1], state.end),
      ];
      if (view[1] <= view[0]) view = [0, state.end];
    }
    const saved = persist();
    message(
      saved
        ? ""
        : "Browser storage is unavailable. Use Save to keep your setup.",
    );
    render();
    return true;
  } catch (e) {
    message(e.message, true);
    return false;
  }
}
function element(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "checked") el.checked = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}
function fmt(v, digits = 4) {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "0";
  return Math.abs(v) < 0.001 || Math.abs(v) > 1e5
    ? v.toExponential(3)
    : Number(v.toPrecision(digits)).toString();
}
function renderInputs() {
  for (const key of ["wavelengthNm", "m2", "n", "end"])
    $(key).value = state[key];
  for (const key of ["wx", "wy", "zx", "zy"]) $(key).value = state.input[key];
  const same =
    state.input.wx === state.input.wy && state.input.zx === state.input.zy;
  $("circular").checked = same;
  $("wy").disabled = same;
  $("zy").disabled = same;
  $("undo").disabled = !undo.length;
  $("redo").disabled = !redo.length;
}
function renderElements() {
  const container = $("elements");
  container.replaceChildren();
  if (!state.optics.length) {
    container.append(
      element(
        "div",
        { class: "empty" },
        "No optical elements. The beam propagates freely.",
      ),
    );
    return;
  }
  for (const optic of state.optics) {
    const row = element("div", { class: "element", "data-id": optic.id });
    const enabled = element("label", { class: "check" });
    const check = element("input", {
      type: "checkbox",
      checked: optic.enabled !== false,
      "aria-label": `Enable ${optic.label}`,
    });
    enabled.append(check);
    check.addEventListener("change", () =>
      editOptic(optic.id, "enabled", check.checked),
    );
    row.append(enabled);
    const name = element("label", { class: "name" }, "Name");
    const nameInput = element("input", {
      value: optic.label,
      maxlength: 60,
      "aria-label": "Element name",
    });
    name.append(nameInput);
    nameInput.addEventListener("change", () =>
      editOptic(optic.id, "label", nameInput.value),
    );
    row.append(
      name,
      element("span", { class: "element-kind" }, types[optic.type]),
    );
    const pos = element("label", { class: "position" }, "Position · mm");
    const pinput = element("input", {
      type: "number",
      step: "any",
      min: 0,
      max: state.end,
      value: optic.z,
      "aria-label": `${optic.label} position (mm)`,
    });
    pos.append(pinput);
    pinput.addEventListener("change", () =>
      editOptic(optic.id, "z", pinput.valueAsNumber),
    );
    row.append(pos);
    const controls = element("div", { class: "element-fields" });
    for (const [key, title, unit] of fields[optic.type]) {
      const l = element("label", {}, title + (unit ? " · " + unit : ""));
      const nullable =
        ["fx", "fy", "radius"].includes(key) && optic.type !== "mirror";
      const optional = nullable || (key === "nOut" && optic.type === "abcd");
      const inp = element("input", {
        type: "number",
        step: "any",
        value: optic[key] ?? "",
        placeholder: nullable ? "∞" : optional ? "same" : "",
        "aria-label": `${optic.label} ${title}`,
      });
      l.append(inp);
      inp.addEventListener("change", () =>
        editOptic(
          optic.id,
          key,
          optional && inp.value === "" ? null : inp.valueAsNumber,
        ),
      );
      controls.append(l);
    }
    row.append(controls);
    const actions = element("div", { class: "element-actions" });
    const duplicate = element(
      "button",
      { "aria-label": `Duplicate ${optic.label}`, title: "Duplicate" },
      "⧉",
    );
    duplicate.onclick = () => {
      const c = clone(state),
        copy = clone(optic);
      copy.id = crypto.randomUUID();
      copy.z = Math.min(state.end - (copy.thickness || 0), copy.z + 25);
      copy.label = optic.label + " copy";
      c.optics.push(copy);
      commit(c);
    };
    const remove = element(
      "button",
      { "aria-label": `Remove ${optic.label}`, title: "Remove" },
      "×",
    );
    remove.onclick = () => {
      const c = clone(state);
      c.optics = c.optics.filter((o) => o.id !== optic.id);
      commit(c);
    };
    actions.append(duplicate, remove);
    row.append(actions);
    container.append(row);
  }
}
function editOptic(id, key, value) {
  const candidate = clone(state);
  const optic = candidate.optics.find((o) => o.id === id);
  if (optic.type === "abcd" && key === "nOut" && value === null)
    delete optic.nOut;
  else optic[key] = value;
  commit(candidate);
}
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
let plotScale;
function drawPlot() {
  const svg = $("plot");
  const width = Math.max(280, $("plot-wrap").clientWidth),
    height = $("plot-wrap").clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const pad = { l: 52, r: 18, t: 44, b: 38 },
    pw = width - pad.l - pad.r,
    ph = height - pad.t - pad.b,
    cy = pad.t + ph / 2;
  const samples = model.samples.filter((p) => p.z >= view[0] && p.z <= view[1]);
  samples.push(at(state, view[0]), at(state, view[1]));
  let ymax = Math.max(...samples.map((p) => Math.max(p.wX, p.wY))) * 1.15;
  if (!Number.isFinite(ymax) || ymax <= 0) ymax = 1;
  const X = (z) => pad.l + ((z - view[0]) / (view[1] - view[0])) * pw,
    Y = (w) => cy - ((w / ymax) * ph) / 2;
  plotScale = { width, height, pad, pw, ph, X, Y, view: [...view] };
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: "plot-clip" });
  clip.append(svgEl("rect", { x: pad.l, y: pad.t, width: pw, height: ph }));
  defs.append(clip);
  const gradient = svgEl("linearGradient", {
    id: "beam-fill",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1,
  });
  gradient.append(
    svgEl("stop", {
      offset: "0%",
      "stop-color": "#975c3e",
      "stop-opacity": 0.08,
    }),
    svgEl("stop", {
      offset: "50%",
      "stop-color": "#975c3e",
      "stop-opacity": 0.27,
    }),
    svgEl("stop", {
      offset: "100%",
      "stop-color": "#975c3e",
      "stop-opacity": 0.08,
    }),
  );
  defs.append(gradient);
  svg.append(defs);
  const ticks = width < 500 ? 4 : 8;
  for (let i = 0; i <= ticks; i++) {
    const z = view[0] + (i / ticks) * (view[1] - view[0]),
      x = X(z);
    svg.append(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: pad.t,
        y2: height - pad.b,
        stroke: "#ddddd5",
      }),
      svgEl(
        "text",
        { x, y: height - pad.b + 20, "text-anchor": "middle" },
        fmt(z, 6),
      ),
    );
  }
  for (let i = -2; i <= 2; i++) {
    const w = (ymax * i) / 2,
      y = Y(w);
    svg.append(
      svgEl("line", {
        x1: pad.l,
        x2: width - pad.r,
        y1: y,
        y2: y,
        stroke: i === 0 ? "#999b92" : "#ddddd5",
        "stroke-dasharray": i === 0 ? "4 4" : "none",
      }),
      svgEl(
        "text",
        { x: pad.l - 8, y: y + 4, "text-anchor": "end" },
        fmt(w, 3),
      ),
    );
  }
  svg.append(
    svgEl("text", { x: pad.l, y: 17 }, "radius · mm"),
    svgEl(
      "text",
      { x: width - pad.r, y: height - 1, "text-anchor": "end" },
      "position · mm",
    ),
  );
  const data = svgEl("g", { "clip-path": "url(#plot-clip)" });
  const paths = model.segments
    .map((segment) => {
      const lo = Math.max(view[0], segment.start),
        hi = Math.min(view[1], segment.end);
      if (hi < lo) return null;
      const n = Math.max(2, Math.ceil(((hi - lo) / (view[1] - view[0])) * 500));
      const pts = [];
      const positions = Array.from(
        { length: n + 1 },
        (_, j) => lo + ((hi - lo) * j) / n,
      );
      for (const q of [segment.qx, segment.qy]) {
        const waist = segment.start - q.re;
        if (waist > lo && waist < hi) positions.push(waist);
      }
      positions.sort((a, b) => a - b);
      for (const z of positions) {
        const qx = { re: segment.qx.re + z - segment.start, im: segment.qx.im },
          qy = { re: segment.qy.re + z - segment.start, im: segment.qy.im };
        const k =
          (state.m2 * state.wavelengthNm * 1e-6) / (Math.PI * segment.n);
        pts.push({
          z,
          wX: Math.sqrt((k * (qx.re * qx.re + qx.im * qx.im)) / qx.im),
          wY: Math.sqrt((k * (qy.re * qy.re + qy.im * qy.im)) / qy.im),
        });
      }
      return pts;
    })
    .filter(Boolean);
  for (const pts of paths) {
    for (const [axis, color, dash] of [
      ["wX", "#905230", ""],
      ["wY", "#27666a", "6 4"],
    ]) {
      for (const sign of [1, -1]) {
        const d = pts
          .map((p, i) => `${i ? "L" : "M"}${X(p.z)},${Y(sign * p[axis])}`)
          .join(" ");
        data.append(
          svgEl("path", {
            d,
            fill: "none",
            stroke: color,
            "stroke-width": 1.8,
            "stroke-dasharray": dash,
          }),
        );
      }
      if (axis === "wX") {
        const d =
          pts.map((p, i) => `${i ? "L" : "M"}${X(p.z)},${Y(p.wX)}`).join(" ") +
          pts
            .toReversed()
            .map((p) => `L${X(p.z)},${Y(-p.wX)}`)
            .join(" ") +
          "Z";
        data.prepend(svgEl("path", { d, fill: "url(#beam-fill)" }));
      }
    }
  }
  if (probe >= view[0] && probe <= view[1])
    data.append(
      svgEl("line", {
        x1: X(probe),
        x2: X(probe),
        y1: pad.t,
        y2: height - pad.b,
        stroke: "#373b34",
        "stroke-width": 1,
        "stroke-dasharray": "2 4",
      }),
    );
  svg.append(data);
  for (const optic of state.optics) {
    if (optic.z < view[0] || optic.z > view[1]) continue;
    const x = X(optic.z),
      g = svgEl("g", {
        class: "optic",
        tabindex: "0",
        role: "slider",
        "aria-label": `${optic.label} position`,
        "aria-valuemin": 0,
        "aria-valuemax": state.end,
        "aria-valuenow": optic.z,
        "data-id": optic.id,
        opacity: optic.enabled === false ? 0.35 : 1,
      });
    g.append(
      svgEl("rect", {
        x: x - 13,
        y: pad.t,
        width: 26,
        height: ph,
        fill: "transparent",
      }),
    );
    if (optic.type === "slab")
      g.append(
        svgEl("rect", {
          x,
          y: pad.t + 5,
          width: Math.max(2, X(optic.z + optic.thickness) - x),
          height: ph - 10,
          fill: "#27666a16",
          stroke: "#27666a",
        }),
      );
    g.append(
      svgEl("line", {
        class: "optic-line",
        x1: x,
        x2: x,
        y1: pad.t + 5,
        y2: height - pad.b - 5,
        stroke: "#555a51",
        "stroke-width": 2,
      }),
    );
    if (["lens", "cylindrical"].includes(optic.type)) {
      const inward = (optic.f ?? optic.fx ?? optic.fy) > 0;
      g.append(
        svgEl("path", {
          d: `M${x - 5},${pad.t + (inward ? 12 : 5)}L${x},${pad.t + (inward ? 5 : 12)}L${x + 5},${pad.t + (inward ? 12 : 5)} M${x - 5},${height - pad.b - (inward ? 12 : 5)}L${x},${height - pad.b - (inward ? 5 : 12)}L${x + 5},${height - pad.b - (inward ? 12 : 5)}`,
          stroke: "#555a51",
          fill: "none",
          "stroke-width": 2,
        }),
      );
    }
    g.append(
      svgEl(
        "text",
        { x, y: pad.t - 11, "text-anchor": "middle" },
        optic.label.length > 16 ? optic.label.slice(0, 15) + "…" : optic.label,
      ),
    );
    g.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      drag = { id: optic.id, before: clone(state), last: clone(state) };
      svg.setPointerCapture(event.pointerId);
    });
    g.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const value =
        optic.z +
        (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1);
      if (
        commit({
          ...state,
          optics: state.optics.map((o) =>
            o.id === optic.id
              ? { ...o, z: Math.max(0, Math.min(state.end, value)) }
              : o,
          ),
        })
      )
        svg.querySelector(`[data-id="${CSS.escape(optic.id)}"]`)?.focus();
    });
    svg.append(g);
  }
}
function pair(a, b, unit) {
  return `x ${fmt(a)} ${unit}\ny ${fmt(b)} ${unit}`;
}
function readout() {
  const r = at(state, probe);
  $("probe").value = Number(probe.toFixed(3));
  $("probe").max = state.end;
  $("probe-range").max = state.end;
  $("probe-range").value = probe;
  $("medium").textContent = `n = ${fmt(r.n)}`;
  for (const [id, a, b, unit] of [
    ["read-radius", r.wX, r.wY, "mm"],
    ["read-curvature", r.rX, r.rY, "mm"],
    ["read-waist", r.waistX, r.waistY, "mm"],
    ["read-waist-z", r.waistZX, r.waistZY, "mm"],
  ]) {
    $(id).textContent = pair(a, b, unit);
    $(id).style.whiteSpace = "pre-line";
  }
  const canvas = $("spot"),
    ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height,
    extent = 1.8 * Math.max(r.wX, r.wY),
    image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = ((x - w / 2) / (h / 2)) * extent,
        yy = ((y - h / 2) / (h / 2)) * extent;
      const t = Math.exp(-2 * ((xx * xx) / r.wX ** 2 + (yy * yy) / r.wY ** 2));
      const i = (y * w + x) * 4;
      image.data[i] = Math.round(244 + (151 - 244) * t);
      image.data[i + 1] = Math.round(243 + (92 - 243) * t);
      image.data[i + 2] = Math.round(239 + (62 - 239) * t);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  $("spot-label").textContent = `height ${fmt(2 * extent, 3)} mm · peak = 1`;
}
function render() {
  model = trace(state);
  renderInputs();
  renderElements();
  drawPlot();
  readout();
}
function setProbe(z) {
  if (!Number.isFinite(z) || z < 0 || z > state.end) {
    message(`Probe position must be between 0 and ${state.end} mm.`, true);
    return;
  }
  probe = z;
  drawPlot();
  readout();
}
for (const key of ["wavelengthNm", "m2", "n", "end", "wx", "wy", "zx", "zy"])
  $(key).addEventListener("change", () => {
    const c = clone(state);
    if (key in c.input) {
      c.input[key] = $(key).valueAsNumber;
      if ($("circular").checked && ["wx", "zx"].includes(key))
        c.input[key === "wx" ? "wy" : "zy"] = c.input[key];
    } else c[key] = $(key).valueAsNumber;
    commit(c, { resetView: key === "end" });
  });
$("circular").onchange = () => {
  if ($("circular").checked) {
    const c = clone(state);
    c.input.wy = c.input.wx;
    c.input.zy = c.input.zx;
    commit(c);
  } else {
    $("wy").disabled = false;
    $("zy").disabled = false;
  }
};
$("preset").onchange = () => {
  const key = $("preset").value;
  if (examples[key]) commit(clone(examples[key]), { resetView: true });
  $("preset").value = "";
};
$("add").onclick = () => {
  const type = $("add-type").value;
  const c = clone(state);
  let z = state.optics.length
    ? Math.min(
        state.end - 25,
        Math.max(...state.optics.map((o) => o.z + (o.thickness || 0))) + 50,
      )
    : state.end / 3;
  z = Math.max(0, z);
  c.optics.push({
    id: crypto.randomUUID(),
    type,
    label: types[type],
    z: Number(z.toFixed(2)),
    enabled: true,
    ...defaults[type],
  });
  commit(c);
};
$("undo").onclick = () => {
  if (!undo.length) return;
  const previous = undo.pop();
  redo.push(clone(state));
  commit(previous, { history: false, resetView: true });
};
$("redo").onclick = () => {
  if (!redo.length) return;
  const next = redo.pop();
  undo.push(clone(state));
  commit(next, { history: false, resetView: true });
};
document.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "z" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
  }
});
$("probe").onchange = () => setProbe($("probe").valueAsNumber);
$("probe-range").oninput = () => setProbe(Number($("probe-range").value));
function plotPosition(e) {
  const rect = $("plot").getBoundingClientRect();
  return (
    plotScale.view[0] +
    ((((e.clientX - rect.left) * plotScale.width) / rect.width -
      plotScale.pad.l) /
      plotScale.pw) *
      (plotScale.view[1] - plotScale.view[0])
  );
}
$("plot").addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".optic"))
    setProbe(Math.max(0, Math.min(state.end, plotPosition(e))));
});
$("plot").addEventListener("pointermove", (e) => {
  if (!drag) return;
  const c = clone(drag.before),
    o = c.optics.find((o) => o.id === drag.id);
  o.z =
    Math.round(
      Math.max(
        0,
        Math.min(
          state.end - (o.type === "slab" ? o.thickness : 0),
          plotPosition(e),
        ),
      ) * 10,
    ) / 10;
  try {
    state = validateConfig(c);
    model = trace(state);
    drag.last = clone(state);
    drawPlot();
    readout();
    message();
  } catch (error) {
    state = clone(drag.last);
    message(error.message, true);
  }
});
function endDrag() {
  if (!drag) return;
  const before = drag.before;
  drag = null;
  if (JSON.stringify(before) !== JSON.stringify(state)) {
    undo.push(before);
    redo = [];
    if (!persist())
      message("Browser storage is unavailable. Use Save to keep your setup.");
  }
  render();
}
$("plot").addEventListener("pointerup", endDrag);
$("plot").addEventListener("pointercancel", endDrag);
function zoom(factor) {
  const span = Math.min(
    state.end,
    Math.max(state.end / 1000, (view[1] - view[0]) * factor),
  );
  let start = probe - span / 2;
  start = Math.min(Math.max(0, start), state.end - span);
  view = [start, start + span];
  drawPlot();
}
$("zoom-in").onclick = () => zoom(0.5);
$("zoom-out").onclick = () => zoom(2);
$("view-reset").onclick = () => {
  view = [0, state.end];
  drawPlot();
};
new ResizeObserver(() => {
  if (model) drawPlot();
}).observe($("plot-wrap"));
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = element("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () =>
  download(
    JSON.stringify(state, null, 2),
    "application/json",
    "gaussian-beam.json",
  );
$("load").onclick = () => $("file-input").click();
$("file-input").onchange = async () => {
  const file = $("file-input").files[0];
  if (!file) return;
  try {
    if (file.size > 200000) throw Error("Configuration exceeds 200 KB.");
    const next = JSON.parse(await file.text());
    if (commit(next, { resetView: true })) message("Configuration opened.");
  } catch (e) {
    message("Cannot open configuration: " + e.message, true);
  }
  $("file-input").value = "";
};
$("share").onclick = async () => {
  const url = new URL(location.href);
  url.hash = encodeURIComponent(JSON.stringify(state));
  try {
    await navigator.clipboard.writeText(url.href);
    message("Configuration link copied.");
  } catch {
    history.replaceState(null, "", url);
    message("Configuration added to the address bar. Copy that URL to share.");
  }
};
$("export-svg").onclick = () => {
  const copy = $("plot").cloneNode(true);
  copy.setAttribute("xmlns", NS);
  copy.setAttribute("width", plotScale.width);
  copy.setAttribute("height", plotScale.height);
  copy.prepend(
    svgEl("rect", { width: "100%", height: "100%", fill: "#f4f3ef" }),
  );
  copy.querySelectorAll("text").forEach((t) => {
    t.setAttribute("font-family", "Helvetica, Arial, sans-serif");
    t.setAttribute("font-size", "12");
    t.setAttribute("fill", "#565851");
  });
  download(
    new XMLSerializer().serializeToString(copy),
    "image/svg+xml",
    "beam-envelope.svg",
  );
};
$("export-csv").onclick = () => {
  const head =
    "z_mm,n,w_x_mm,w_y_mm,R_x_mm,R_y_mm,local_waist_x_mm,local_waist_y_mm,local_waist_z_x_mm,local_waist_z_y_mm";
  const rows = model.samples.map((r) =>
    [r.z, r.n, r.wX, r.wY, r.rX, r.rY, r.waistX, r.waistY, r.waistZX, r.waistZY]
      .map((v) => (Number.isFinite(v) ? v : "Infinity"))
      .join(","),
  );
  download([head, ...rows].join("\n"), "text/csv", "beam-profile.csv");
};
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => $(button.dataset.close).close();
$("help").onclick = () => $("help-dialog").showModal();
$("fit-open").onclick = () => {
  fitCandidate = null;
  $("fit-apply").disabled = true;
  $("fit-result").textContent = "";
  $("fit-dialog").showModal();
};
$("fit-form").onsubmit = (e) => {
  e.preventDefault();
  fitCandidate = null;
  $("fit-apply").disabled = true;
  try {
    const rows = $("fit-data")
      .value.trim()
      .split(/\n+/)
      .filter((s) => s.trim());
    if (rows.length > 1000) throw Error("Use at most 1,000 measurements.");
    const points = rows.map((row, i) => {
      const values = row
        .trim()
        .split(/[,;\s]+/)
        .map(Number);
      if (values.length !== 2 || values.some((v) => !Number.isFinite(v)))
        throw Error(`Line ${i + 1}: enter position and size.`);
      return {
        z: values[0],
        w: values[1] / ($("fit-kind").value === "diameter" ? 2 : 1),
      };
    });
    const result = fitBeam(points, state.wavelengthNm, state.n, state.m2);
    fitCandidate = {
      result,
      axis: $("fit-axis").value,
      source: JSON.stringify(state),
    };
    $("fit-result").textContent =
      `Waist radius ${fmt(result.w0)} mm at ${fmt(result.z0)} mm. Radius RMS residual ${fmt(result.rmse)} mm.`;
    $("fit-apply").disabled = false;
  } catch (error) {
    $("fit-result").textContent = error.message;
  }
};
for (const id of ["fit-data", "fit-kind", "fit-axis"])
  $(id).addEventListener("input", () => {
    fitCandidate = null;
    $("fit-apply").disabled = true;
    $("fit-result").textContent = "";
  });
$("fit-apply").onclick = () => {
  if (!fitCandidate) return;
  const { result, axis, source } = fitCandidate;
  if (source !== JSON.stringify(state)) {
    $("fit-result").textContent = "Beam settings changed. Fit again.";
    return;
  }
  const c = clone(state);
  if (axis === "both" || axis === "x") {
    c.input.wx = result.w0;
    c.input.zx = result.z0;
  }
  if (axis === "both" || axis === "y") {
    c.input.wy = result.w0;
    c.input.zy = result.z0;
  }
  if (commit(c)) $("fit-dialog").close();
};
$("match-open").onclick = () => {
  matchCandidate = null;
  $("match-apply").disabled = true;
  $("match-result").textContent = "";
  $("target-z").value = state.end * 0.8;
  $("match-max").value = state.end * 0.75;
  const box = $("match-lenses");
  box.replaceChildren(element("legend", {}, "Lenses to move"));
  const lenses = state.optics.filter(
    (o) => o.type === "lens" && o.enabled !== false,
  );
  for (const [oIndex, o] of lenses.entries()) {
    const l = element("label", { class: "check" }),
      input = element("input", {
        type: "checkbox",
        value: o.id,
        checked: oIndex < 2,
      });
    l.append(input, document.createTextNode(o.label));
    box.append(l);
  }
  if (!lenses.length)
    box.append(element("p", {}, "Add a thin lens to use waist matching."));
  $("match-dialog").showModal();
};
$("match-form").addEventListener("input", () => {
  matchCandidate = null;
  $("match-apply").disabled = true;
  $("match-result").textContent = "";
});
$("match-form").onsubmit = async (e) => {
  e.preventDefault();
  matchCandidate = null;
  $("match-apply").disabled = true;
  const button = $("match-form").querySelector("[type=submit]");
  button.disabled = true;
  $("match-result").textContent = "Searching lens positions…";
  await new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
  try {
    const lensIds = [
      ...$("match-lenses").querySelectorAll("input:checked"),
    ].map((i) => i.value);
    if (lensIds.length < 1 || lensIds.length > 2)
      throw Error("Select one or two thin lenses.");
    const lo = $("match-min").valueAsNumber,
      hi = $("match-max").valueAsNumber;
    const result = matchWaist(state, {
      targetZ: $("target-z").valueAsNumber,
      targetW: $("target-w").valueAsNumber,
      lensIds,
      bounds: lensIds.map(() => [lo, hi]),
    });
    matchCandidate = { result, source: JSON.stringify(state) };
    const positions = result.positions
      .map(
        (p) =>
          `${state.optics.find((o) => o.id === p.id).label}: ${fmt(p.z)} mm`,
      )
      .join("; ");
    $("match-result").textContent =
      `${positions}. Gaussian overlap metric ${(result.overlap * 100).toFixed(3)}%. ${result.converged ? "Target matched." : "Best candidate; target is not exactly matched."}`;
    $("match-apply").disabled = false;
  } catch (error) {
    $("match-result").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("match-apply").onclick = () => {
  if (!matchCandidate) return;
  if (matchCandidate.source !== JSON.stringify(state)) {
    $("match-result").textContent = "Bench changed. Search again.";
    return;
  }
  if (commit(matchCandidate.result.config)) {
    $("match-dialog").close();
    setProbe($("target-z").valueAsNumber);
  }
};
window.addEventListener("hashchange", () => {
  if (!location.hash) return;
  try {
    const encoded = location.hash.slice(1);
    if (encoded.length > 150000) throw Error("Shared configuration is too large.");
    commit(JSON.parse(decodeURIComponent(encoded)), { resetView: true });
  } catch (error) {
    message("Cannot open shared configuration: " + error.message, true);
  }
});
render();
message(startup);
