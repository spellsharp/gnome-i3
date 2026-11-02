import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GnomeDesktop from 'gi://GnomeDesktop';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {WorkspaceSwitcherPopup} from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';
import {WorkspaceAnimationController} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Workspaces} from './workspaces.js';

// One per session; the bars read from it.
let spaces = null;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const BIN = `${GLib.get_home_dir()}/.local/bin`;

// Quick Settings indicators that show only while something is in use.
const PRIVACY = ['_remoteAccess', '_camera', '_volumeInput', '_location'];

// A helper from ~/.local/bin when it is there, else the bare name (PATH).
function prog(name) {
    const p = `${BIN}/${name}`;
    return GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE) ? p : name;
}

// The VPN button needs a vpn-menu script; without one it is left out.
function hasVpn() {
    return GLib.file_test(`${BIN}/vpn-menu`, GLib.FileTest.IS_EXECUTABLE);
}
const DIM = '#8b93a7';
const MUTED = '#e6ebf3';

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.error(`i3-extras: cannot run ${argv[0]}: ${e.message}`);
    }
}

async function capture(argv) {
    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const [out] = await proc.communicate_utf8_async(null, null);
        return out ?? '';
    } catch (e) {
        console.error(`i3-extras: cannot run ${argv[0]}: ${e.message}`);
        return '';
    }
}

// Same rule as polybar's i3 module with pin-workspaces: show the workspaces
// that live on this bar's monitor. getMonitor() returns the monitor index.
const WorkspaceBar = GObject.registerClass(
class WorkspaceBar extends PanelMenu.Button {
    _init(getMonitor) {
        super._init(0.0, 'Workspaces', true);
        this._getMonitor = getMonitor;
        // Drop the GNOME pill frame so cells fill the bar height, as in polybar.
        this.add_style_class_name('i3x-ws-panel');
        this._box = new St.BoxLayout({style_class: 'i3x-ws-box', y_expand: true});
        this.add_child(this._box);

        this._spacesSignal = spaces.connect('changed', () => this._queue());
        this._displaySignals = [
            global.display.connect('window-demands-attention', () => this._queue()),
            global.display.connect('window-marked-urgent', () => this._queue()),
            global.display.connect('window-created', () => this._queue()),
        ];
        this._queue();

        // Scroll walks this monitor's workspaces, no wrap (polybar enable-scroll).
        this.connect('scroll-event', (_actor, event) => {
            const dir = event.get_scroll_direction();
            const step = dir === Clutter.ScrollDirection.UP ? -1
                : dir === Clutter.ScrollDirection.DOWN ? 1 : 0;
            const m = this._getMonitor();
            const list = spaces.numbersOn(m);
            const next = list[list.indexOf(spaces.shownOn(m)) + step];
            if (step && next)
                spaces.switchTo(next);
            return Clutter.EVENT_STOP;
        });
    }

    _queue() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._redraw();
            return GLib.SOURCE_REMOVE;
        });
    }

    _redraw() {
        this._box.destroy_all_children();
        const m = this._getMonitor();
        const shown = spaces.shownOn(m);
        for (const n of spaces.numbersOn(m)) {
            const urgent = spaces.windowsOf(n).some(w => w.urgent || w.demands_attention);
            const btn = new St.Button({
                style_class: 'i3x-ws-btn',
                label: `${n}`,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
            });
            if (n === shown)
                btn.add_style_class_name(spaces.focusedMonitor() === m ? 'active' : 'visible');
            else if (urgent)
                btn.add_style_class_name('urgent');
            btn.connect('clicked', () => spaces.switchTo(n));
            this._box.add_child(btn);
        }
    }

    destroy() {
        if (this._idle)
            GLib.source_remove(this._idle);
        spaces.disconnect(this._spacesSignal);
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        super.destroy();
    }
});

