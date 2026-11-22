/**
 * macOS pop-up button menus for native `<select class="mynx-input">`.
 *
 * In every UI style the native drop-down list (which renders
 * as a Windows list on Windows) is replaced by a glass pop-up menu. The
 * `<select>` element stays the single source of truth: choosing an item sets
 * `selectedIndex` and dispatches the same `input` + `change` events the
 * browser would, so every existing `bind:value` / `onchange` keeps working
 * unchanged. Nothing here touches app state.
 *
 * Falls back to the native list for: `multiple` / sized
 * selects, selects marked `data-native-select`, and selects inside dialogs
 * or floating layers (their focus traps / outside-click rules would fight a
 * menu mounted on <body>).
 */

const MENU_ID = "mynx-popup-menu";
const OPEN_KEYS = new Set([" ", "Enter", "ArrowDown", "ArrowUp"]);

interface Entry {
  kind: "option" | "group";
  label: string;
  option?: HTMLOptionElement;
  row: HTMLElement;
}

let current: {
  select: HTMLSelectElement;
  menu: HTMLElement;
  entries: Entry[];
  active: number;
  typed: string;
  typedAt: number;
  openedAt: number;
} | null = null;

function eligible(target: EventTarget | null): HTMLSelectElement | null {
  if (!(target instanceof Element)) return null;
  const select = target.closest("select");
  if (!(select instanceof HTMLSelectElement)) return null;
  if (!select.classList.contains("mynx-input")) return null;
  if (select.disabled || select.multiple || select.size > 1) return null;
  if (select.hasAttribute("data-native-select")) return null;
  if (select.closest('[role="dialog"], [data-popover-content], [data-bits-floating-content]')) {
    return null;
  }
  return select;
}

function optionRows(): Entry[] {
  return current ? current.entries.filter((entry) => entry.kind === "option") : [];
}

function setActive(index: number): void {
  if (!current) return;
  const rows = optionRows();
  if (rows.length === 0) return;
  const next = Math.max(0, Math.min(index, rows.length - 1));
  rows.forEach((entry, i) => entry.row.classList.toggle("is-active", i === next));
  current.active = next;
  const row = rows[next].row;
  current.select.setAttribute("aria-activedescendant", row.id);
  row.scrollIntoView({ block: "nearest" });
}

function moveActive(step: number): void {
  if (!current) return;
  const rows = optionRows();
  let index = current.active;
  for (let i = 0; i < rows.length; i += 1) {
    index += step;
    if (index < 0 || index >= rows.length) return;
    if (!rows[index].option?.disabled) break;
  }
  setActive(index);
}

function close(restoreFocus = true): void {
  if (!current) return;
  const { select, menu } = current;
  current = null;
  menu.remove();
  select.removeAttribute("aria-activedescendant");
  select.removeAttribute("aria-controls");
  select.setAttribute("aria-expanded", "false");
  window.removeEventListener("resize", onDismiss);
  window.removeEventListener("blur", onDismiss);
  document.removeEventListener("scroll", onScroll, true);
  if (restoreFocus) select.focus({ preventScroll: true });
}

