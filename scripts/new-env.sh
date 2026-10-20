#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env ]; then echo '.env já existe. Nada foi sobrescrito.' >&2; exit 1; fi
umask 077
cp .env.example .env
python3 - <<'EOP'
import secrets
from pathlib import Path
p=Path('.env');s=p.read_text()
for v in ['CHANGE_ME_DATABASE_RANDOM','CHANGE_ME_SERVICE_32_CHARACTERS_MINIMUM','CHANGE_ME_ADMIN_32_CHARACTERS_MINIMUM','CHANGE_ME_LOGIN_16_CHARACTERS_MINIMUM']:
 s=s.replace(v,secrets.token_hex(24))
p.write_text(s)
EOP
echo 'Arquivo .env criado com segredos locais. Configure os IPs antes do deployment remoto.'
