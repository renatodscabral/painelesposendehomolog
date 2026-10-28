#!/bin/bash
# Recria o banco de teste e aplica as migrações (esquema + semente fictícia).
set -e
PG="psql -h 127.0.0.1 -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$PG -c "DROP DATABASE IF EXISTS painel_teste" -c "CREATE DATABASE painel_teste"
cd "$(dirname "$0")/.."
for f in netlify/database/migrations/*_esquema_*.sql tests/semente_ficticia.sql; do $PG -d painel_teste -f "$f"; done
echo banco_ok
