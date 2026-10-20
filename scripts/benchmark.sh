#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p results/live
# Imagem executa como UID 1654; diretório gravável apenas para operador/grupo ou ACL no host.
# Para evitar permissões globais, executa o gerador com o UID/GID atual.
docker compose --env-file .env -f deploy/compose.local.yml run --rm --user "$(id -u):$(id -g)" benchmark "${1:-5000}" "${2:-3}" /results
