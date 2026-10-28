#!/bin/bash
# Sobe 3 "sites" locais (Produção, Homologação, RC), cada um com o seu banco, interligados pela chave.
set -e
cd "$(dirname "$0")/.."
PG="psql -h 127.0.0.1 -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
for f in /tmp/srv_*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
for db in painel_prod painel_hom painel_rc; do $PG -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"; $PG -d $db -f netlify/database/migrations/20261027120000_esquema_inicial.sql; done
$PG -d painel_prod -f tests/semente_ficticia.sql
export PAINEL_URL_PROD=http://localhost:8891 PAINEL_URL_HOMOLOG=http://localhost:8892 PAINEL_URL_RC=http://localhost:8893 PAINEL_CHAVE_AMBIENTES=chave-de-teste-entre-ambientes-0123456789abcdef
PAINEL_AMBIENTE=prod    NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_prod setsid nohup node tests/servidor-local.mjs 8891 > /tmp/srv_prod.log 2>&1 & echo $! > /tmp/srv_prod.pid
PAINEL_AMBIENTE=homolog NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_hom  setsid nohup node tests/servidor-local.mjs 8892 > /tmp/srv_hom.log 2>&1 & echo $! > /tmp/srv_hom.pid
rm -rf /tmp/site_rc && mkdir -p /tmp/site_rc && cp -r public /tmp/site_rc/ && (cd /tmp/site_rc && PAINEL_AMBIENTE=rc node "$OLDPWD/scripts/preparar-ambiente.mjs")
PAINEL_PUBLIC=/tmp/site_rc/public PAINEL_AMBIENTE=rc      NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_rc   setsid nohup node tests/servidor-local.mjs 8893 > /tmp/srv_rc.log 2>&1 & echo $! > /tmp/srv_rc.pid
sleep 2; echo tres_ok
