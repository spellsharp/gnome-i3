# gnome-i3

i3-style GNOME 46 (X11) setup, turned on and off with one command.

    gnome-i3 on       # i3 keys, Forge tiling, per-monitor workspaces
    gnome-i3 off      # plain GNOME; Super+L locks with i3lock
    gnome-i3 toggle   # also the "i3 Mode" launcher in the app grid
    gnome-i3 status

## Parts

- `extension/i3-extras@spellsharp/` — GNOME Shell extension, linked from
  `~/.local/share/gnome-shell/extensions/`. Per-monitor i3 workspaces
  (`workspaces.js`), desk pins (1-2 portrait, 3-4 BenQ, 5 laptop, only with
  the 3-monitor desk set), top bar and secondary bars (`extension.js`).
  JS changes need a GNOME Shell restart: Alt+F2, r, Enter.
- `forge-patches/forge-local.patch` — two fixes to Forge v89 `tree.js`
  (portrait monitor split; move to next monitor uses the window's monitor,
  not the pointer's). A Forge update removes them; `gnome-i3 on` applies
  them again.
- `keys/` — gsettings scripts for the i3 key bindings and Forge keys, and
  their undo scripts.
- `autostart/greenclip-gnome.desktop` — clipboard daemon (Super+Shift+V).
- `bin/gnome-i3` — the switch. Linked as `~/.local/bin/gnome-i3`.

## Not in the switch

Machine fixes that stay on in both modes: lock daemon
(`~/.config/autostart/xss-lock-gnome.desktop`), VPN tray, monitor layouts
(`display-auto-v2`). Helper scripts (`raise-or-run-gnome`, `gnome-dnd-toggle`,
`spotlight`) stay in `~/.local/bin`.

## Safety

Each run saves a full `dconf dump /` in `~/.local/state/gnome-i3/` first.
Old file versions from before this repo: `~/2_System/gnome-i3-backups/`.
