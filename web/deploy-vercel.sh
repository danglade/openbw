#!/usr/bin/env bash
# Deploy web/ to Vercel production with the __BUILD__ cache-buster stamped — the same
# substitution upstream's .github/workflows/pages.yml does with the commit SHA. Without
# it, net.js is imported as ?v=__BUILD__ forever and returning browsers keep a stale
# copy across deploys. Restores the placeholder afterwards (working tree stays clean).
set -euo pipefail
cd "$(dirname "$0")"
STAMP=$(date +%s)
sed -i '' "s/__BUILD__/$STAMP/g" index.html openbw.js
trap 'sed -i "" "s/$STAMP/__BUILD__/g" index.html openbw.js' EXIT
vercel deploy --prod --yes
