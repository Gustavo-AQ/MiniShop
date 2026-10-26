# Validação de concorrência e CPU — 26/10/2026

## Resultado

A auditoria da versão publicada (`3875143`) confirmou o limite de **cálculos de pedidos**: sequencial = 1; paralelo = 1/2/4/8; distribuído = 1/2/3, uma thread de cálculo por processo. A reprodução não encontrou oito cálculos simultâneos no sequencial. Foi possível reproduzir uma única thread sequencial migrando entre os processadores **0, 1 e 2**. A mesma thread pode aparecer em vários gráficos de núcleo ao longo do tempo.

Foram encontrados gastos desnecessários de CPU nos workers em espera e ambiguidades no painel. A correção mantém os limites de processamento e reduz consultas de espera. A CPU da VM inteira não se limita ao número de threads de cálculo: também inclui PostgreSQL, API, runtime/JIT/GC, Docker, verificações de saúde e agente Beszel. Os três contêineres workers compartilham os recursos da mesma VM; não são três VMs independentes.

## Evidência com processos reais

O auditor C# inicia **três processos independentes** do worker. Para cada cenário, gera 64 pedidos com 200.000 iterações SHA-256, semente 42 e atraso zero. Lê tempo de CPU por thread nativa em `/proc/PID/task/TID/stat`, confirma quais threads `MiniShop-*` executaram trabalho de CPU e observa os pedidos no banco. Os dois conjuntos de dados foram coletados neste ambiente Linux amd64 com três processadores disponíveis, sem acessar PC doméstico ou Oracle.

A janela sem pedidos é de 1,5 segundo, após 0,5 segundo inicial com os workers registrados. **É uma observação inicial, não uma média de repouso prolongado**, e pode incluir JIT/runtime e heartbeat. Os valores são soma de segundos de CPU dos três processos worker; não somam CPU de PostgreSQL/API nem dos processos temporários de health check do Docker. Os valores não são percentuais da VM nem resultados dos benchmarks oficiais de 5.000 pedidos.

| Cenário | Threads nativas de cálculo: antes → depois | Pico global de pedidos após correção | CPU dos 3 workers sem pedidos (s / janela de 1,5 s): antes → depois |
|---|---:|---:|---:|
| Sequencial (campo paralelo=8) | 1 → 1 | 1 | 0.63 → 0.43 |
| Paralelo 1 | 1 → 1 | 1 | 0.72 → 0.47 |
| Paralelo 2 | 2 → 2 | 2 | 0.84 → 0.50 |
| Paralelo 4 | 4 → 4 | 4 | 0.99 → 0.60 |
| Paralelo 8 | 8 → 8 | 8 | 1.17 → 0.73 |
| Distribuído 1 (campo paralelo=8) | 1 → 1 | 1 | 0.74 → 0.38 |
| Distribuído 2 (campo paralelo=8) | 2 → 2 | 2 | 1.23 → 0.33 |
| Distribuído 3 (campo paralelo=8) | 3 → 3 | 3 | 1.41 → 0.30 |

No distribuído com três workers, a observação caiu de **1,41 para 0,30 segundo de CPU**, aproximadamente 79%. Isso representa esta janela e este ambiente; não promete a mesma redução na VM doméstica. Os dados brutos estão em `results/concurrency/before.json` e `after.json`. Nos oito cenários, antes e depois, os limites de execução foram respeitados.

## O que foi corrigido

- Threads sem pedidos faziam consultas a cada 75 ms. Agora a espera aumenta até 1 s quando não há trabalho, reiniciando imediatamente quando um pedido é assumido ou recusado por estoque. Um novo pedido pode levar até cerca de 1 s para despertar uma thread ociosa.
- A configuração era lida por thread/pedido e novamente dentro da reserva. Agora o supervisor verifica mudanças a cada 500 ms; a validação definitiva da configuração continua na mesma transação do claim.
- Vários workers agregavam resultados de um lote ainda aberto repetidamente. Agora a agregação completa começa somente quando todos os pedidos terminaram, com índice para a verificação de pendências. Workers sem vaga não agregam lotes.
- O progresso de lotes históricos já encerrados usava contagens repetidas em todos os seus pedidos. Agora usa o total finalizado conhecido.
- Heartbeats lentos podiam se sobrepor. Os callbacks agora não se acumulam; o encerramento aguarda sua conclusão. O supervisor também evita um laço rápido de consultas durante cancelamento.
- O pico exibido era desde o início do processo e podia continuar em 8 depois de mudar para sequencial. Os picos agora reiniciam quando a configuração muda, e há contagem específica de CPU, separada de pedidos aguardando I/O/atraso.
- O formulário administrativo só era sincronizado na primeira abertura. A configuração aplicada agora aparece em uma área independente; rascunhos são sinalizados, campos de outros modos ficam desabilitados, alterações externas atualizam o formulário quando não há rascunho, e erros de aplicação permanecem visíveis.

A API agora informa o teto global e as threads por worker, derivados da mesma configuração usada na reserva. Os workers publicam modo observado, papel, threads de cálculo habilitadas, cálculos ativos/pico, threads totais do SO e CPU do processo por intervalo.

## Como ler o Beszel e o painel

