#!/bin/bash
# Answers one question: can this machine (or CI) produce a signed, notarizable
# Vault Commander build right now? Every check prints what it actually found,
# so a failure tells you which step to redo rather than just "no".
#
#   bash desktop/scripts/check-signing.sh
#
# Exits non-zero if anything required is missing.

set -uo pipefail

TEAM_ID="859RGHDYYN"
ok=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; ok=1; }
note() { printf '    %s\n' "$1"; }

echo
echo "Vault Commander — signing readiness"
echo

# 1. The identity: cert + private key paired in the login keychain. The cert
#    alone cannot sign; the private key alone cannot be vouched for.
echo "Developer ID identity"
IDENTITIES=$(security find-identity -v -p codesigning 2>/dev/null)
if grep -q "Developer ID Application" <<<"$IDENTITIES"; then
  pass "$(grep 'Developer ID Application' <<<"$IDENTITIES" | head -1 | sed 's/^ *//')"
else
  fail "No 'Developer ID Application' identity in the login keychain."
  note "Download the .cer from developer.apple.com and double-click it."
  note "Found instead:"
  if [ -n "$IDENTITIES" ]; then
    grep -o '"[^"]*"' <<<"$IDENTITIES" | sed 's/^/      /'
  else
    note "  (none)"
  fi
fi

# 2. Expiry. A cert that expires mid-quarter fails a release at the worst time.
EXPIRY=$(security find-certificate -c "Developer ID Application" -p 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$EXPIRY" ]; then
  pass "Expires: $EXPIRY"
fi

echo
echo "Notarization credentials (only needed by CI, but check them here first)"
for var in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  if [ -n "${!var:-}" ]; then
    if [ "$var" = "APPLE_APP_SPECIFIC_PASSWORD" ]; then
      pass "$var is set (value hidden)"
    else
      pass "$var = ${!var}"
    fi
  else
    fail "$var is not set in this shell."
  fi
done

if [ -n "${APPLE_TEAM_ID:-}" ] && [ "${APPLE_TEAM_ID}" != "$TEAM_ID" ]; then
  fail "APPLE_TEAM_ID is ${APPLE_TEAM_ID}, expected ${TEAM_ID}."
fi

# 3. The live check. Everything above can look right while notarization still
#    rejects the credentials, so ask Apple directly when we can.
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  echo
  echo "Asking Apple whether those credentials actually work"
  if xcrun notarytool history --apple-id "$APPLE_ID" \
       --password "$APPLE_APP_SPECIFIC_PASSWORD" \
       --team-id "$APPLE_TEAM_ID" >/dev/null 2>&1; then
    pass "Apple accepted the notarization credentials."
  else
    fail "Apple rejected them. Check the Apple ID and regenerate the app-specific password."
    note "The Apple ID must be the one that owns the developer account,"
    note "not whatever address you typed into the CSR."
  fi
fi

# 4. If a build exists, assess it the way a downloader's Mac will.
echo
echo "Built app (if present)"
APP=$(find "$(dirname "$0")/../dist" -maxdepth 2 -name "*.app" -print -quit 2>/dev/null)
if [ -z "$APP" ]; then
  note "No build in desktop/dist — run 'npm run dist:mac' to produce one."
else
  VERDICT=$(spctl -a -vvv "$APP" 2>&1 || true)
  if grep -qi "revoked" <<<"$VERDICT"; then
    fail "Gatekeeper says this runtime's notarization is REVOKED. Bump Electron."
  elif grep -qi "accepted" <<<"$VERDICT"; then
    pass "Gatekeeper accepts the build: $(grep -i 'source=' <<<"$VERDICT" | head -1)"
  else
    fail "Gatekeeper did not accept the build (expected until it is signed):"
    note "$(head -1 <<<"$VERDICT")"
  fi
fi

echo
if [ "$ok" -eq 0 ]; then
  echo "Ready to cut a signed release."
else
  echo "Not ready — see the ✗ lines above."
fi
exit "$ok"
