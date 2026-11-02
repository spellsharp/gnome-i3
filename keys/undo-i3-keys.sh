#!/usr/bin/env bash
# Undo apply-i3-keys.sh: reset every key it touched to the GNOME default.
WM=org.gnome.desktop.wm.keybindings; SH=org.gnome.shell.keybindings; MK=org.gnome.settings-daemon.plugins.media-keys
# Workspace settings: the i3-extras extension puts the old values back when
# it is disabled (gnome-i3 off disables it first).
gsettings reset org.gnome.mutter dynamic-workspaces
for i in 1 2 3 4 5 6 7 8 9; do gsettings reset $SH switch-to-application-$i; done
for i in $(seq 1 10); do gsettings reset $WM switch-to-workspace-$i; gsettings reset $WM move-to-workspace-$i; done
gsettings reset org.gnome.shell.extensions.dash-to-dock hot-keys 2>/dev/null || true
gsettings reset org.gnome.shell.extensions.dash-to-dock shortcut 2>/dev/null || true
for k in show-screenshot-ui screenshot focus-active-notification toggle-overview toggle-message-tray; do gsettings reset $SH $k; done
for k in show-desktop switch-applications-backward minimize close toggle-fullscreen begin-resize \
         move-to-monitor-left move-to-monitor-down move-to-monitor-up move-to-monitor-right; do gsettings reset $WM $k; done
gsettings reset $MK rotate-video-lock-static; gsettings reset $MK screensaver
gsettings set $MK custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
for d in $(dconf list /org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/ | grep '^i3-'); do
  dconf reset -f /org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/$d
done
# The lock daemon (xss-lock-gnome.desktop) stays: GNOME's own lock fails
# under LightDM. gnome-i3 off binds Super+L to the working lock.
rm -f ~/.config/autostart/greenclip-gnome.desktop
echo "GNOME keys reset to defaults; clipboard autostart removed."
