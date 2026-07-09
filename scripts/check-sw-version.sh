#!/usr/bin/env bash
# Fail if any APP_SHELL asset changed but the service worker VERSION constant did
# not. A stale VERSION means the install event never fires, so active service
# workers keep serving the old app shell (the exact drift this repo hit once).
#
# Usage:
#   scripts/check-sw-version.sh             # check staged changes (pre-commit)
#   scripts/check-sw-version.sh <base-ref>  # check <base-ref>..HEAD (CI)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SW="service-worker.js"
[ -f "$SW" ] || { echo "check-sw-version: $SW not found" >&2; exit 1; }

base="${1:-}"
if [ -n "$base" ]; then
  changed="$(git diff --name-only "$base"..HEAD)"
  sw_diff="$(git diff "$base"..HEAD -- "$SW")"
else
  changed="$(git diff --cached --name-only)"
  sw_diff="$(git diff --cached -- "$SW")"
fi

# Extract APP_SHELL entries ("./foo.js" -> foo.js).
shell_files="$(sed -n '/APP_SHELL = \[/,/\];/p' "$SW" \
  | grep -oE '"\./[^"]+"' | tr -d '"' | sed 's|^\./||')"

# Completeness check: every LOCAL asset referenced by an HTML page that is
# itself in APP_SHELL must also be listed in APP_SHELL. Otherwise a newly
# added <script>/<link> tag is invisible to the cache warm-up and CI stays
# green while the app breaks offline. Runs unconditionally (not gated on a
# diff) because it validates the current tree, not just what changed.
extract_page_refs() {
  # script src="..."
  grep -oE '<script[^>]*\bsrc="[^"]+"' "$1" | grep -oE 'src="[^"]+"' | sed -E 's/^src="//; s/"$//'
  # link rel="stylesheet" href="..."
  grep -oE '<link[^>]*>' "$1" | grep -E 'rel="stylesheet"' | grep -oE 'href="[^"]+"' | sed -E 's/^href="//; s/"$//'
  # link rel="manifest" href="..."
  grep -oE '<link[^>]*>' "$1" | grep -E 'rel="manifest"' | grep -oE 'href="[^"]+"' | sed -E 's/^href="//; s/"$//'
}

pages="$(printf '%s\n' "$shell_files" | grep -E '\.html$' || true)"

missing=""
while IFS= read -r page; do
  [ -n "$page" ] || continue
  [ -f "$page" ] || continue
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    case "$ref" in
      http://*|https://*) continue ;;
    esac
    norm="${ref#./}"
    norm="${norm%%\?*}"
    norm="${norm%%#*}"
    if ! printf '%s\n' "$shell_files" | grep -qxF "$norm"; then
      missing="${missing}${page}: ${ref}\n"
    fi
  done <<PAGEREFS
$(extract_page_refs "$page")
PAGEREFS
done <<PAGES
$pages
PAGES

if [ -n "$missing" ]; then
  echo "ERROR: local asset(s) referenced by an APP_SHELL page are missing from APP_SHELL:" >&2
  printf '%b' "$missing" >&2
  echo "Add the missing file(s) (as \"./<name>\") to APP_SHELL in $SW and bump VERSION." >&2
  exit 1
fi

shell_changed=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if printf '%s\n' "$changed" | grep -qxF "$f"; then
    shell_changed=1
    break
  fi
done <<EOF
$shell_files
EOF

[ "$shell_changed" -eq 1 ] || exit 0

# A shell asset changed — require the VERSION line to have changed too.
if printf '%s\n' "$sw_diff" | grep -qE '^\+const VERSION'; then
  exit 0
fi

echo "ERROR: an APP_SHELL asset changed but service-worker.js VERSION was not bumped." >&2
echo "Bump the VERSION constant in $SW so clients fetch the new app shell." >&2
exit 1