// Centre of the bar: app name of the focused window ("Brave", not the page
// title). Falls back to the window title, "Desktop" when nothing is focused.
const TitleBar = GObject.registerClass(
class TitleBar extends St.Label {
    _init() {
        super._init({style_class: 'i3x-title', y_align: Clutter.ActorAlign.CENTER});
        this._win = null;
        this._winSignal = 0;
        this._focusSignal = global.display.connect('notify::focus-window', () => this._track());
        this._track();
    }

    _track() {
        if (this._win && this._winSignal)
            this._win.disconnect(this._winSignal);
        this._winSignal = 0;
        const w = global.display.focus_window;
        this._win = w && !w.skip_taskbar ? w : null;
        if (this._win)
            this._winSignal = this._win.connect('notify::title', () => this._update());
        this._update();
    }

    _update() {
        const app = this._win
            ? Shell.WindowTracker.get_default().get_window_app(this._win) : null;
        const t = app?.get_name() || (this._win?.get_title() ?? '');
        if (!t) {
            this.text = 'Desktop';
            this.add_style_class_name('empty');
            return;
        }
        this.remove_style_class_name('empty');
        this.text = t.length > 60 ? `${t.slice(0, 60)}…` : t;
    }

    destroy() {
        global.display.disconnect(this._focusSignal);
        if (this._win && this._winSignal)
            this._win.disconnect(this._winSignal);
        this._win = null;
        super.destroy();
    }
});

