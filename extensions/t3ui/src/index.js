import { DISCLOSURE_KEYS, accountClient, accountIdentity, readEntry, readPreferences, storagePrefix, threadKey } from "./state.js";
import { showSnoozePicker } from "./snooze-picker.js";
import "./style.css";

const SIDEBAR = "[data-sidebar-navigation-root]";
const SCROLL = "[data-app-action-sidebar-scroll]";
const SECTION = "[data-app-action-sidebar-section]";
const ATTR = "data-app-action-sidebar-thread-";
const ROW = `[${ATTR}row]`;
const OWN = "data-codex-tweaks-t3ui";
const HIDDEN = "data-codex-tweaks-t3ui-hidden";
const DISABLED = "data-sidebar-thread-actions-disabled";
const INDICATOR = "data-sidebar-indicator";
const ACTIONS = 'button[data-variant="transparent"][data-size="3xs"][aria-label]';
const SHELVES = ["snoozed", "settled"];
const REQUIRES_ATTENTION = new Set(["approval", "input", "error"]);

const en = {
  settle: "Settle",
  settled: "Settled",
  unSettle: "Un-settle",
  undo: "Undo",
  untitled: "Untitled chat",
  settledNotice: "Moved to Settled",
  restored: "Restored to the sidebar",
  failed: "T3UI couldn’t save this change.",
  openFailed: "Codex couldn’t open this chat.",
  snooze: "Snooze",
  snoozeChat: "Snooze chat",
  snoozed: "Snoozed",
  snoozedNotice: "Moved to Snoozed",
  wake: "Wake now",
  oneHour: "In 1 hour",
  tomorrow: "Tomorrow at 9 AM",
  customTime: "Custom date and time",
  invalidTime: "Choose a valid local time in the future.",
  cancel: "Cancel",
};
const zh = {
  settle: "收起",
  settled: "已收起",
  unSettle: "移回侧栏",
  undo: "撤销",
  untitled: "未命名聊天",
  settledNotice: "已收起聊天",
  restored: "已移回侧栏",
  failed: "无法保存此项更改。",
  openFailed: "Codex 无法打开此聊天。",
  snooze: "稍后处理",
  snoozeChat: "稍后处理此聊天",
  snoozed: "稍后处理",
  snoozedNotice: "已移至稍后处理",
  wake: "立即恢复",
  oneHour: "1 小时后",
  tomorrow: "明天上午 9 点",
  customTime: "自定义日期和时间",
  invalidTime: "请选择有效且晚于当前时间的本地时间。",
  cancel: "取消",
};

function keyOf(row) {
  if (row.getAttribute(ATTR + "kind") !== "local") return null;
  return threadKey(row.getAttribute(ATTR + "host-id"), row.getAttribute(ATTR + "id"));
}

function canUseActions(row) {
  return row.getAttribute(DISABLED) === "false" && row.getAttribute("aria-disabled") !== "true";
}

function canSettle(row) {
  const indicator = row.getAttribute(INDICATOR);
  return canUseActions(row) && (!indicator || indicator === "unread");
}

function canSnooze(row) {
  return canUseActions(row) && !REQUIRES_ATTENTION.has(row.getAttribute(INDICATOR));
}

function rowTitle(row) {
  return row?.getAttribute(ATTR + "title")?.trim().slice(0, 420) || "";
}

function rowWrapper(row) {
  const item = row.closest('[role="listitem"]');
  if (item?.parentElement?.matches('[role="list"]') &&
      item.querySelectorAll(ROW).length === 1 &&
      !item.querySelector("[data-app-action-sidebar-project-row]")) return item;
  return row;
}

function isSidebarMutation(record) {
  const target = record.target;
  if (record.attributeName === "lang") return true;
  if (target.closest?.(`[${OWN}]`)) return false;
  if (target.closest?.(SIDEBAR)) {
    if (record.type === "attributes") return target.matches(ROW);
    return [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && !node.hasAttribute(OWN),
    );
  }
  return [...record.addedNodes, ...record.removedNodes].some(node =>
    node.matches?.(SIDEBAR) || node.querySelector?.(SIDEBAR),
  );
}

