#!/bin/bash
# Says which certificate is actually inside a .p12 before you paste it into
# MAC_CSC_LINK. Keychain Access lists "Apple Development" and "Developer ID
# Application" as adjacent, near-identical rows, and exporting the wrong one
# yields a .p12 that signs happily and is then rejected by Apple's notarizer
# with a message that names frameworks rather than the real cause.
#
#   bash desktop/scripts/check-p12.sh "/path/to/cert.p12"
#
# openssl prompts for the password on your terminal. It is never taken as an
# argument, never echoed, and never leaves this machine.

set -uo pipefail

P12="${1:-}"
if [ -z "$P12" ] || [ ! -f "$P12" ]; then
  echo "Usage: bash desktop/scripts/check-p12.sh \"/path/to/cert.p12\"" >&2
  exit 2
fi

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

echo
echo "Inspecting: $P12"
echo "Enter the password you set when exporting it (input is hidden)."
echo

# OpenSSL 3 needs -legacy for the ciphers Keychain Access still writes;
# LibreSSL (the system default on macOS) does not know that flag at all.
openssl pkcs12 -in "$P12" -clcerts -nokeys -legacy -out "$TMP/certs.pem" 2>/dev/null \
  || openssl pkcs12 -in "$P12" -clcerts -nokeys -out "$TMP/certs.pem" 2>/dev/null

if [ ! -s "$TMP/certs.pem" ]; then
  echo "  Could not read it — wrong password, or not a PKCS#12 file."
  echo "  Re-export from Keychain Access and try again."
  exit 1
fi

awk -v d="$TMP" '/BEGIN CERTIFICATE/{n++} n{print > (d "/cert" n ".pem")}' "$TMP/certs.pem"

FOUND_DEVID=0
i=0
SEEN=""
for f in "$TMP"/cert*.pem; do
  [ -e "$f" ] || continue
  # A self-signed cert is both a client and a CA cert and openssl emits it
  # twice, so key off the fingerprint rather than printing duplicates.
  FP=$(openssl x509 -in "$f" -noout -fingerprint 2>/dev/null)
  case "$SEEN" in *"$FP"*) continue ;; esac
  SEEN="$SEEN$FP"

  # The CN itself contains commas ("MdO Media, LLC"), so cut the subject at the
  # next RDN key instead of at the first comma, or the name comes out truncated.
  SUBJ=$(openssl x509 -in "$f" -noout -subject 2>/dev/null | sed 's/^subject= *//')
  # LibreSSL prints "/CN=x/O=y", OpenSSL prints "CN = x, O = y" — strip either.
  CN=$(sed -E 's#^.*CN *= *##; s#, (O|OU|C|L|ST|emailAddress) *=.*$##; s#/(O|OU|C|L|ST|emailAddress)=.*$##' <<<"$SUBJ")
  [ -z "$CN" ] && CN="$SUBJ"

  i=$((i+1))
  case "$CN" in
    "Developer ID Application"*) FOUND_DEVID=1; printf "  %d) %s   <-- this is the one you want\n" "$i" "$CN" ;;
    *)                           printf "  %d) %s\n" "$i" "$CN" ;;
  esac
done

echo
if [ "$FOUND_DEVID" -eq 1 ]; then
  echo "  ✓ Contains a 'Developer ID Application' certificate."
  echo "    Safe to base64 into MAC_CSC_LINK."
  exit 0
fi

echo "  ✗ No 'Developer ID Application' certificate in this file."
echo
echo "    In Keychain Access: left sidebar -> login keychain, then the"
echo "    'My Certificates' category. You want the row titled exactly"
echo
echo "        Developer ID Application: MdO Media, LLC (859RGHDYYN)"
echo
echo "    NOT a row beginning 'Apple Development:'. Right-click that row"
echo "    itself (not the private key nested under it) and choose Export."
exit 1
