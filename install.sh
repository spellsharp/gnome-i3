#!/usr/bin/env bash
# install.sh: set up gnome-i3 for the current user.
# Target: Ubuntu 24.04, GNOME 46, Xorg session ("Ubuntu on Xorg" at login).
#
#   ./install.sh             install packages (sudo), link files, turn on
#   ./install.sh --no-apt    skip apt (install the packages yourself)
#   ./install.sh --no-enable install only; turn on later with: gnome-i3 on
#
# Files that already exist are moved to ~/.local/state/gnome-i3/backup-<time>/
# before a link replaces them. Undo: ./uninstall.sh
set -euo pipefail

R="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APT=1
ENABLE=1
for a in "$@"; do
    case "$a" in
        --no-apt) APT=0 ;;
        --no-enable) ENABLE=0 ;;
        -h|--help) sed -n 2,10p "$0"; exit 0 ;;
        *) echo "install: unknown option $a" >&2; exit 2 ;;
    esac
done

STATE="$HOME/.local/state/gnome-i3"
BACKUP="$STATE/backup-$(date +%Y%m%d_%H%M%S)"
EXT="$HOME/.local/share/gnome-shell/extensions"
BIN="$HOME/.local/bin"
FORGE_UUID=forge@jmmaranan.com
FORGE_TAG=67175   # Forge v89; forge-patches/ are made against this build
FORGE_SHA=04d19cb1cb5684b81eb9cc84be62e18cfcb14ea311c3c4e19930746b5cddfb4e
GREENCLIP_URL=https://github.com/erebe/greenclip/releases/download/v4.2/greenclip
PKGS=(wmctrl xdotool xclip rofi flameshot i3lock xss-lock playerctl brightnessctl
      pcmanfm fonts-inter libnotify-bin x11-xserver-utils python3-gi gir1.2-gtk-3.0
      qalc fd-find curl unzip patch)

say() { echo "install: $*"; }

# Move an existing file away, then link src to dst. A link that already
# points at src is left alone.
link() {
    local src="$1" dst="$2"
    if [ -L "$dst" ] && [ "$(readlink -f "$dst")" = "$(readlink -f "$src")" ]; then
        return
    fi
    if [ -e "$dst" ] || [ -L "$dst" ]; then
        mkdir -p "$BACKUP$(dirname "$dst")"
        mv "$dst" "$BACKUP$dst"
        say "backed up $dst"
    fi
    mkdir -p "$(dirname "$dst")"
    ln -s "$src" "$dst"
}

# Write a template with @HOME@ filled in; back up a different existing file.
template() {
    local src="$1" dst="$2" tmp
    tmp=$(mktemp)
    sed "s|@HOME@|$HOME|g" "$src" > "$tmp"
    if [ -e "$dst" ] && ! cmp -s "$tmp" "$dst"; then
        mkdir -p "$BACKUP$(dirname "$dst")"
        mv "$dst" "$BACKUP$dst"
        say "backed up $dst"
    fi
    mkdir -p "$(dirname "$dst")"
    mv "$tmp" "$dst"
}

# --- 0. Checks --------------------------------------------------------------
command -v gnome-shell >/dev/null || { say "ERROR: GNOME Shell is not installed."; exit 1; }
v=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
[ "$v" = 46 ] || say "WARNING: made for GNOME 46; this is GNOME $v."
[ "${XDG_SESSION_TYPE:-}" = x11 ] ||
    say "WARNING: this session is '${XDG_SESSION_TYPE:-unknown}'. gnome-i3 needs Xorg: log out, pick 'Ubuntu on Xorg' (gear icon), log in."

# --- 1. Packages ------------------------------------------------------------
if [ "$APT" = 1 ]; then
    missing=()
    for p in "${PKGS[@]}"; do
        dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        say "installing packages: ${missing[*]}"
        sudo apt-get install -y "${missing[@]}"
    fi
fi

# --- 2. Scripts, rofi themes, launcher -------------------------------------
for f in "$R"/bin/*; do
    link "$f" "$BIN/$(basename "$f")"
done
for f in "$R"/rofi/*.rasi; do
    link "$f" "$HOME/.config/rofi/$(basename "$f")"
done
link "$R/applications/gnome-i3.desktop" "$HOME/.local/share/applications/gnome-i3.desktop"

# --- 3. greenclip (clipboard history daemon, not in apt) -------------------
if [ ! -x "$BIN/greenclip" ]; then
    say "downloading greenclip"
    curl -fsSL --connect-timeout 20 --max-time 300 --retry 3 -o "$BIN/greenclip" "$GREENCLIP_URL"
    chmod +x "$BIN/greenclip"
fi

# --- 4. Emoji list for the emoji picker (Super+.) --------------------------
if [ ! -s "$HOME/.local/share/emoji.txt" ]; then
    mkdir -p "$HOME/.local/share"
    python3 - <<'PY'
import os, unicodedata
RANGES = [(0x1F300, 0x1F5FF), (0x1F600, 0x1F64F), (0x1F680, 0x1F6FF),
          (0x1F900, 0x1F9FF), (0x1FA70, 0x1FAFF), (0x2600, 0x26FF), (0x2700, 0x27BF)]
out = []
for lo, hi in RANGES:
    for cp in range(lo, hi + 1):
        ch = chr(cp)
        try:
            n = unicodedata.name(ch)
        except ValueError:
            continue
        if n.startswith(("VARIATION", "TAG ", "REGIONAL")):
            continue
        if unicodedata.category(ch) not in ("So", "Sk", "Sm"):
            continue
        out.append(f"{ch} {n.title()}")
open(os.path.expanduser("~/.local/share/emoji.txt"), "w").write("\n".join(out) + "\n")
PY
fi

# --- 5. GNOME Shell extensions ---------------------------------------------
link "$R/extension/i3-extras@spellsharp" "$EXT/i3-extras@spellsharp"
if [ ! -d "$EXT/$FORGE_UUID" ]; then
    say "downloading Forge v89 from extensions.gnome.org"
    tmp=$(mktemp -d)
    curl -fsSL --connect-timeout 20 --max-time 300 --retry 3 -o "$tmp/forge.zip" \
        "https://extensions.gnome.org/download-extension/$FORGE_UUID.shell-extension.zip?version_tag=$FORGE_TAG"
    echo "$FORGE_SHA  $tmp/forge.zip" | sha256sum -c --quiet
    mkdir -p "$EXT/$FORGE_UUID"
    unzip -q "$tmp/forge.zip" -d "$EXT/$FORGE_UUID"
    rm -rf "$tmp"
fi

# --- 6. Lock screen (stays on in both modes) -------------------------------
# GNOME's own lock needs GDM. This one (i3lock via xss-lock) works with any
# display manager: lock after 20 min idle and before sleep.
template "$R/autostart/xss-lock-gnome.desktop" "$HOME/.config/autostart/xss-lock-gnome.desktop"

# --- 7. Turn on ------------------------------------------------------------
if [ "$ENABLE" = 1 ]; then
    "$R/bin/gnome-i3" on
fi

case ":$PATH:" in
    *":$BIN:"*) ;;
    *) say "NOTE: $BIN is not on your PATH; log out and in once." ;;
esac
[ -d "$BACKUP" ] && say "old files are in $BACKUP"
say "done. Log out and log in (or on Xorg: Alt+F2, r, Enter) to load the extensions."
