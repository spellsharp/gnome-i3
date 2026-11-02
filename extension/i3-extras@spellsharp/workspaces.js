// i3-style workspaces for each monitor, on top of GNOME's global ones.
//
// Mutter has one active workspace for all monitors. To get i3's model (each
// workspace lives on one monitor, each monitor shows its own), GNOME
// workspace 11 is the "stage": it is always the active one and holds the
// windows that are on screen. GNOME workspaces 1..10 are storage: windows of
// i3 workspace n that are not on screen sit on GNOME workspace n.
// Switching monitor M from workspace a to b moves M's stage windows to
// storage a and the windows of storage b to the stage on M.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

export const N = 10;
const STAGE = N;
const STATE = `${GLib.get_user_cache_dir()}/i3-extras-workspaces.json`;
const SKIP = [Meta.WindowType.DESKTOP, Meta.WindowType.DOCK];

function now() {
    return global.get_current_time() || global.display.get_current_time_roundtrip();
}

export class Workspaces extends Signals.EventEmitter {
    constructor() {
        super();
        this._wm = global.workspace_manager;
        this._shown = new Map();  // monitor index -> workspace number
        this._owner = new Map();  // workspace number -> monitor index
        this._focusMon = global.display.get_current_monitor();
        // Stage window -> workspace number it belongs to. Needed when a
        // monitor goes away: Mutter moves its windows to another monitor
        // before we hear about it, so the monitor no longer tells.
        this._tag = new Map();
        this._nMon = global.display.get_n_monitors();
        // Hide order of each window, to bring it back in the same order.
        this._seq = new WeakMap();
        this._nextSeq = 0;
        this._pins = new Map();  // workspace number -> home monitor
        this._busy = false;
        this._ready = false;
        this._wsSignals = [];

        const st = this._load();
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._prefs = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        // Keep the user's own values from before the first enable, so
        // disable() can put them back after a restart too.
        const already = this._prefs.get_int('num-workspaces') === N + 1;
        this._saved = st.saved ?? (already ? {primary: true, dynamic: false, num: N} : {
            primary: this._mutter.get_boolean('workspaces-only-on-primary'),
            dynamic: this._mutter.get_boolean('dynamic-workspaces'),
            num: this._prefs.get_int('num-workspaces'),
        });
        this._restored = st.shown ?? [];
        this._mutter.set_boolean('dynamic-workspaces', false);
        this._mutter.set_boolean('workspaces-only-on-primary', false);
        this._prefs.set_int('num-workspaces', N + 1);

        // Mutter applies the settings a moment later.
        let tries = 0;
        this._wait = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (this._wm.n_workspaces < N + 1 && ++tries < 50)
                return GLib.SOURCE_CONTINUE;
            this._wait = 0;
            this._start();
            return GLib.SOURCE_REMOVE;
        });
    }

    _start() {
        this._ready = true;
        const nm = Main.layoutManager.monitors.length;
        const active = this._wm.get_active_workspace_index();
        if (active !== STAGE) {
            // First run: the current workspace becomes the stage. The
            // primary monitor keeps its number, other monitors get free ones.
            const p = Main.layoutManager.primaryIndex;
            this._busy = true;
            for (const w of this._byPos(this._wins(active)))
                w.change_workspace_by_index(STAGE, false);
            this._ws(STAGE).activate(now());
            this._busy = false;
            if (active < N)
                this._shown.set(p, active + 1);
        } else {
            for (const [m, n] of this._restored) {
                if (m < nm && n >= 1 && n <= N)
                    this._shown.set(m, n);
            }
        }
        for (const [m, n] of this._shown)
            this._owner.set(n, m);
        this._resync();

        const stage = this._ws(STAGE);
        this._signals = [
            [this._wm, this._wm.connect('active-workspace-changed', () => this._onActive())],
            [global.display, global.display.connect('notify::focus-window', () => this._onFocus())],
            [global.display, global.display.connect('window-entered-monitor', (_d, m, w) => {
                // A drag or move to another monitor joins the workspace
                // shown there. Skip the moves Mutter makes on hotplug.
                if (!this._busy && global.display.get_n_monitors() === this._nMon &&
                    this._tag.has(w) && this._shown.has(m))
                    this._tag.set(w, this._shown.get(m));
            })],
            [stage, stage.connect('window-added', (_ws, w) => {
                // New window: it belongs to the workspace on its monitor.
                if (!this._busy && this._counts(w))
                    this._tag.set(w, this._shown.get(w.get_monitor()));
            })],
            [stage, stage.connect('window-removed', (_ws, w) => this._tag.delete(w))],
            [global.display, global.display.connect('window-created', (_d, w) => this._watchSticky(w))],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => {
                this._resync();
            })],
        ];
        for (let i = 0; i < N; i++) {
            const ws = this._ws(i);
            this._wsSignals.push([ws, ws.connect('window-added', (_ws, w) => {
                if (!this._busy && this._counts(w) && !this._owner.has(i + 1)) {
                    this._owner.set(i + 1, this._home(i + 1) ?? w.get_monitor());
                    this._changed();
                }
            })]);
        }

        this._stickyIds = new Map();
        for (const a of global.get_window_actors())
            this._watchSticky(a.meta_window);

        for (let i = 1; i <= N; i++) {
            Meta.keybindings_set_custom_handler(`switch-to-workspace-${i}`,
                () => this.switchTo(i));
            Meta.keybindings_set_custom_handler(`move-to-workspace-${i}`,
                () => this.moveFocused(i));
        }
        this._changed();
    }

    destroy() {
        if (this._wait)
            GLib.source_remove(this._wait);
        if (this._ready) {
            const def = Main.wm._showWorkspaceSwitcher.bind(Main.wm);
            for (let i = 1; i <= N; i++) {
                Meta.keybindings_set_custom_handler(`switch-to-workspace-${i}`, def);
                Meta.keybindings_set_custom_handler(`move-to-workspace-${i}`, def);
            }
            for (const [obj, id] of [...this._signals, ...this._wsSignals])
                obj.disconnect(id);
            for (const [w, id] of this._stickyIds)
                w.disconnect(id);
            // Put on-screen windows back into storage and show the primary
            // monitor's workspace, so nothing is left on workspace 11.
            this._busy = true;
            for (const [m, n] of this._shown) {
                this._hide(this._wins(STAGE, m), n - 1);
            }
            for (const w of this._wins(STAGE))
                w.change_workspace_by_index(0, false);
            const pn = this._shown.get(Main.layoutManager.primaryIndex) ?? 1;
            this._ws(pn - 1).activate(now());
        }
        this._mutter.set_boolean('workspaces-only-on-primary', this._saved.primary);
        this._mutter.set_boolean('dynamic-workspaces', this._saved.dynamic);
        this._prefs.set_int('num-workspaces', this._saved.num);
        GLib.unlink(STATE);
    }

    // --- queries for the bar ---

    // Workspace numbers that live on monitor m, in order.
    numbersOn(m) {
        const out = [];
        for (let n = 1; n <= N; n++) {
            if (this._owner.get(n) === m)
                out.push(n);
        }
        return out;
    }

    shownOn(m) {
        return this._shown.get(m);
    }

    focusedMonitor() {
        return this._focusMon;
    }

    windowsOf(n) {
        const m = this._monitorShowing(n);
        return m === undefined ? this._wins(n - 1) : this._wins(STAGE, m);
    }

    // --- actions ---

    switchTo(n, focus = null) {
        if (!this._ready)
            return;
        let m = this._monitorShowing(n);
        if (m === undefined) {
            const nm = Main.layoutManager.monitors.length;
            // A new workspace opens on the monitor under the pointer, like
            // i3 with focus_follows_mouse (Forge focus on hover is off).
            m = this._home(n) ?? this._owner.get(n);
            if (m === undefined || m >= nm)
                m = global.display.get_current_monitor();
            const cur = this._shown.get(m);
            this._busy = true;
            if (cur !== undefined)
                this._hide(this._wins(STAGE, m), cur - 1);
            for (const w of this._inSeq(this._wins(n - 1))) {
                w.change_workspace_by_index(STAGE, false);
                if (w.get_monitor() !== m)
                    w.move_to_monitor(m);
                this._tag.set(w, n);
            }
            this._busy = false;
            this._shown.set(m, n);
            this._owner.set(n, m);
            // i3 drops an empty workspace when you leave it.
            if (cur !== undefined && this._wins(cur - 1).length === 0)
                this._owner.delete(cur);
        }
        this._focusMonitor(m, focus);
        this._changed();
    }

    moveFocused(n) {
        const w = global.display.focus_window;
        if (!this._ready || !w || !this._counts(w))
            return;
        const from = this._focusMon;
        const fromN = this._shown.get(from);
        const m = this._monitorShowing(n);
        this._busy = true;
        if (m !== undefined) {
            if (w.get_workspace()?.index() !== STAGE)
                w.change_workspace_by_index(STAGE, false);
            if (w.get_monitor() !== m)
                w.move_to_monitor(m);
            this._tag.set(w, n);
        } else {
            const owner = this._home(n) ?? this._owner.get(n) ?? w.get_monitor();
            this._seq.set(w, this._nextSeq++);
            w.change_workspace_by_index(n - 1, false);
            if (w.get_monitor() !== owner)
                w.move_to_monitor(owner);
            this._owner.set(n, owner);
        }
        this._busy = false;
        // Like i3, focus stays on the workspace the window left.
        if (fromN !== undefined && m !== from)
            this._focusMonitor(from, null);
        this._changed();
    }

    // --- internals ---

    _ws(i) {
        return this._wm.get_workspace_by_index(i);
    }

    _counts(w) {
        return !SKIP.includes(w.get_window_type()) && !w.is_on_all_workspaces();
    }

    _wins(i, m = -1) {
        const ws = this._ws(i);
        if (!ws)
            return [];
        return ws.list_windows().filter(w =>
            this._counts(w) && (m < 0 || w.get_monitor() === m));
    }

    // Brave sets "on all workspaces" on its own windows (it remembers the
    // state from when GNOME showed secondary monitors on every workspace).
    // i3 keeps a tiled window on one workspace, so take the flag off.
    // Always-on-top windows (picture-in-picture) keep it.
    _watchSticky(w) {
        if (!w || this._stickyIds.has(w))
            return;
        const id = w.connect('notify::on-all-workspaces', () => this._unstick(w));
        this._stickyIds.set(w, id);
        w.connect('unmanaged', () => this._stickyIds.delete(w));
        this._unstick(w);
    }

    _unstick(w) {
        if (!w.is_on_all_workspaces() || w.get_window_type() !== Meta.WindowType.NORMAL ||
            w.is_above() || w.is_skip_taskbar())
            return;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!w.get_compositor_private() || !w.is_on_all_workspaces())
                return GLib.SOURCE_REMOVE;
            console.log(`i3-extras: removed "on all workspaces" from ${w.get_wm_class()}`);
            this._busy = true;
            w.unstick();
            if (w.get_workspace()?.index() !== STAGE)
                w.change_workspace_by_index(STAGE, false);
            this._busy = false;
            this._tag.set(w, this._shown.get(w.get_monitor()));
            this._changed();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Forge adds a window that arrives on a workspace at the end of the
    // row, so windows must move in left-to-right (top-to-bottom) order.
    _byPos(wins) {
        const r = new Map(wins.map(w => [w, w.get_frame_rect()]));
        return wins.sort((a, b) => r.get(a).x - r.get(b).x || r.get(a).y - r.get(b).y);
    }

    _hide(wins, i) {
        for (const w of this._byPos(wins)) {
            this._seq.set(w, this._nextSeq++);
            w.change_workspace_by_index(i, false);
        }
    }

    _inSeq(wins) {
        const k = w => this._seq.get(w) ?? Infinity;
        return wins.sort((a, b) => k(a) - k(b));
    }

    // Desk setup only (3 monitors, one portrait, primary is landscape):
    // workspaces 1-2 live on the portrait monitor, 3-4 on the other
    // landscape monitor, 5 on the primary. 6-10 stay free.
    _computePins() {
        this._pins = new Map();
        const mons = Main.layoutManager.monitors;
        const p = Main.layoutManager.primaryIndex;
        if (mons.length !== 3)
            return;
        const portrait = mons.filter(g => g.height > g.width);
        if (portrait.length !== 1 || portrait[0].index === p)
            return;
        const v = portrait[0].index;
        const h = mons.find(g => g.index !== v && g.index !== p).index;
        for (const [n, m] of [[1, v], [2, v], [3, h], [4, h], [5, p]])
            this._pins.set(n, m);
    }

    _home(n) {
        return this._pins.get(n);
    }

    _monitorShowing(n) {
        for (const [m, s] of this._shown) {
            if (s === n)
                return m;
        }
        return undefined;
    }

    _focusMonitor(m, win) {
        this._focusMon = m;
        const t = now();
        const top = win ?? global.display.sort_windows_by_stacking(
            this._wins(STAGE, m).filter(w => !w.minimized)).at(-1);
        if (top) {
            top.activate(t);
            return;
        }
        // Empty workspace: put the pointer there so new windows open on
        // this monitor, as i3 does.
        const g = Main.layoutManager.monitors[m];
        if (g) {
            Clutter.get_default_backend().get_default_seat().warp_pointer(
                g.x + Math.floor(g.width / 2), g.y + Math.floor(g.height / 2));
        }
    }

    _onFocus() {
        const w = global.display.focus_window;
        if (w && this._counts(w) && w.get_workspace()?.index() === STAGE)
            this._focusMon = w.get_monitor();
        this._changed();
    }

    // Anything else that switches GNOME's workspace (dock click on a hidden
    // window, overview, Ctrl+Alt+arrows, touchpad swipe) means "show that
    // workspace": do it the i3 way and go back to the stage.
    _onActive() {
        if (this._busy)
            return;
        const i = this._wm.get_active_workspace_index();
        if (i === STAGE)
            return;
        const fw = global.display.focus_window;
        const win = fw?.get_workspace()?.index() === i ? fw : null;
        this._busy = true;
        this._ws(STAGE).activate(now());
        this._busy = false;
        if (i < N)
            this.switchTo(i + 1, win);
    }

    _resync() {
        const nm = Main.layoutManager.monitors.length;
        for (const m of [...this._shown.keys()]) {
            if (m >= nm)
                this._shown.delete(m);
        }
        this._computePins();
        // A pinned workspace shown on another monitor goes back to storage;
        // it is shown on its home monitor below or on the next switch.
        this._busy = true;
        for (const [m, n] of [...this._shown]) {
            const h = this._home(n);
            if (h !== undefined && h !== m) {
                this._hide(this._wins(STAGE, m), n - 1);
                this._shown.delete(m);
                this._owner.set(n, h);
            }
        }
        this._busy = false;
        // Stage windows whose workspace is not shown on their monitor (a
        // monitor was unplugged): show them where their workspace is, or
        // put them back into storage, as i3 keeps them as workspaces.
        this._busy = true;
        for (const w of this._byPos(this._wins(STAGE))) {
            const t = this._tag.get(w);
            if (t === undefined || this._shown.get(w.get_monitor()) === t)
                continue;
            const m2 = this._monitorShowing(t);
            if (m2 !== undefined) {
                w.move_to_monitor(m2);
            } else {
                this._seq.set(w, this._nextSeq++);
                w.change_workspace_by_index(t - 1, false);
                this._owner.set(t, w.get_monitor());
            }
        }
        this._busy = false;
        const shownNs = new Set(this._shown.values());
        for (let n = 1; n <= N; n++) {
            if (shownNs.has(n))
                continue;
            const ws = this._wins(n - 1);
            if (ws.length === 0) {
                this._owner.delete(n);
                continue;
            }
            const m = this._owner.get(n);
            const h = this._home(n);
            if (h !== undefined)
                this._owner.set(n, h);
            else if (m === undefined || m >= nm)
                this._owner.set(n, ws[0].get_monitor());
        }
        // A monitor with nothing shown gets, in this order: its lowest
        // hidden workspace that has windows, its lowest pinned workspace,
        // the lowest free number that is not pinned to another monitor.
        const shownNow = () => new Set(this._shown.values());
        for (let m = 0; m < nm; m++) {
            if (this._shown.has(m))
                continue;
            const busy = shownNow();
            const pick = [
                n => this._owner.get(n) === m,
                n => this._home(n) === m && !this._owner.has(n),
                n => this._home(n) === undefined && !this._owner.has(n),
            ];
            let n = undefined;
            for (const ok of pick) {
                for (let k = 1; k <= N && n === undefined; k++) {
                    if (!busy.has(k) && ok(k))
                        n = k;
                }
                if (n !== undefined)
                    break;
            }
            if (n === undefined)
                continue;
            this._busy = true;
            for (const w of this._inSeq(this._wins(n - 1))) {
                w.change_workspace_by_index(STAGE, false);
                if (w.get_monitor() !== m)
                    w.move_to_monitor(m);
                this._tag.set(w, n);
            }
            this._busy = false;
            this._shown.set(m, n);
            this._owner.set(n, m);
        }
        // Untagged stage windows (first start) belong to what is shown.
        for (const w of this._wins(STAGE)) {
            if (!this._tag.has(w))
                this._tag.set(w, this._shown.get(w.get_monitor()));
        }
        this._nMon = nm;
        if (this._focusMon >= nm)
            this._focusMon = Main.layoutManager.primaryIndex;
        this._changed();
    }

    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(STATE);
            return ok ? JSON.parse(new TextDecoder().decode(bytes)) : {};
        } catch {
            return {};
        }
    }

    _changed() {
        if (this._ready) {
            try {
                GLib.file_set_contents(STATE, JSON.stringify({
                    saved: this._saved, shown: [...this._shown],
                }));
            } catch (e) {
                console.error(`i3-extras: cannot save workspace state: ${e.message}`);
            }
        }
        this.emit('changed');
    }
}