function choose(option: HTMLOptionElement | undefined): void {
  if (!current || !option || option.disabled) {
    close();
    return;
  }
  const { select } = current;
  close();
  if (select.selectedIndex === option.index) return;
  select.selectedIndex = option.index;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function onDismiss(): void {
  close(false);
}

function onScroll(event: Event): void {
  if (current && event.target instanceof Node && current.menu.contains(event.target)) return;
  close(false);
}

function buildRow(option: HTMLOptionElement, id: string, selected: boolean): HTMLElement {
  const row = document.createElement("div");
  row.id = id;
  row.className = "mynx-popup-item";
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", selected ? "true" : "false");
  if (option.disabled) row.setAttribute("aria-disabled", "true");
  const check = document.createElement("span");
  check.className = "mynx-popup-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = selected ? "✓" : "";
  const text = document.createElement("span");
  text.className = "mynx-popup-label";
  text.textContent = option.label || option.textContent || "";
  row.append(check, text);
  return row;
}

function position(select: HTMLSelectElement, menu: HTMLElement, selectedRow: HTMLElement | null): void {
  const rect = select.getBoundingClientRect();
  const margin = 8;
  menu.style.minWidth = `${Math.ceil(rect.width) + 12}px`;
  menu.style.maxHeight = `${window.innerHeight - margin * 2}px`;
  const height = menu.offsetHeight;
  const width = menu.offsetWidth;
  // macOS pop-up menus open with the chosen item laid over the button.
  const anchorOffset = selectedRow ? selectedRow.offsetTop - menu.scrollTop : 4;
  let top = rect.top + rect.height / 2 - anchorOffset - (selectedRow?.offsetHeight ?? 22) / 2;
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  let left = rect.left - 6;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

function open(select: HTMLSelectElement): void {
  close(false);
  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "mynx-popup-menu";
  menu.setAttribute("role", "listbox");
  const name = select.getAttribute("aria-label") ?? select.labels?.[0]?.textContent?.trim() ?? "";
  if (name) menu.setAttribute("aria-label", name);

  const entries: Entry[] = [];
  let selectedRow: HTMLElement | null = null;
  let selectedIndex = 0;
  let optionCount = 0;
  for (const child of Array.from(select.children)) {
    const options =
      child instanceof HTMLOptGroupElement ? Array.from(child.children) : [child];
    if (child instanceof HTMLOptGroupElement) {
      const header = document.createElement("div");
      header.className = "mynx-popup-group";
      header.setAttribute("role", "presentation");
      header.textContent = child.label;
      menu.append(header);
      entries.push({ kind: "group", label: child.label, row: header });
    }
    for (const node of options) {
      if (!(node instanceof HTMLOptionElement) || node.hidden) continue;
      const selected = node.index === select.selectedIndex;
      const row = buildRow(node, `${MENU_ID}-${node.index}`, selected);
      if (selected) {
        selectedRow = row;
        selectedIndex = optionCount;
      }
      row.addEventListener("pointerenter", () => {
        const index = optionRows().findIndex((entry) => entry.row === row);
        if (index >= 0 && !node.disabled) setActive(index);
      });
      row.addEventListener("mouseup", (event) => {
        // The menu opens over the button, so the release of the opening
        // click lands on a row; only a later release (or press-drag) picks.
        if (event.button !== 0 || !current || Date.now() - current.openedAt < 300) return;
        choose(node);
      });
      menu.append(row);
      entries.push({ kind: "option", label: (node.label || node.text).toLowerCase(), option: node, row });
      optionCount += 1;
    }
  }
  if (optionCount === 0) return;

  document.body.append(menu);
  current = { select, menu, entries, active: selectedIndex, typed: "", typedAt: 0, openedAt: Date.now() };
  select.setAttribute("aria-expanded", "true");
  select.setAttribute("aria-controls", MENU_ID);
  if (selectedRow) menu.scrollTop = Math.max(0, selectedRow.offsetTop - menu.clientHeight / 2);
  position(select, menu, selectedRow);
  setActive(selectedIndex);
  window.addEventListener("resize", onDismiss);
  window.addEventListener("blur", onDismiss);
  document.addEventListener("scroll", onScroll, true);
}

function typeahead(key: string): void {
  if (!current) return;
  const now = Date.now();
  current.typed = now - current.typedAt > 700 ? key : current.typed + key;
  current.typedAt = now;
  const query = current.typed.toLowerCase();
  const index = optionRows().findIndex((entry) => !entry.option?.disabled && entry.label.startsWith(query));
  if (index >= 0) setActive(index);
}

function onPointerDown(event: PointerEvent | MouseEvent): void {
  if (current && event.target instanceof Node && current.menu.contains(event.target)) {
    event.preventDefault();
    return;
  }
  const select = event.button === 0 ? eligible(event.target) : null;
  if (!select) {
    if (current) close(false);
    return;
  }
  // Suppress the native list; keep focus on the select itself.
  event.preventDefault();
  if (current?.select === select) {
    close();
    return;
  }
  select.focus({ preventScroll: true });
  open(select);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (current) {
    const rows = optionRows();
    switch (event.key) {
      case "ArrowDown":
        moveActive(1);
        break;
      case "ArrowUp":
        moveActive(-1);
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(rows.length - 1);
        break;
      case "Enter":
      case " ":
        choose(rows[current.active]?.option);
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        close(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const select = eligible(event.target);
  if (select && OPEN_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    open(select);
  }
}

let installed = false;

/** Install once at startup (main.ts). */
export function installPopupMenus(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("mousedown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
}
