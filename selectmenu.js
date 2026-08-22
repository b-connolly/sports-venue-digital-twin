/**
 * A dark drop-down for the analysis widget's unit pickers.
 *
 * Those pickers are plain native `<select>` elements. Styling the closed
 * control works; styling the open list does not. The list is painted by the
 * browser, not by the page, and on Windows Chrome it comes out on the light
 * system scheme whatever the page asks for: the element computes
 * `color-scheme: dark`, its options compute a dark `background-color`, and the
 * menu still opens white. The option text inherits our pale ink, so the result
 * is pale grey on white and effectively unreadable. There is no CSS fix,
 * because no selector reaches a native popup.
 *
 * So this suppresses the popup and draws its own list instead.
 *
 * The select is not where you would expect it. The widget renders a
 * `<calcite-select>`, and the real `<select>` sits inside that element's shadow
 * root - which is why the first version of this never found it, and why the
 * element already computing `color-scheme: dark` changes nothing. Finding it
 * means walking shadow roots, and being told when one appears means observing
 * those roots too: a MutationObserver on the light DOM hears nothing about what
 * happens inside a shadow.
 *
 * Nothing about the `<select>` is changed - not its classes, not its markup,
 * not its place in the DOM. That matters: the widget re-renders its content
 * whenever the measurement updates, and an earlier version of this wrapped the
 * select in an element of its own, which the widget's reconciler promptly
 * unpicked and put the native control back on screen. Adding listeners is the
 * one kind of change a virtual DOM will not undo, and
 * `mousedown.preventDefault()` is what stops the browser opening its menu.
 */

const MENU_MAX = 230;        // px; the list scrolls past this
const GAP = 6;               // px between the control and the list

// Selects already taken over, and the lists parented to the body, so one whose
// select the widget has since thrown away can be cleaned up.
const dressed = new WeakSet();
const live = new Set();
const watched = new WeakSet();

function dress(select) {
  if (dressed.has(select)) return;
  dressed.add(select);

  const list = document.createElement("div");
  list.className = "upick__list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  document.body.appendChild(list);
  live.add({ select, list });

  let rows = [];
  let opened = 0;            // the index the list was opened on, for Escape

  function build() {
    list.textContent = "";
    rows = Array.from(select.options).map((opt, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "upick__opt";
      row.textContent = opt.textContent;
      row.setAttribute("role", "option");
      // pointerdown rather than click: the document handler that closes the
      // list also runs on pointerdown, and would take the row away first.
      row.addEventListener("pointerdown", (e) => { e.preventDefault(); commit(i); });
      list.appendChild(row);
      return row;
    });
    mark();
  }

  function mark() {
    const i = select.selectedIndex;
    rows.forEach((row, n) => {
      row.classList.toggle("on", n === i);
      row.setAttribute("aria-selected", String(n === i));
    });
  }

  /** Move the highlight without telling anybody yet. */
  function highlight(i) {
    select.selectedIndex = Math.max(0, Math.min(rows.length - 1, i));
    mark();
    rows[select.selectedIndex]?.scrollIntoView({ block: "nearest" });
  }

  function commit(i) {
    const changed = i !== opened;
    select.selectedIndex = i;
    close();
    // The widget listens for `change`, which only fires for real interaction -
    // setting the value from script does not raise it.
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Pin the list to the control: below if there is room, above if not. The
   * analysis panel sits low on the screen, so above is the usual case. The list
   * hangs off the body rather than off the control, because the panel scrolls
   * its content and would otherwise clip it to a single row.
   */
  function place() {
    if (!select.isConnected) { close(); list.remove(); return; }
    const r = select.getBoundingClientRect();
    const under = window.innerHeight - r.bottom - GAP;
    const over = r.top - GAP;
    const up = under < Math.min(MENU_MAX, rows.length * 26 + 10) && over > under;
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    list.style.maxHeight = `${Math.max(96, Math.min(MENU_MAX, up ? over : under))}px`;
    list.style.top = up ? "auto" : `${r.bottom + GAP}px`;
    list.style.bottom = up ? `${window.innerHeight - r.top + GAP}px` : "auto";
  }

  function open() {
    if (!list.hidden) return;
    opened = select.selectedIndex;
    build();
    list.hidden = false;
    place();
    rows[select.selectedIndex]?.scrollIntoView({ block: "nearest" });
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", place);
    // Capture phase, so a scroll anywhere - including the panel the control is
    // in - moves the list with it rather than leaving it stranded.
    window.addEventListener("scroll", place, true);
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    document.removeEventListener("pointerdown", away, true);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
  }

  // composedPath, not target: an event inside a shadow root is retargeted to
  // the host by the time it reaches the document, so `target` is never the
  // select and the list would shut the instant it opened.
  function away(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (!path.includes(select) && !path.includes(list)) close();
  }

  select.addEventListener("mousedown", (e) => {
    // Without this the browser opens its own menu, which is the whole problem.
    e.preventDefault();
    select.focus();
    if (list.hidden) open(); else close();
  });

  select.addEventListener("keydown", (e) => {
    if (list.hidden) {
      // Otherwise left alone: on a closed select the arrow keys change the
      // value directly, which is the native behaviour and works fine.
      if (e.key === "Enter" || e.key === " " || (e.altKey && e.key === "ArrowDown")) {
        e.preventDefault(); open();
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); highlight(opened); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); highlight(select.selectedIndex + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(select.selectedIndex - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(select.selectedIndex); }
  });

  select.addEventListener("blur", close);
  select.addEventListener("change", () => { if (!list.hidden) mark(); });
}

/**
 * Watch a container and take over every native select that appears in it.
 * Returns a function that stops watching.
 */
export function dressSelects(host) {
  if (!host) return () => {};
  const obs = new MutationObserver(() => scan());

  /** Walk a root, observing it and every shadow root hanging off it. */
  function walk(root) {
    if (!watched.has(root)) {
      watched.add(root);
      obs.observe(root, { childList: true, subtree: true });
    }
    for (const el of root.querySelectorAll("*")) {
      if (el.tagName === "SELECT") dress(el);
      // Calcite attaches its shadow root before it renders into it, so the
      // root is here to be observed even when it is still empty.
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  }

  function scan() {
    for (const entry of live) {
      if (!entry.select.isConnected) { entry.list.remove(); live.delete(entry); }
    }
    walk(host);
  }

  scan();
  return () => obs.disconnect();
}
