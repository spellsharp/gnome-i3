#!/usr/bin/env bash
# Undo apply-forge.sh: turn Forge off and give the keys back to GNOME.
gnome-extensions disable forge@jmmaranan.com
gnome-extensions enable tiling-assistant@ubuntu.com
WM=org.gnome.desktop.wm.keybindings
for k in maximize unmaximize switch-input-source-backward; do gsettings reset $WM $k; done
gsettings set $WM move-to-monitor-left  "['<Super><Shift>Left', '<Super><Shift>h']"
gsettings set $WM move-to-monitor-down  "['<Super><Shift>Down', '<Super><Shift>j']"
gsettings set $WM move-to-monitor-up    "['<Super><Shift>Up', '<Super><Shift>k']"
gsettings set $WM move-to-monitor-right "['<Super><Shift>Right', '<Super><Shift>l']"
gsettings reset org.gnome.shell.keybindings toggle-quick-settings
gsettings set org.gnome.settings-daemon.plugins.media-keys home "['<Super>e']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "[]"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "[]"
gsettings reset org.gnome.desktop.wm.preferences focus-mode
echo "Forge off. Restart GNOME Shell: Alt+F2, r, Enter."
