#!/usr/bin/env bash
set -euo pipefail

# Synchronizes or checks all 6 build number locations across app.js and index.html:
# 1. const CLIENT_BUILD = X; in app.js
# 2. // built:X in app.js
# 3. <!--built:X--> in index.html
# 4. style.css?build=X in index.html
# 5. i18n.js?build=X in index.html
# 6. app.js?build=X in index.html
# 7. (build X) footer label in index.html

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JS="$ROOT_DIR/app.js"
INDEX_HTML="$ROOT_DIR/index.html"

extract_values() {
  B_APP_CONST=$(sed -nE 's/^const CLIENT_BUILD = ([0-9]+);/\1/p' "$APP_JS" | head -n1)
  B_HTML_COMMENT=$(sed -nE 's/^<!--built:([0-9]+)-->/\1/p' "$INDEX_HTML" | head -n1)
  B_CSS_QUERY=$(sed -nE 's/.*href="style\.css\?build=([0-9]+)".*/\1/p' "$INDEX_HTML" | head -n1)
  B_I18N_QUERY=$(sed -nE 's/.*src="i18n\.js\?build=([0-9]+)".*/\1/p' "$INDEX_HTML" | head -n1)
  B_APP_QUERY=$(sed -nE 's/.*src="app\.js\?build=([0-9]+)".*/\1/p' "$INDEX_HTML" | head -n1)
  B_FOOTER=$(sed -nE 's/.*\(build ([0-9]+)\).*/\1/p' "$INDEX_HTML" | head -n1)
}

extract_values

if [[ "${1:-}" == "--check" ]]; then
  echo "Checking build number synchronization..."
  echo "  1. app.js CLIENT_BUILD      = $B_APP_CONST"
  echo "  2. index.html <!--built:X--> = $B_HTML_COMMENT"
  echo "  3. index.html style.css?b=   = $B_CSS_QUERY"
  echo "  4. index.html i18n.js?b=     = $B_I18N_QUERY"
  echo "  5. index.html app.js?b=      = $B_APP_QUERY"
  echo "  6. index.html (build X)      = $B_FOOTER"

  if [[ "$B_APP_CONST" == "$B_HTML_COMMENT" && \
        "$B_APP_CONST" == "$B_CSS_QUERY" && \
        "$B_APP_CONST" == "$B_I18N_QUERY" && \
        "$B_APP_CONST" == "$B_APP_QUERY" && \
        "$B_APP_CONST" == "$B_FOOTER" ]]; then
    echo "OK: All 6 build locations are synchronized at build $B_APP_CONST."
    exit 0
  else
    echo "ERROR: Build number mismatch detected!" >&2
    exit 1
  fi
fi

if [[ -n "${1:-}" ]]; then
  if ! [[ "$1" =~ ^[0-9]+$ ]]; then
    echo "Usage: $0 [--check | <new_build_number>]" >&2
    exit 1
  fi
  NEXT_BUILD="$1"
else
  NEXT_BUILD=$((B_APP_CONST + 1))
fi

perl -pi -e "s|^// built:[0-9]+|// built:${NEXT_BUILD}|g" "$APP_JS"
perl -pi -e "s|^const CLIENT_BUILD = [0-9]+;|const CLIENT_BUILD = ${NEXT_BUILD};|g" "$APP_JS"

perl -pi -e "s|^<!--built:[0-9]+-->|<!--built:${NEXT_BUILD}-->|g" "$INDEX_HTML"
perl -pi -e "s|style\.css\?build=[0-9]+|style.css?build=${NEXT_BUILD}|g" "$INDEX_HTML"
perl -pi -e "s|i18n\.js\?build=[0-9]+|i18n.js?build=${NEXT_BUILD}|g" "$INDEX_HTML"
perl -pi -e "s|app\.js\?build=[0-9]+|app.js?build=${NEXT_BUILD}|g" "$INDEX_HTML"
perl -pi -e "s|\(build [0-9]+\)|(build ${NEXT_BUILD})|g" "$INDEX_HTML"

"$0" --check