// A bar button like a polybar module: a GNOME symbolic icon and/or a text
// label, with left/middle/right click and scroll actions. `seconds` > 0
// re-runs refresh() on that interval.
const BarButton = GObject.registerClass(
class BarButton extends PanelMenu.Button {
    _init(name, {icon = '', glyph = '', color = MUTED, seconds = 0, actions = {}} = {}) {
        super._init(0.5, name, true);
        this.add_style_class_name('i3x-module');
        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._icon = new St.Icon({style_class: 'system-status-icon', visible: !!icon});
        if (icon)
            this._icon.icon_name = icon;
        this._label = new St.Label({
            style_class: glyph ? 'i3x-glyph' : 'i3x-text',
            y_align: Clutter.ActorAlign.CENTER,
            visible: !icon || !!glyph,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
        if (glyph)
            this.setGlyph(glyph, color);

        this._actions = actions;
        this.connect('button-press-event', (_a, event) => {
            const fn = {1: actions.left, 2: actions.middle, 3: actions.right}[event.get_button()];
            if (!fn)
                return Clutter.EVENT_PROPAGATE;
            fn();
            this._later(700);
            return Clutter.EVENT_STOP;
        });
        this.connect('scroll-event', (_a, event) => {
            const dir = event.get_scroll_direction();
            const fn = dir === Clutter.ScrollDirection.UP ? actions.up
                : dir === Clutter.ScrollDirection.DOWN ? actions.down : null;
            fn?.();
            return Clutter.EVENT_STOP;
        });
        if (seconds) {
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _later(ms) {
        if (this._soon)
            GLib.source_remove(this._soon);
        this._soon = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._soon = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    setIcon(name) {
        this._icon.icon_name = name;
        this._icon.visible = true;
    }

    setText(text) {
        this._label.text = text;
        this._label.visible = text !== '';
    }

    setGlyph(glyph, color) {
        this._label.text = glyph;
        this._label.style = `color: ${color};`;
    }

    refresh() {}

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        if (this._soon)
            GLib.source_remove(this._soon);
        super.destroy();
    }
});

// polybar `sep`: a muted middle dot, not clickable.
function separator() {
    return new St.Label({
        style_class: 'i3x-sep',
        text: '·',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

// vpn-menu --status prints a polybar label; its colour is the state
// (grey = off, blue = connected, yellow = connecting).
const VpnButton = GObject.registerClass(
class VpnButton extends BarButton {
    _init() {
        super._init('VPN', {
            icon: 'network-vpn-disabled-symbolic', seconds: 5,
            actions: {left: () => spawn([`${BIN}/vpn-menu`])},
        });
        this.refresh();
    }

    async refresh() {
        const out = await capture([`${BIN}/vpn-menu`, '--status']);
        const color = out.match(/%\{F(#[0-9a-fA-F]{6})\}/)?.[1]?.toLowerCase();
        this.setIcon({'#8ab4f8': 'network-vpn-symbolic', '#f5c542': 'network-vpn-acquiring-symbolic'}[color]
            ?? 'network-vpn-disabled-symbolic');
    }
});

// The caffeine script handles xset, DPMS and the logind inhibitor. GNOME's
// own idle blanking (idle-delay) ignores those, so while caffeine is on we
// also hold a gnome-session idle inhibitor. Only the main bar's button holds
// it (inhibit = true); the copies on other monitors only toggle and show.
const CaffeineButton = GObject.registerClass(
class CaffeineButton extends BarButton {
    _init({inhibit = true} = {}) {
        super._init('Caffeine', {
            icon: 'caffeine-cup-empty-symbolic', seconds: 10,
            actions: {left: () => spawn([`${BIN}/caffeine`, 'toggle'])},
        });
        this._inhibits = inhibit;
        this._cookie = null;
        this.refresh();
    }

    async refresh() {
        const on = (await capture([`${BIN}/caffeine`, 'ison'])).trim() === 'yes';
        this.setIcon(on ? 'caffeine-cup-full-symbolic' : 'caffeine-cup-empty-symbolic');
        if (!this._inhibits)
            return;
        if (on && this._cookie === null)
            this._inhibit();
        else if (!on && this._cookie !== null)
            this._uninhibit();
    }

    _session(method, params) {
        return Gio.DBus.session.call(
            'org.gnome.SessionManager', '/org/gnome/SessionManager',
            'org.gnome.SessionManager', method, params, null,
            Gio.DBusCallFlags.NONE, -1, null);
    }

    async _inhibit() {
        this._cookie = 0;  // pending
        try {
            // flags 8 = idle
            const res = await this._session('Inhibit',
                new GLib.Variant('(susu)', ['i3-extras', 0, 'Caffeine is on', 8]));
            [this._cookie] = res.deepUnpack();
        } catch (e) {
            this._cookie = null;
            console.error(`i3-extras: idle inhibit failed: ${e.message}`);
        }
    }

    _uninhibit() {
        const cookie = this._cookie;
        this._cookie = null;
        if (cookie)
            this._session('Uninhibit', new GLib.Variant('(u)', [cookie])).catch(() => {});
    }

    destroy() {
        this._uninhibit();
        super.destroy();
    }
});

// polybar nowplaying: hidden when nothing plays.
const NowPlayingButton = GObject.registerClass(
class NowPlayingButton extends BarButton {
    _init() {
        super._init('Now Playing', {
            seconds: 10,
            actions: {
                left: () => spawn([prog('playerctl'), 'play-pause']),
                right: () => spawn([prog('playerctl'), 'next']),
            },
        });
        this.hide();
        this.refresh();
    }

    async refresh() {
        const out = (await capture([`${BIN}/nowplaying`])).trim();
        this.visible = out !== '';
        if (!out)
            return;
        // nowplaying prints "<glyph> artist - title"; the glyph says the state.
        const plain = out.replace(/%\{[^}]*\}/g, '');
        const playing = plain.startsWith('\u{f040a}');
        this.setIcon(playing ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
        this.setText(plain.replace(/^\S+\s*/, ''));
    }
});

function appleButton() {
    const apple = new BarButton('Power', {
        glyph: '●', color: '#f3f5f9',
        actions: {left: () => spawn([`${BIN}/rofi-powermenu`])},
    });
    apple.add_style_class_name('i3x-apple');
    return apple;
}

// Opens GNOME's one Quick Settings menu (wifi, bluetooth, volume) from a
// secondary bar. The menu itself still draws on the primary monitor.
function quickSettingsButton() {
    return new BarButton('Quick Settings', {
        icon: 'emblem-system-symbolic',
        actions: {left: () => Main.panel.statusArea.quickSettings?.menu.toggle()},
    });
}

function screenshotButton() {
    return new BarButton('Screenshot', {
        icon: 'camera-photo-symbolic',
        actions: {left: () => spawn(['flameshot', 'gui'])},
    });
}

// Clock text in the same format as GNOME's date menu.
const ClockButton = GObject.registerClass(
class ClockButton extends BarButton {
    _init() {
        super._init('Clock');
        this._label.add_style_class_name('clock');
        this._clock = new GnomeDesktop.WallClock();
        this._clockSignal = this._clock.connect('notify::clock',
            () => this.setText(this._clock.clock));
        this.setText(this._clock.clock);
    }

    destroy() {
        this._clock.disconnect(this._clockSignal);
        this._clock = null;
        super.destroy();
    }
});

// GNOME draws its panel on the primary monitor only. This is a copy of the
// bar for each other monitor, like polybar's bar/macos-ext. Quick Settings
// and the calendar stay on the main bar: GNOME has one of each.
// name 'panel' makes the theme and stylesheet.css style it as the panel.
const SecondaryBar = GObject.registerClass(
class SecondaryBar extends St.Widget {
    _init(monitor) {
        super._init({
            name: 'panel',
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
        });
        this._parts = [];
        const box = (align, parts) => {
            const b = new St.BoxLayout({
                x_expand: true, y_expand: true,
                x_align: align, y_align: Clutter.ActorAlign.FILL,
            });
            for (const p of parts)
                b.add_child(p.container ?? p);
            this._parts.push(...parts);
            this.add_child(b);
        };
        box(Clutter.ActorAlign.START, [appleButton(), separator(),
            new WorkspaceBar(() => monitor.index)]);
        box(Clutter.ActorAlign.CENTER, [new TitleBar()]);
        box(Clutter.ActorAlign.END, [
            new NowPlayingButton(), screenshotButton(), ...(hasVpn() ? [new VpnButton()] : []),
            new CaffeineButton({inhibit: false}), quickSettingsButton(), separator(), new ClockButton(),
        ]);
    }

    destroy() {
        // Parent destruction does not call the JS destroy() overrides, so
        // call them here to stop their timers and signals.
        for (const p of this._parts)
            p.destroy();
        this._parts = null;
        super.destroy();
    }
});

export default class I3Extras extends Extension {
    enable() {
        // Before any bar: bars read from it, and its monitors-changed
        // handler must run before the bars are rebuilt.
        spaces = new Workspaces();

        // No dot popup on workspace switch: destroy it instead of showing it.
        // windowManager.js drops its reference on 'destroy'.
        this._injections = new InjectionManager();
        this._injections.overrideMethod(WorkspaceSwitcherPopup.prototype, 'display',
            () => function () {
                this.destroy();
            });

        // Instant workspace switch, like i3: skip the slide. (A picom-style
        // fade was tried 2026-10-23: GNOME did not run the fade on window
        // actors during the switch, so windows stayed hidden, then popped.)
        // Touchpad swipes use a separate path and still follow the fingers.
        this._injections.overrideMethod(WorkspaceAnimationController.prototype, 'animateSwitch',
            () => function (_from, _to, _direction, onComplete) {
                onComplete();
            });

        // The numbered workspaces replace the Activities dots. Super still
        // opens the overview.
        this._activities = Main.panel.statusArea.activities;
        this._activities?.hide();

        // Same modules and order as the old polybar, minus the ones GNOME
        // already has (wifi, bluetooth, volume, brightness, battery and the
        // control centre live in Quick Settings; stats = Astra Monitor).
        // left:  apple · workspaces      centre: window title
        // right: nowplaying screenshot vpn [others] caffeine
        //        [quick settings] · date  (no bell: user removed it)
        const u = this.uuid;
        const add = (role, btn) => {
            Main.panel.addToStatusArea(`${u}-${role}`, btn, 0, 'right');
            return btn;
        };
        this._buttons = [];
        const apple = appleButton();
        Main.panel.addToStatusArea(`${u}-apple`, apple, 0, 'left');
        this._ws = new WorkspaceBar(() => Main.layoutManager.primaryIndex);
        Main.panel.addToStatusArea(`${u}-ws`, this._ws, 1, 'left');
        this._sepLeft = separator();
        Main.panel._leftBox.insert_child_at_index(this._sepLeft, 1);

        const lead = [
            add('nowplaying', new NowPlayingButton()),
            add('screenshot', screenshotButton()),
            ...(hasVpn() ? [add('vpn', new VpnButton())] : []),
        ];
        const caffeine = add('caffeine', new CaffeineButton());
        this._buttons = [apple, this._ws, ...lead, caffeine];

        this._title = new TitleBar();
        this._sepRight = separator();
        this._dateBox = Main.panel.statusArea.dateMenu?.container;
        this._dateHome = this._dateBox?.get_parent();
        this._layoutRight = () => {
            const box = Main.panel._rightBox;
            const qs = Main.panel.statusArea.quickSettings?.container;
            const tail = [caffeine.container, qs, this._sepRight,
                this._dateBox].filter(Boolean);
            lead.forEach((b, i) => box.set_child_at_index(b.container, i));
            for (const a of tail) {
                a.get_parent()?.remove_child(a);
                box.add_child(a);
            }
        };
        this._layoutRight();
        Main.panel._centerBox.add_child(this._title);

        // Main bar: the same gear as the secondary bars, in place of the
        // wifi / bluetooth / sound / battery icons. GNOME's panel button
        // draws only its first child, so the gear box goes first and the
        // indicators box is hidden; the menu still opens from this button.
        // The privacy icons (screen sharing, camera, microphone, location
        // in use) move into the gear box, so they still show when active.
        const qsBtn = Main.panel.statusArea.quickSettings;
        this._moved = [];
        if (qsBtn?._indicators) {
            this._gear = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
            this._gear.add_child(new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'system-status-icon',
            }));
            qsBtn.insert_child_at_index(this._gear, 0);
            qsBtn._indicators.hide();
            // GNOME creates the indicators asynchronously at startup.
            let tries = 0;
            const take = () => {
                if (!qsBtn._camera && ++tries < 25)
                    return GLib.SOURCE_CONTINUE;
                this._takeId = 0;
                for (const ind of PRIVACY.map(k => qsBtn[k])) {
                    if (!ind || ind.get_parent() !== qsBtn._indicators)
                        continue;
                    qsBtn._indicators.remove_child(ind);
                    this._gear.insert_child_at_index(ind, this._moved.length);
                    this._moved.push(ind);
                }
                return GLib.SOURCE_REMOVE;
            };
            if (take() === GLib.SOURCE_CONTINUE)
                this._takeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, take);
        }

        // A bar on every other monitor; rebuilt when monitors change.
        this._bars = [];
        this._buildBars = () => {
            this._destroyBars();
            const lm = Main.layoutManager;
            for (const m of lm.monitors) {
                if (m.index === lm.primaryIndex)
                    continue;
                const bar = new SecondaryBar(m);
                lm.addChrome(bar, {affectsStruts: true, trackFullscreen: true});
                this._bars.push(bar);
            }
        };
        this._buildBars();
        this._monitorsSignal = Main.layoutManager.connect('monitors-changed', this._buildBars);

        // i3 ran this at login; it re-applies a saved "caffeine on".
        spawn([`${BIN}/caffeine`, 'restore']);
    }

    _destroyBars() {
        for (const bar of this._bars) {
            Main.layoutManager.removeChrome(bar);
            bar.destroy();
        }
        this._bars = [];
    }

    disable() {
        Main.layoutManager.disconnect(this._monitorsSignal);
        this._destroyBars();
        this._bars = this._buildBars = null;
        for (const btn of this._buttons)
            btn.destroy();
        this._buttons = null;
        this._ws = null;
        for (const a of [this._title, this._sepLeft, this._sepRight])
            a?.destroy();
        this._title = this._sepLeft = this._sepRight = null;
        if (this._dateBox && this._dateHome) {
            this._dateBox.get_parent()?.remove_child(this._dateBox);
            this._dateHome.add_child(this._dateBox);
        }
        this._dateBox = this._dateHome = null;
        if (this._takeId) {
            GLib.source_remove(this._takeId);
            this._takeId = 0;
        }
        if (this._gear) {
            const box = Main.panel.statusArea.quickSettings?._indicators;
            this._moved.forEach((ind, i) => {
                this._gear.remove_child(ind);
                box?.insert_child_at_index(ind, i);
            });
            this._moved = null;
            this._gear.destroy();
            this._gear = null;
            box?.show();
        }
        this._activities?.show();
        this._activities = null;
        this._injections.clear();
        this._injections = null;
        spaces.destroy();
        spaces = null;
    }
}