export function activate({ root, onCleanup }) {
  const document = root.ownerDocument;
  const view = document.defaultView;
  const actions = new Map();
  const groups = new Map();
  let hidden = new Set();
  let entries = new Map();
  let expanded = {};
  let client = null;
  let identity = null;
  let prefix = null;
  let disposed = false;
  let frame = null;
  let toastTimer = null;
  let picker = null;
  let nextWake = Infinity;
  let groupNumber = 0;
  const language = () => /^zh(?:-|$)/i.test(document.documentElement.lang) ? zh : en;
  const formatWake = {
    en: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }),
    zh: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }),
  };

  function element(tag, part) {
    const node = document.createElement(tag);
    node.setAttribute(OWN, part);
    return node;
  }

  function button(part) {
    const node = element("button", part);
    node.type = "button";
    return node;
  }

  function sidebarScrolls() {
    return [...document.querySelectorAll(`${SIDEBAR} ${SCROLL}`)].filter(scroll => scroll.querySelector(SECTION));
  }

  function nativeRow(key, preferred) {
    const scrolls = sidebarScrolls();
    for (const scroll of [preferred, ...scrolls.filter(scroll => scroll !== preferred)]) {
      if (!scroll?.isConnected) continue;
      for (const row of scroll.querySelectorAll(ROW)) {
        if (keyOf(row) === key) return row;
      }
    }
    return null;
  }

  function clearNotice() {
    view.clearTimeout(toastTimer);
    root.querySelector(`[${OWN}="notice"]`)?.remove();
  }

  function closePicker() {
    picker?.close();
    picker?.remove();
    picker = null;
  }

  function announce(message, undo, focusUndo = false) {
    clearNotice();
    const notice = element("div", "notice");
    const text = element("span", "status");
    text.setAttribute("role", "status");
    notice.append(text);
    if (undo) {
      const action = button("undo");
      action.textContent = language().undo;
      action.addEventListener("click", undo);
      notice.append(action);
      if (focusUndo) {
        root.append(notice);
        action.focus({ preventScroll: true });
      }
    }
    if (!notice.isConnected) root.append(notice);
    text.textContent = message;
    function expire() {
      if (notice.contains(document.activeElement) || notice.matches(":hover")) {
        toastTimer = view.setTimeout(expire, 1200);
      } else {
        clearNotice();
      }
    }
    toastTimer = view.setTimeout(expire, undo ? 10000 : 3500);
  }

  function schedule() {
    if (disposed || frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      syncScope();
      render();
    });
  }

  function load() {
    try {
      ({ entries, expanded } = readPreferences(view.localStorage, prefix));
    } catch {
      entries = new Map();
      expanded = {};
    }
  }

  function syncScope() {
    const nextClient = accountClient(view);
    if (nextClient !== client) {
      client?.off?.("values_updated", syncScope);
      client = nextClient;
      if (typeof client?.off === "function") client.on?.("values_updated", syncScope);
    }
    const next = accountIdentity(client);
    if (next === identity) return;
    identity = next;
    prefix = null;
    entries = new Map();
    expanded = {};
    clearNotice();
    closePicker();
    render();
    if (!next) return;
    storagePrefix(view, next).then(result => {
      if (disposed || identity !== next || accountIdentity(accountClient(view)) !== next) return;
      prefix = result;
      load();
      schedule();
    }).catch(() => {});
  }

  function hasScope() {
    if (disposed) return false;
    syncScope();
    return prefix !== null;
  }

  function sameScope(scope) {
    return !disposed && prefix === scope && accountIdentity(accountClient(view)) === identity;
  }

  async function updateEntry(scope, key, revise) {
    const storageKey = scope + "thread:" + key;
    const commit = () => {
      if (!sameScope(scope)) return false;
      const storage = view.localStorage;
      const value = revise(readEntry(storage.getItem(storageKey)));
      if (value === undefined) return false;
      if (value === null) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(value));
      return true;
    };
    // Serialize writes to this entry across windows of the same account/workspace.
    return view.navigator.locks ? view.navigator.locks.request(storageKey, commit) : commit();
  }

  async function restore(key, token, scroll, shelf, control) {
    if (!hasScope()) return;
    const scope = prefix;
    try {
      const changed = await updateEntry(scope, key, previous => previous?.token === token ? null : undefined);
      if (!sameScope(scope)) return;
      const hadFocus = control === document.activeElement;
      load();
      render();
      if (!changed) {
        clearNotice();
        return;
      }
      if (hadFocus) {
        const row = nativeRow(key, scroll);
        const rowActions = actions.get(row);
        const focusTarget = (shelf === "snoozed" ? rowActions?.snooze : rowActions?.settle) ?? row;
        if (focusTarget?.getClientRects().length) focusTarget.focus({ preventScroll: true });
        else groups.get(scroll)?.get(shelf)?.toggle.focus({ preventScroll: true });
      }
      announce(language().restored);
    } catch {
      if (sameScope(scope)) announce(language().failed);
    }
  }

  async function park(row, control, wakeAt) {
    const scroll = row.closest(SCROLL);
    const key = keyOf(row);
    if (!hasScope() || !key || !scroll?.closest(SIDEBAR)) return;
    const scope = prefix;
    const snooze = wakeAt !== undefined;
    const shelf = snooze ? "snoozed" : "settled";
    try {
      const token = view.crypto.randomUUID();
      const changed = await updateEntry(scope, key, previous => {
        const now = Date.now();
        if (!row.isConnected || keyOf(row) !== key || (snooze ? !canSnooze(row) : !canSettle(row))) return;
        if (previous && (previous.wakeAt === undefined || previous.wakeAt > now)) return;
        if (snooze && !(wakeAt > now)) return;
        // A snooze has no `at` so the old Settle package ignores it on rollback.
        return { title: rowTitle(row), token, ...(snooze ? { wakeAt } : { at: now }) };
      });
      if (!sameScope(scope)) return;
      const hadFocus = document.activeElement === control;
      load();
      render();
      if (changed) {
        announce(language()[`${shelf}Notice`], event => restore(key, token, scroll, shelf, event.currentTarget), hadFocus);
      }
    } catch {
      if (sameScope(scope)) announce(language().failed);
    }
  }

  function snooze(row, control) {
    const key = keyOf(row);
    if (!hasScope() || !key || !row.isConnected || !canSnooze(row)) return;
    const scope = prefix;
    closePicker();
    const copy = language();
    const dialog = showSnoozePicker({
      root, element, button, copy,
      title: rowTitle(row) || copy.untitled,
      choose: wakeAt => {
        if (sameScope(scope) && keyOf(row) === key) void park(row, control, wakeAt);
      },
    });
    picker = dialog;
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (picker === dialog) picker = null;
    }, { once: true });
  }

  function createAction(row, part, invoke) {
    const control = button(part);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) {
      control.addEventListener(type, event => event.stopPropagation());
    }
    for (const type of ["keydown", "keyup"]) {
      control.addEventListener(type, event => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      });
    }
    control.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      invoke(row, control);
    });
    return control;
  }

  async function openNative(key, scroll) {
    if (!hasScope() || !entries.has(key)) return;
    const row = nativeRow(key, scroll);
    if (row && row.getAttribute("aria-disabled") !== "true") {
      row.click();
      return;
    }

    // Use the native Markdown link handler when Codex has unmounted this row.
    const [host, id] = JSON.parse(key);
    const url = new URL("codex://threads/" + id.slice("local:".length));
    url.searchParams.set("hostId", host);
    const openingScope = identity;
    try {
      await view.electronBridge.sendMessageFromView({
        type: "open-in-browser",
        initiator: "open_in_browser_bridge",
        source: "manual",
        originHostId: host,
        url: url.href,
      });
    } catch {
      if (hasScope() && identity === openingScope) announce(language().openFailed);
    }
  }

  function createGroup(scroll, shelf) {
    const section = element("section", "group");
    section.dataset.t3uiShelf = shelf;
    const heading = element("div", "heading");
    heading.setAttribute("role", "heading");
    heading.setAttribute("aria-level", "3");
    const toggle = button("toggle");
    const arrow = element("span", "chevron");
    arrow.setAttribute("aria-hidden", "true");
    const label = element("span", "label");
    const count = element("span", "count");
    const list = element("ul", "list");
    list.id = `t3ui-list-${++groupNumber}`;
    toggle.setAttribute("aria-controls", list.id);
    toggle.append(arrow, label, count);
    heading.append(toggle);
    section.append(heading, list);
    toggle.addEventListener("click", () => {
      if (!hasScope()) return;
      try {
        view.localStorage.setItem(prefix + DISCLOSURE_KEYS[shelf], String(!expanded[shelf]));
        load();
        render();
      } catch {
        announce(language().failed);
      }
    });
    scroll.append(section);
    return { section, toggle, label, count, list, items: new Map() };
  }

  function updateGroup(scroll, shelf, group, rows, shelfEntries) {
    const copy = language();
    const snoozed = shelf === "snoozed";
    const restoreLabel = snoozed ? copy.wake : copy.unSettle;
    group.label.textContent = copy[shelf];
    group.count.textContent = String(shelfEntries.size);
    group.toggle.setAttribute("aria-expanded", String(expanded[shelf]));
    group.list.hidden = !expanded[shelf];
    for (const [key, item] of group.items) {
      if (!shelfEntries.has(key)) {
        item.li.remove();
        group.items.delete(key);
      }
    }
    if (!expanded[shelf]) return;
    let position = group.list.firstElementChild;
    const ordered = [...shelfEntries].sort(([, left], [, right]) =>
      snoozed ? left.wakeAt - right.wakeAt : right.at - left.at,
    );
    for (const [key, entry] of ordered) {
      let item = group.items.get(key);
      if (!item) {
        const li = element("li", "entry");
        const open = button("open");
        const title = element("span", "open-title");
        const time = snoozed ? element("time", "wake-time") : null;
        const restoreButton = button("restore");
        open.append(title);
        if (time) open.append(time);
        open.addEventListener("click", () => openNative(key, scroll));
        restoreButton.addEventListener("click", () => {
          const current = entries.get(key);
          if (current && snoozed === (current.wakeAt !== undefined)) {
            void restore(key, current.token, scroll, shelf, restoreButton);
          }
        });
        li.append(open, restoreButton);
        item = { li, open, title, time, restoreButton };
        group.items.set(key, item);
      }
      const row = rows.get(key);
      const title = rowTitle(row) || entry.title || copy.untitled;
      if (item.title.textContent !== title) item.title.textContent = title;
      item.open.title = title;
      if (item.time) {
        const date = new Date(entry.wakeAt);
        const formatted = formatWake[copy === zh ? "zh" : "en"].format(date);
        item.time.dateTime = date.toISOString();
        if (item.time.textContent !== formatted) item.time.textContent = formatted;
      }
      if (row?.getAttribute(ATTR + "selected") === "true") item.open.setAttribute("aria-current", "true");
      else item.open.removeAttribute("aria-current");
      item.restoreButton.textContent = restoreLabel;
      item.restoreButton.setAttribute("aria-label", `${restoreLabel} — ${title}`);
      if (item.li !== position) group.list.insertBefore(item.li, position);
      position = item.li.nextElementSibling;
    }
  }

  function splitEntries(panels) {
    const shelves = { snoozed: new Map(), settled: new Map() };
    const urgent = new Set();
    const now = Date.now();
    nextWake = Infinity;
    for (const { rows } of panels) {
      for (const [key, row] of rows) {
        if (REQUIRES_ATTENTION.has(row.getAttribute(INDICATOR))) urgent.add(key);
      }
    }
    for (const [key, entry] of entries) {
      if (entry.wakeAt === undefined) {
        shelves.settled.set(key, entry);
      } else if (entry.wakeAt <= now || urgent.has(key)) {
        entries.delete(key);
        void updateEntry(prefix, key, current => current?.token === entry.token ? null : undefined).catch(() => {});
      } else {
        shelves.snoozed.set(key, entry);
        nextWake = Math.min(nextWake, entry.wakeAt);
      }
    }
    return shelves;
  }

  function render() {
    const scrolls = prefix ? sidebarScrolls() : [];
    const panels = scrolls.map(scroll => ({
      scroll,
      rows: [...scroll.querySelectorAll(ROW)]
        .map(row => [keyOf(row), row])
        .filter(([key]) => key !== null),
    }));
    const shelves = splitEntries(panels);
    const seenActions = new Set();
    const nextHidden = new Set();
    const copy = language();
    for (const { scroll, rows } of panels) {
      if (!groups.has(scroll)) groups.set(scroll, new Map());
      for (const [key, row] of rows) {
        const entry = entries.get(key);
        const showSettle = canSettle(row);
        const showSnooze = canSnooze(row);
        if (entry) {
          if (entry.wakeAt === undefined ? showSettle : showSnooze) nextHidden.add(rowWrapper(row));
        } else if (showSettle || showSnooze) {
          const rail = row.querySelector(ACTIONS)?.parentElement;
          if (!rail) continue;
          updateActions(row, rail, copy, showSettle);
          seenActions.add(row);
        }
      }
      updateShelves(scroll, shelves, new Map(rows));
    }

    for (const [row, controls] of actions) {
      if (!seenActions.has(row)) {
        controls.settle?.remove();
        controls.snooze.remove();
        actions.delete(row);
      }
    }
    for (const [scroll, sections] of groups) {
      if (!scrolls.includes(scroll)) {
        for (const group of sections.values()) group.section.remove();
        groups.delete(scroll);
      }
    }
    for (const row of hidden) {
      if (!nextHidden.has(row)) row.removeAttribute(HIDDEN);
    }
    for (const row of nextHidden) {
      if (!row.hasAttribute(HIDDEN)) row.setAttribute(HIDDEN, "");
    }
    hidden = nextHidden;
  }

  function updateActions(row, rail, copy, showSettle) {
    let controls = actions.get(row);
    if (!controls) {
      controls = { snooze: createAction(row, "snooze", snooze), settle: null };
      controls.snooze.setAttribute("aria-haspopup", "dialog");
      actions.set(row, controls);
    }
    const title = rowTitle(row) || copy.untitled;
    if (controls.snooze.parentElement !== rail) rail.prepend(controls.snooze);
    controls.snooze.title = copy.snooze;
    controls.snooze.setAttribute("aria-label", `${copy.snooze} — ${title}`);
    if (showSettle) {
      controls.settle ??= createAction(row, "action", park);
      if (controls.settle.parentElement !== rail) rail.prepend(controls.settle);
      controls.settle.title = copy.settle;
      controls.settle.setAttribute("aria-label", `${copy.settle} — ${title}`);
    } else if (controls.settle) {
      controls.settle.remove();
      controls.settle = null;
    }
  }

  function updateShelves(scroll, shelves, rows) {
    const sections = groups.get(scroll);
    let preceding = null;
    for (const shelf of SHELVES) {
      let group = sections.get(shelf);
      if (shelves[shelf].size === 0) {
        group?.section.remove();
        sections.delete(shelf);
        continue;
      }
      if (!group) {
        group = createGroup(scroll, shelf);
        sections.set(shelf, group);
      }
      if (preceding && preceding.nextElementSibling !== group.section) preceding.after(group.section);
      else if (group.section.parentElement !== scroll) scroll.append(group.section);
      updateGroup(scroll, shelf, group, rows, shelves[shelf]);
      preceding = group.section;
    }
  }

  function onStorage(event) {
    if (hasScope() && (event.key === null || event.key.startsWith(prefix))) {
      load();
      schedule();
    }
  }

  function checkForWake() {
    syncScope();
    if (Date.now() >= nextWake) render();
  }

  const observer = new view.MutationObserver(records => {
    if (records.some(isSidebarMutation)) schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["lang", DISABLED, INDICATOR, "aria-disabled",
      ...["kind", "host-id", "id", "title", "selected"].map(name => ATTR + name)],
  });
  view.addEventListener("storage", onStorage);
  view.addEventListener("focus", checkForWake);
  document.addEventListener("visibilitychange", checkForWake);
  const poll = view.setInterval(checkForWake, 850);
  onCleanup(() => {
    disposed = true;
    observer.disconnect();
    client?.off?.("values_updated", syncScope);
    view.removeEventListener("storage", onStorage);
    view.removeEventListener("focus", checkForWake);
    document.removeEventListener("visibilitychange", checkForWake);
    view.clearInterval(poll);
    if (frame !== null) view.cancelAnimationFrame(frame);
    clearNotice();
    closePicker();
    for (const controls of actions.values()) {
      controls.snooze.remove();
      controls.settle?.remove();
    }
    for (const sections of groups.values()) {
      for (const group of sections.values()) group.section.remove();
    }
    for (const row of hidden) row.removeAttribute(HIDDEN);
    actions.clear();
    groups.clear();
    hidden.clear();
  });
  syncScope();
}
