/* Explorer = 3D stage + object/task/role panel. Used by index.html and review/candidates.html.
 * Expects inside `root`: .stage, .counter, .obj-name, .obj-meta, .task-list, .roles, .footnote
 */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const SOURCE = { YCB: "YCB", OAKINK2: "OakInk2", "PHYSX-MOBILITY": "PhysX-Mobility" };

  class Explorer {
    constructor(root, opts = {}) {
      this.root = root;
      this.$ = (sel) => root.querySelector(sel);
      this.viewer = new DUALingo.DualViewer(this.$(".stage"), { base: opts.base });
      this.list = [];
      this.onChange = opts.onChange || (() => {});
      this.label = opts.label || ((e, i) => `${String(i + 1).padStart(2, "0")} / ${String(this.list.length).padStart(2, "0")}`);
    }

    setList(entries) {
      this.list = entries;
    }

    async show(i, task = 0) {
      this.i = i;
      const e = this.list[i];
      this.$(".counter").textContent = this.label(e, i);
      this.$(".obj-name").textContent = cap(e.name);
      const isPred = e.group === "S";
      this.$(".obj-meta").innerHTML = isPred
        ? `<span class="chip">${esc(SOURCE[e.source] || e.source)}</span>not in DUALingo`
        : `<span class="chip">Objaverse</span>${e.tasks.length} tasks`;
      this.$(".footnote").textContent = isPred
        ? "Predicted by Dual-Espresso-3D, trained on DUALingo, from the point cloud and the task instruction (no role names). Shown: each role's 10% highest-scoring points."
        : "Annotations from the DUALingo release, generated without human labeling.";
      this.$(".task-list").innerHTML = e.tasks
        .map((t, k) => `<button data-k="${k}"><span>${esc(cap(t.task))}</span><span class="fam">${esc(t.family)}</span></button>`)
        .join("");
      this.$(".task-list").querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => this.setTask(+b.dataset.k))
      );
      await this.viewer.show(e, task);
      this.setTask(task);
      this.onChange(i);
    }

    setTask(k) {
      const e = this.list[this.i];
      this.task = k;
      this.viewer.setTask(k);
      this.$(".task-list").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.k === k));
      const roles = e.tasks[k].roles;
      this.$(".roles").innerHTML = roles
        .map((r, j) => {
          const ab = j === 0 ? "a" : "b";
          const rows = [
            ["target", r.target],
            ["contact region", r.contact_region],
            ["function", r.function],
          ].filter(([, v]) => v);
          return `<div class="role ${ab}">
            <div class="who"><span class="tag"><span class="dot ${ab}"></span>role ${ab}</span><span class="verb">${esc(r.role)}</span></div>
            ${rows.length ? `<dl>${rows.map(([kk, v]) => `<dt>${kk}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
          </div>`;
        })
        .join("");
    }
  }

  DUALingo.Explorer = Explorer;
})();
