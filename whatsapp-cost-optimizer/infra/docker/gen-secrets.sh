#!/bin/sh
# Generates random secrets for infra/docker/compose.secrets.yml (never commit infra/docker/secrets/).
# Meta credentials are NOT generated: paste the values from your Meta app into the files listed below.
set -eu
dir="$(dirname "$0")/secrets"
mkdir -p "$dir"
chmod 700 "$dir"
gen() { [ -s "$dir/$1" ] || { node -e "process.stdout.write(require('crypto').randomBytes($2).toString('$3'))" > "$dir/$1"; echo "generated $1"; }; }
gen encryption_key 32 base64
gen jwt_secret 48 hex
gen hash_pepper 32 hex
for f in meta_app_secret meta_webhook_verify_token meta_access_token; do
  [ -f "$dir/$f" ] || { : > "$dir/$f"; echo "created empty $f — fill it with the value from your Meta app"; }
done
chmod 600 "$dir"/*