1. Selecione o modo, clique em **Aplicar configuração** e confira a área **Configuração aplicada no backend**. Selecionar um valor no formulário ainda não o aplica. Iniciar benchmark aplica os valores do formulário.
2. Aguarde a confirmação dos workers. A atualização depende do supervisor (500 ms), heartbeat (1 s) e polling do painel (2 s).
3. No sequencial, a soma das threads de cálculo habilitadas deve ser 1, mesmo que o campo desabilitado de paralelo tenha 8. Dois workers podem estar online e aguardando vaga.
4. No paralelo, a soma deve ser N em **um** worker. No distribuído, deve ser 1 por worker autorizado, somando até 3.
5. “Threads do SO” inclui .NET, GC, timers, rede e coordenação. Não equivale ao número de threads de cálculo. “Cálculos ativos” conta apenas a região SHA-256; pedidos ativos também incluem atraso e gravação do resultado.
6. Na coluna de CPU do processo e no `docker stats`, **100% representa aproximadamente uma CPU lógica**; pode haver valores acima de 100%. Para uma VM de 4 vCPU, uma CPU totalmente ocupada corresponde aproximadamente a 25% da capacidade total da VM, além dos outros componentes. Confira a normalização do gráfico na sua versão do Beszel.
7. Compare o contêiner worker e o PostgreSQL separadamente, com atraso zero e carga CPU suficiente. Um único gráfico de CPU da VM ou a quantidade total de threads do processo não comprova quantos pedidos calculam simultaneamente.

## Afinidade física opcional

O modo sequencial já limita o cálculo a uma thread. Caso queira **fixar os workers em determinadas CPUs** para uma demonstração visual, há um overlay opcional `deploy/compose.cpu-affinity.yml`. Ele restringe somente os workers; API, PostgreSQL e Beszel continuam podendo usar outras CPUs.

Com fila vazia, na VM doméstica, escolha IDs de CPU que existam nela:

```bash
MINISHOP_WORKER_CPUSET=0 docker compose --env-file .env \
  -f deploy/compose.home.yml -f deploy/compose.cpu-affinity.yml \
  up -d --no-deps worker-1 worker-2 worker-3
```

Isso recria os contêineres workers quando necessário. Não controla afinidade instantaneamente pelo painel. Para permitir as quatro vCPU em uma VM cujos IDs sejam 0–3, use `MINISHOP_WORKER_CPUSET=0-3`. Para remover a restrição, volte a implantar usando apenas o Compose base. No Coolify, aplique o overlay/equivalente ao recurso dos workers somente se desejar essa opção; ele não é ativado pelo deployment normal.

Para comparar 1/2/4/8 threads, mantenha **o mesmo conjunto de CPUs elegíveis em todos os cenários**. Mudar afinidade junto com o número de threads também muda os recursos disponíveis e confunde a comparação. Ter oito threads com quatro CPUs elegíveis continua representando oito threads disputando quatro CPUs.

O overlay foi validado localmente, e um contêiner descartável mostrou `Cpus_allowed_list: 0`. Não foi aplicado à infraestrutura do usuário.

## Reproduzir a auditoria

Requer SDK .NET 10 e Linux. Use banco PostgreSQL descartável **terminado em `_test` ou `_probe`**, sem outros testes/serviços conectados. O auditor apaga suas tabelas entre os cenários e recusa o nome de banco comum de produção.

```bash
export MINISHOP_PROBE_DB='Host=127.0.0.1;Port=55433;Database=minishop_test;Username=minishop;Password=SENHA_SOMENTE_TESTE'
dotnet build tests/MiniShop.ConcurrencyProbe -c Release
dotnet tests/MiniShop.ConcurrencyProbe/bin/Release/net10.0/MiniShop.ConcurrencyProbe.dll results/concurrency/minha-auditoria.json
```

O probe inicia e encerra apenas seus próprios processos. Os workers de produção não devem apontar para esse banco. Não execute durante benchmarks oficiais, pois a auditoria também consome CPU.

## Atualizar a implantação depois da aprovação

Reconstrua e reimplante **API e todos os workers** no recurso doméstico e **Web** no recurso da Oracle. Somente reiniciar um contêiner com a imagem antiga não aplica a correção. A API inicializa uma migração aditiva para as novas colunas de diagnóstico e o índice de pendências; não é necessário apagar volume, pedidos, estoque ou resultados. O usuário do banco que já inicializa o schema deve executar essa etapa; o worker ARM com papel restrito continua usando `SKIP_SCHEMA_INIT=true`.

Nenhuma nova variável é obrigatória no deployment normal. `MINISHOP_WORKER_CPUSET` é usado apenas pelo overlay opcional. Aguarde a fila terminar antes de mudar configurações/recriar contêineres durante uma demonstração. Confira no painel o modo observado e as threads confirmadas; a indicação de versão sem diagnóstico identifica workers ainda sem a atualização.

## Verificações da correção

- Compilação Release sem warnings/erros.
- 17 testes C# de integração: integridade de estoque, idempotência, pagamento, recuperação, limites; troca 8 → sequencial → 2 → distribuído com reset dos picos e conferência exata dos intervalos globais de pedidos; fechamento correto dos lotes.
- Auditoria com três processos reais nos oito cenários, antes e depois.
- Chromium: sete verificações de configuração aplicada, rascunho, campos desabilitados, sincronização externa, sequencial/8, três contêineres e erro 409 persistente. A loja também foi validada com compra real e login em outra aba.
- Falhas reais em Docker: estoque insuficiente, sobrecarga com 503, interrupção de worker e retomada sem duplicidade, loja acessível com API parada.

As evidências novas ficam em `results/concurrency/`. Os resultados de 20/10 permanecem históricos e pertencem à versão anterior. Após atualizar a VM, repita os benchmarks oficiais para medir o desempenho da nova versão no seu hardware.

A validação foi concluída localmente antes da autorização para publicar a correção no GitHub. A publicação foi autorizada pelo responsável pelo projeto; a implantação nos servidores reais continua pendente e deve seguir as instruções acima.
