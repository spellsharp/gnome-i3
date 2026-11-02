# gnome-i3

i3 window manager behaviour inside GNOME, with one on/off switch.

You keep GNOME's top bar menus (Wi-Fi, Bluetooth, sound, Quick Settings) and
get i3's keyboard-driven tiling and per-monitor workspaces.

```bash
git clone https://github.com/spellsharp/gnome-i3.git
cd gnome-i3
./install.sh
```

Then log out and log in. Done.

## Requirements

- Ubuntu 24.04 with GNOME 46.
- An **Xorg** session. At the login screen, click the gear icon and pick
  "Ubuntu on Xorg". (Wayland is not supported: the helpers use X11 tools.)
- `sudo` for the apt packages (or run `./install.sh --no-apt` and install
  them yourself; the list is at the top of `install.sh`).

## The switch

```bash
gnome-i3 on       # i3 mode
gnome-i3 off      # plain GNOME
gnome-i3 toggle   # same as the "i3 Mode" launcher in the app grid
gnome-i3 status
```

Every run saves a full `dconf dump /` in `~/.local/state/gnome-i3/` first.

## What i3 mode gives you

- **Tiling** with [Forge](https://github.com/forge-ext/forge) and i3 keys:
  `Super+h/j/k/l` or arrows focus, `Super+Shift+…` move, `Super+Ctrl+…`
  resize, `Super+z/v` split, `Super+e` toggle split, `Super+s` stacked,
  `Super+w` tabbed, `Super+Shift+Space` float, `Super+f` fullscreen,
  `Super+Shift+q` close.
- **i3 workspaces per monitor**: `Super+1…0` shows a workspace on the
  monitor where it lives, `Super+Shift+1…0` moves the window. Each monitor
  shows its own workspace, as in i3. A new workspace opens on the monitor
  under the mouse. When a monitor is unplugged, its workspaces move to the
  remaining monitors.
- **Desk pins** (only with 3 monitors, one of them portrait, and a landscape
  primary): workspaces 1–2 on the portrait monitor, 3–4 on the other
  landscape monitor, 5 on the primary.
- **i3/polybar-style top bar** on every monitor: numbered workspaces (only
  used ones), window title, now playing, screenshot, VPN (only if you have a
  `~/.local/bin/vpn-menu` script), caffeine, clock.
- **Launchers**: `Super+Return` terminal, `Super+d` spotlight search,
  `Super+q` browser (Brave), `Super+o` files, `Super+Shift+v` clipboard
  history, `Super+.` emoji, `Super+x` lock, `Super+Ctrl+x` power,
  `Super+Shift+s` / `Print` screenshot.

## Lock screen

GNOME's own lock screen needs GDM. Many setups use LightDM instead, so
`install.sh` adds an i3lock locker (lock after 20 minutes idle, and before
sleep) that stays on in both modes. In plain GNOME mode `Super+L` locks.
With [i3lock-color](https://github.com/Raymo111/i3lock-color) and a picture
at `~/.cache/lock-wallpaper-v4.jpg` the lock screen shows a clock on the
picture; otherwise it is plain i3lock on a dark colour.

## Repo layout

| Path | What |
|---|---|
| `install.sh`, `uninstall.sh` | set up / remove for the current user |
| `bin/gnome-i3` | the switch |
| `bin/*` | helpers (spotlight, clipboard, rofi menus, lock, caffeine, …) |
| `extension/i3-extras@spellsharp/` | GNOME Shell extension: workspaces, bars |
| `forge-patches/` | 2 fixes to Forge v89 (portrait monitor split; moving a window to another monitor uses the window's monitor, not the mouse's) |
| `keys/` | gsettings scripts for the key bindings, and their undo |
| `autostart/`, `applications/`, `rofi/` | autostart entries, launcher, themes |

`install.sh` links these files into `~/.local/bin`, `~/.config/rofi` and
`~/.local/share/gnome-shell/extensions`, so `git pull` updates a running
setup (extension changes need a log out, or `Alt+F2`, `r` on Xorg).
Existing files are moved to `~/.local/state/gnome-i3/backup-<time>/` first.

A Forge update from extensions.gnome.org removes the patches; `gnome-i3 on`
applies them again.

## Uninstall

```bash
./uninstall.sh
```

## Known limits

- Plain GNOME mode forgets which workspace a window on a secondary monitor
  was on (GNOME shows secondary monitors on every workspace).
- A nested split (A | (B over C)) comes back flat (A | B | C) after you
  leave and return to a workspace. Forge does this.
- Forge logs `this.ext.settings is null` when it is turned off. Harmless.
