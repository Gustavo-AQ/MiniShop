#!/usr/bin/env python3
"""Sobe API, Web e 3 workers de teste em portas separadas; encerra só seus filhos."""
import os
import pathlib
import shutil
import signal
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
dotnet = os.environ.get('DOTNET_PATH') or shutil.which('dotnet')
if not dotnet:
    raise SystemExit('Instale o .NET 10 SDK ou defina DOTNET_PATH.')
env = os.environ.copy()
keys = {'SERVICE_KEY': 'ServiceKey', 'ADMIN_KEY': 'AdminKey', 'ADMIN_PASSWORD': 'AdminPassword'}
for line in (root / '.env').read_text().splitlines():
    if line and not line.startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        if key in keys:
            env[keys[key]] = value
# Credencial descartável, exclusivamente para o contêiner de teste documentado.
env.update({
    'ASPNETCORE_ENVIRONMENT': 'Development',
    'ConnectionStrings__Shop': 'Host=localhost;Port=55433;Database=minishop_history_ui;Username=minishop;Password=concurrency-test-only',
    'ApiBaseUrl': 'http://127.0.0.1:5581',
})
for key in ['NO_PROXY', 'no_proxy']:
    env[key] = env.get(key, '') + ',localhost,127.0.0.1'
processes = []

def stop(*_):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with tempfile.TemporaryDirectory(prefix='minishop-history-') as logs:
    try:
        for project, port in [('Api', 5581), ('Web', 5580), ('Worker', None), ('Worker', None), ('Worker', None)]:
            directory = root / f'src/MiniShop.{project}'
            binary = directory / f'bin/Release/net10.0/MiniShop.{project}.dll'
            if not binary.exists():
                raise SystemExit('Execute dotnet build MiniShop.slnx -c Release antes de iniciar.')
            item = env.copy()
            if port:
                item['ASPNETCORE_URLS'] = f'http://127.0.0.1:{port}'
            with open(pathlib.Path(logs) / f'{project}-{len(processes)}.log', 'w') as log:
                processes.append(subprocess.Popen([dotnet, str(binary)], cwd=directory, env=item, stdout=log, stderr=subprocess.STDOUT))
        print(f'Teste isolado: Web 5580 / API 5581 / banco minishop_history_ui. Logs: {logs}', flush=True)
        print('Use Ctrl+C para encerrar apenas estes processos.', flush=True)
        while True:
            signal.pause()
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
