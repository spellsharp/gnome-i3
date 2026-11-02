#!/usr/bin/env bash
# Port the i3 keybindings (~/.config/i3/config) to GNOME 46 on X11.
# Run by gnome-i3 on. Undo: undo-i3-keys.sh (run by gnome-i3 off).
set -e
WM=org.gnome.desktop.wm.keybindings
SH=org.gnome.shell.keybindings
MK=org.gnome.settings-daemon.plugins.media-keys
B="$HOME/.local/bin"

# --- Workspaces ----------------------------------------------------------
# The i3-extras extension owns the workspace settings (11 static: 10 + the
# stage). Do not set num-workspaces here: 10 would empty the stage.

# --- Free keys that GNOME / Ubuntu Dock hold ----------------------------
for i in 1 2 3 4 5 6 7 8 9; do gsettings set $SH switch-to-application-$i "[]"; done
gsettings set org.gnome.shell.extensions.dash-to-dock hot-keys false 2>/dev/null || true
gsettings set org.gnome.shell.extensions.dash-to-dock shortcut "[]" 2>/dev/null || true          # Super+q
gsettings set $SH show-screenshot-ui "[]"                                     # Print
gsettings set $SH screenshot "[]"                                             # Shift+Print
gsettings set $SH focus-active-notification "[]"                              # Super+n
gsettings set $WM show-desktop "['<Primary><Alt>d']"                          # Super+d, Super+Ctrl+d
gsettings set $WM switch-applications-backward "[]"                           # Super+Shift+Tab
gsettings set $MK rotate-video-lock-static "['XF86RotationLockToggle']"       # Super+o
gsettings set $WM minimize "['<Super>m']"                                     # was Super+h; i3 Super+m = hide to scratchpad

# --- Window-manager actions ---------------------------------------------
for i in 1 2 3 4 5 6 7 8 9; do
  gsettings set $WM switch-to-workspace-$i "['<Super>$i']"
  gsettings set $WM move-to-workspace-$i "['<Super><Shift>$i']"
done
gsettings set $WM switch-to-workspace-10 "['<Super>0']"
gsettings set $WM move-to-workspace-10 "['<Super><Shift>0']"
gsettings set $WM close "['<Super><Shift>q', '<Alt>F4']"
gsettings set $WM toggle-fullscreen "['<Super>f']"
gsettings set $WM begin-resize "['<Super>r', '<Alt>F8']"
gsettings set $WM move-to-monitor-left  "['<Super><Shift>Left', '<Super><Shift>h']"
gsettings set $WM move-to-monitor-down  "['<Super><Shift>Down', '<Super><Shift>j']"
gsettings set $WM move-to-monitor-up    "['<Super><Shift>Up', '<Super><Shift>k']"
gsettings set $WM move-to-monitor-right "['<Super><Shift>Right', '<Super><Shift>l']"
gsettings set $SH toggle-overview "['<Super><Shift>Tab']"                     # i3: expose
gsettings set $SH toggle-message-tray "['<Super>n']"                          # i3: notification centre
gsettings set $MK screensaver "[]"                                            # GNOME lock fails under LightDM; see Lock launcher

# --- Custom launchers ----------------------------------------------------
# custom0 (Cursor, Alt+c) already exists and is kept.
P=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings
paths="'$P/custom0/'"
n=1
add() {  # name, binding, command
  local k="$P/i3-$n/"
  local s="$MK.custom-keybinding:$k"
  gsettings set "$s" name "$1"
  gsettings set "$s" binding "$2"
  gsettings set "$s" command "$3"
  paths="$paths, '$k'"
  n=$((n+1))
}
add "Lock"                  "<Super>x"             "$HOME/.local/bin/gnome-i3-lock"
add "Terminal"              "<Super>Return"        "gnome-terminal"
add "Spotlight"             "<Super>d"             "$B/spotlight"
add "Rofi spotlight"        "<Super><Control>d"    "rofi -show spotlight -modi spotlight:$B/rofi-spotlight -theme $HOME/.config/rofi/macspotlight.rasi"
add "Brave (raise or run)"  "<Super>q"             "$B/raise-or-run-gnome brave brave"
add "Brave new window"      "<Super><Shift>b"      "brave --new-window"
add "Files (raise or run)"  "<Super>o"             "$B/raise-or-run-gnome pcmanfm pcmanfm $HOME"
add "Clipboard history"     "<Super><Shift>v"      "$B/clipboard"
add "Emoji picker"          "<Super>period"        "$B/rofi-emoji"
add "Accessibility menu"    "<Super><Control>a"    "$B/rofi-accessibility"
add "Power menu"            "<Super><Control>x"    "gnome-session-quit --power-off"
add "Log out"               "<Super><Shift>e"      "gnome-session-quit --logout"
add "Do not disturb"        "<Super><Shift>n"      "$B/gnome-dnd-toggle"
add "Screenshot area"       "<Super><Shift>s"      "flameshot gui"
add "Screenshot area (Print)" "Print"              "flameshot gui"
add "Screenshot to clipboard" "<Control>Print"     "flameshot gui --clipboard"
add "Screenshot full"       "<Shift>Print"         "flameshot full --path $HOME/Pictures"
gsettings set $MK custom-keybindings "[$paths]"
echo "Applied: $((n-1)) launchers + WM bindings."
