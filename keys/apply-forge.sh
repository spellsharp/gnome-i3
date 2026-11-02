#!/usr/bin/env bash
# i3-style tiling in GNOME with the Forge extension (forge@jmmaranan.com).
# Run after apply-i3-keys.sh. Undo: ./undo-forge.sh
set -e
D="$HOME/.local/share/gnome-shell/extensions/forge@jmmaranan.com"
export GSETTINGS_SCHEMA_DIR="$D/schemas"
F=org.gnome.shell.extensions.forge
K=$F.keybindings
WM=org.gnome.desktop.wm.keybindings
SH=org.gnome.shell.keybindings
MK=org.gnome.settings-daemon.plugins.media-keys
MU=org.gnome.mutter.keybindings

# --- One tiler only ------------------------------------------------------
gnome-extensions disable tiling-assistant@ubuntu.com || true

# --- Free GNOME keys that i3 used for tiling -----------------------------
gsettings set $WM maximize "[]"                                   # Super+Up
gsettings set $WM unmaximize "[]"                                 # Super+Down
gsettings set $WM move-to-monitor-left  "[]"                      # Super+Shift+Left/h
gsettings set $WM move-to-monitor-right "[]"
gsettings set $WM move-to-monitor-up    "[]"
gsettings set $WM move-to-monitor-down  "[]"
gsettings set $WM switch-input-source-backward "['<Shift>XF86Keyboard']"   # Super+Shift+space
gsettings set $SH toggle-quick-settings "[]"                      # Super+s
gsettings set $MK home "[]"                                       # Super+e
gsettings set $MU toggle-tiled-left "[]"
gsettings set $MU toggle-tiled-right "[]"

# --- Forge keys, matched to ~/.config/i3/config ---------------------------
gsettings set $K window-focus-left  "['<Super>h', '<Super>Left']"
gsettings set $K window-focus-down  "['<Super>j', '<Super>Down']"
gsettings set $K window-focus-up    "['<Super>k', '<Super>Up']"
gsettings set $K window-focus-right "['<Super>l', '<Super>Right']"
gsettings set $K window-move-left  "['<Shift><Super>h', '<Shift><Super>Left']"
gsettings set $K window-move-down  "['<Shift><Super>j', '<Shift><Super>Down']"
gsettings set $K window-move-up    "['<Shift><Super>k', '<Shift><Super>Up']"
gsettings set $K window-move-right "['<Shift><Super>l', '<Shift><Super>Right']"
# i3 Super+Ctrl+direction = resize; Forge's swap keys sat there.
gsettings set $K window-swap-left  "[]"
gsettings set $K window-swap-down  "[]"
gsettings set $K window-swap-up    "[]"
gsettings set $K window-swap-right "[]"
gsettings set $K window-swap-last-active "[]"                     # was Super+Return (terminal)
gsettings set $K window-resize-left-increase   "['<Ctrl><Super>h', '<Ctrl><Super>Left']"
gsettings set $K window-resize-bottom-increase "['<Ctrl><Super>j', '<Ctrl><Super>Down']"
gsettings set $K window-resize-top-increase    "['<Ctrl><Super>k', '<Ctrl><Super>Up']"
gsettings set $K window-resize-right-increase  "['<Ctrl><Super>l', '<Ctrl><Super>Right']"
gsettings set $K window-resize-left-decrease   "['<Ctrl><Shift><Super>h']"
gsettings set $K window-resize-bottom-decrease "['<Ctrl><Shift><Super>j']"
gsettings set $K window-resize-top-decrease    "['<Ctrl><Shift><Super>k']"
gsettings set $K window-resize-right-decrease  "['<Ctrl><Shift><Super>l']"
gsettings set $K con-split-horizontal "['<Super>z']"
gsettings set $K con-split-vertical   "['<Super>v']"
gsettings set $K con-split-layout-toggle "['<Super>e', '<Shift><Super>t']"
gsettings set $K con-stacked-layout-toggle "['<Super>s']"
gsettings set $K con-tabbed-layout-toggle  "['<Super>w']"
gsettings set $K window-toggle-float "['<Shift><Super>space']"
gsettings set $K window-toggle-always-float "[]"                  # was Super+Shift+c (i3 reload)
gsettings set $K prefs-tiling-toggle "['<Super>t']"               # i3 Super+t = autotiling toggle
gsettings set $K workspace-active-tile-toggle "[]"
gsettings set $K focus-border-toggle "[]"                         # was Super+x (lock)
gsettings set $K prefs-open "[]"                                  # was Super+period (emoji)
gsettings set $K window-gap-size-increase "['<Ctrl><Super>plus', '<Ctrl><Super>equal']"
for k in window-snap-center window-snap-one-third-left window-snap-one-third-right \
         window-snap-two-third-left window-snap-two-third-right; do
  gsettings set $K $k "[]"                                        # Ctrl+Alt+letters: i3 had none
done

# --- Look and feel, matched to i3 -----------------------------------------
gsettings set $F focus-border-toggle false                        # i3: default_border pixel 0
gsettings set $F window-gap-size 6                                # i3: gaps inner 6
gsettings set org.gnome.desktop.wm.preferences focus-mode 'sloppy' # i3: focus_follows_mouse yes

# A new extension is unknown to the running shell until it restarts, so
# `gnome-extensions enable` fails; add it to the enabled list directly.
cur=$(gsettings get org.gnome.shell enabled-extensions)
case "$cur" in
  *forge@jmmaranan.com*) ;;
  "@as []") gsettings set org.gnome.shell enabled-extensions "['forge@jmmaranan.com']" ;;
  *) gsettings set org.gnome.shell enabled-extensions "${cur%]}, 'forge@jmmaranan.com']" ;;
esac
echo "Forge configured. Restart GNOME Shell: Alt+F2, r, Enter."
