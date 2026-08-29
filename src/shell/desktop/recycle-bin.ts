/**
 * Recycle Bin window content. Lists the apps the user dragged into the bin,
 * each with a Restore button; re-renders whenever the hidden list changes.
 * Empty state is one dry line — the bin is a joke and a hiding place, not a feature.
 */
import type { AppSpec } from "./registry";
import type { HiddenApps } from "./hidden";
import { h } from "../util/dom";

export interface RecycleBinOptions {
  apps: AppSpec[];
  hidden: HiddenApps;
}

export function mountRecycleBin(host: HTMLElement, opts: RecycleBinOptions): () => void {
  const root = h("div", { class: "ph-bin" });
  host.append(root);

  const render = () => {
    const ids = opts.hidden.list();
    const rows = ids
      .map((id) => opts.apps.find((a) => a.id === id))
      .filter((a): a is AppSpec => !!a);

    if (rows.length === 0) {
      root.replaceChildren(
        h("p", { class: "ph-bin-empty" },
          h("strong", {}, "Empty. Every hash is accounted for."),
          h("br"),
          "Drag an icon in here to hide it. It comes back when you ask."),
      );
      return;
    }
    root.replaceChildren(
      h("p", { class: "ph-bin-head" }, `${rows.length} hidden ${rows.length === 1 ? "app" : "apps"}. Nothing is deleted; it's just out of the way.`),
      h("ul", { class: "ph-bin-list", "aria-label": "Hidden apps" },
        ...rows.map((app) =>
          h("li", { class: "ph-bin-row" },
            h("img", { src: app.icon, alt: "" }),
            h("span", {}, app.label),
            h("button", {
              class: "ph-bin-restore", type: "button", "aria-label": `Restore ${app.label}`,
              onclick: () => opts.hidden.remove(app.id),
            }, "Restore")))),
    );
  };

  render();
  const unsub = opts.hidden.subscribe(render);
  return () => { unsub(); root.remove(); };
}
