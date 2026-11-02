#!/usr/bin/env bash
# uninstall.sh: undo install.sh for the current user.
# Turns gnome-i3 off, removes the links that point into this repo, and puts
# back the files from the oldest install backup. Packages and Forge stay
# installed (Forge stays disabled).
set -euo pipefail

R="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STATE="$HOME/.local/state/gnome-i3"

say() { echo "uninstall: $*"; }

"$R/bin/gnome-i3" off || true
gnome-extensions disable forge@jmmaranan.com 2>/dev/null || true

# Remove every link into this repo.
for dir in "$HOME/.local/bin" "$HOME/.config/rofi" "$HOME/.local/share/applications" \
           "$HOME/.local/share/gnome-shell/extensions"; do
    [ -d "$dir" ] || continue
    for f in "$dir"/* "$dir"/.[!.]*; do
        [ -L "$f" ] || continue
        case "$(readlink -f "$f")" in
            "$R"/*) rm "$f"; say "removed link $f" ;;
        esac
    done
done
rm -f "$HOME/.config/autostart/greenclip-gnome.desktop" "$HOME/.config/autostart/xss-lock-gnome.desktop"

# Put back what the first install moved away (only where nothing is now).
first=$(ls -d "$STATE"/backup-* 2>/dev/null | sort | head -1 || true)
if [ -n "$first" ]; then
    (cd "$first" && find . \( -type f -o -type l \) -print) | while read -r rel; do
        dst="/${rel#./}"
        if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
            mkdir -p "$(dirname "$dst")"
            mv "$first/${rel#./}" "$dst"
            say "restored $dst"
        fi
    done
fi

say "done. Log out and log in to finish. WARNING: GNOME's own lock screen does not work without GDM."
