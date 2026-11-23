#!/bin/sh
# Entrypoint 5e Manager (Docker): se DND5E_ADMIN_TOKEN non e' impostato, ne genera uno
# sicuro e lo salva in $DND5E_DATA_DIR/admin-token.txt (chmod 600) + nei log del container.
# Poi avvia il server. Con zero account, apri /setup per creare il primo admin.
set -e

DATA_DIR="${DND5E_DATA_DIR:-/data}"

if [ -z "${DND5E_ADMIN_TOKEN:-}" ]; then
  TOKEN=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
  export DND5E_ADMIN_TOKEN="$TOKEN"
  mkdir -p "$DATA_DIR"
  umask 077
  echo "$TOKEN" > "$DATA_DIR/admin-token.txt"
  echo "======================================================================"
  echo " 5e Manager: DND5E_ADMIN_TOKEN non impostato -> generato uno nuovo."
  echo " Token admin (pannello /admin, /api/setup, self-update web):"
  echo "   $TOKEN"
  echo " Salvato anche in $DATA_DIR/admin-token.txt (permessi 600)."
  echo " Con zero account apri /setup per creare il primo admin."
  echo "======================================================================"
else
  echo "5e Manager: DND5E_ADMIN_TOKEN impostato da env."
fi

exec npx tsx packages/server/src/index.ts
