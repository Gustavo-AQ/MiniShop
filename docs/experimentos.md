# Experimento reproduzível

## Carga e variáveis controladas

O gerador C# usa hash inteiro estável e semente 42 para determinar produto, quantidade 1–3 e pagamento fictício (~5% de recusa). Não depende de `Random` de uma versão do runtime. Cada execução tem IDs próprios para conservar histórico, mas índice/seed, produtos, quantidades, preços e pagamento são equivalentes. Os pedidos e itens ficam no banco e são exportados. O digest permite conferir que o trabalho CPU foi o mesmo.

Cada pedido executa N iterações de SHA-256 em uma cadeia de 32 bytes. N padrão = 50.000; ajuste uma vez antes da suíte e não altere entre cenários. SHA-256 pode usar instruções vetoriais da CPU; não usa GPU. O algoritmo determinístico e sua implementação C# são iguais em todos os modos. No benchmark há estoque suficiente: 3 × quantidade de pedidos em cada produto. Logo todos os pedidos executam a CPU, inclusive pagamentos recusados. O teste de falta de estoque é separado.

Atraso artificial deve ser **zero**. O endpoint de benchmark recusa atraso não zero. Use 2.500 ms apenas nas demonstrações visuais. Delay não representa ganho de CPU.

O benchmark usa a mesma fila e o mesmo custo de banco em todas as modalidades. Assim mede o sistema de ponta a ponta de processamento, incluindo coordenação, SQL e CPU, não somente um kernel CPU puro.

## Executar

1. Ligue o compose local com três workers, ou o doméstico com os três workers na VM. Pare o worker ARM para comparar no mesmo hardware.
2. Aguarde fila vazia; novas compras ficam bloqueadas durante cada lote. Não abra outra sessão gerando cargas durante a suíte.
3. Faça aquecimento com 100 pedidos e uma repetição em diretório separado; descarte esses resultados da análise principal.
4. Execute `bash scripts/benchmark.sh 5000 3`. Os sete cenários são sequencial; paralelo 2,4,8; distribuído 1,2,3. 1 thread paralela pode ser medida adicionalmente pelo painel, mas não faz parte dos sete mínimos.
5. Exportações: `runs.csv`, `runs.json`, `averages.csv` e um `*.orders.json` por lote. O banco preserva todos os lotes. Os arquivos CSV da suíte são regravados durante a execução; mova a pasta antes de iniciar outra campanha para não sobrescrever análises anteriores.

Para 100/500/1.000 pedidos, troque o primeiro argumento. Para outra carga, defina `BENCH_ITERATIONS` no `.env` antes de executar o serviço de benchmark. Se usar o CLI diretamente: `dotnet run -c Release --project src/MiniShop.Benchmarks -- 5000 3 results/minha-campanha`, com `ConnectionStrings__Shop` configurada.

A suíte configura o número de workers no banco, mantendo três processos disponíveis. Os excedentes aguardam slots, com heartbeat; essa escolha tem um pequeno custo constante e evita orquestração por código administrativo. Número configurado não garante três workers disponíveis: confira a tabela e o campo `actual_workers` no resultado. Após falha, conte tentativas e eventos, não somente o último nome do worker.

## Métricas

| Campo | Interpretação |
|---|---|
| `elapsed_ms` | relógio central do PostgreSQL: última conclusão − liberação do lote; exclui geração/inserção |
| `throughput` | total / tempo em segundos |
| `mean_service_ms`, min/max | tempo por tentativa final de processamento medido com Stopwatch C#; não inclui a fila; pedidos sem estoque têm zero |
| `mean_latency_ms`, `p95_latency_ms` | aceitação até estado final, **inclui fila**; 95% das latências ficam abaixo do p95 |
| approved/rejected | estados de negócio; recusas de pagamento não são erros técnicos |
| errors | eventos de exceção técnica capturados durante o processamento; erro de conexão que impede gravar evento só aparece no log |
| attempts | número de claims com reserva, incluindo recuperações |
| actual_workers / thread_ids | quantos processos finalizaram pedidos e IDs das threads (IDs só são únicos dentro de um processo) |
| environment | snapshots dos processos: host, PID, processadores lógicos disponíveis, CPU acumulada, memória residente, ativos e pico desde início |

O cronômetro de serviço é `Stopwatch`; o total distribuído usa o relógio único do banco para evitar comparar relógios de hosts diferentes. As métricas de CPU do processo incluem sua vida anterior e heartbeat, **não são um percentual nem CPU exclusivamente do lote**. Memória é amostra, não pico garantido. Para observação complementar use `docker stats` e registre o horário. Nenhum dado indisponível é inventado. Uma execução que não termina preserva seus pedidos e não recebe um tempo “bem-sucedido”; o CLI falha após 30 min de espera, sem apagar o lote.

Médias por pedido podem significar tempo de serviço ou tempo total / N (custo amortizado). Identifique qual está usando; vazão não é inverso da latência individual quando há concorrência. Recusas sem estoque podem ter nula `started_at`; `finished_at` e razão continuam registradas.

## Análise

Média aritmética de três repetições por cenário. Speedup = média sequencial ÷ média do cenário. Eficiência paralela = speedup ÷ N threads; não aplique esta fórmula aos workers como se fossem núcleos equivalentes. Um gráfico menor indica menor tempo total; speedup > 1 indica melhoria.

O painel agrupa por quantidade, iterações, modo e número de executores; dados de máquinas distintas **não devem ser misturados**. Faça exportação por campanha e compare apenas o mesmo ambiente. O histórico do painel é uma ferramenta de demonstração, não análise estatística com controle automático de hardware.

No Ryzen com VM de 4 vCPU, oito threads disputam quatro vCPU. Podem melhorar pouco, piorar ou ocultar esperas de I/O. Três contêineres no mesmo host dividem a mesma CPU e banco; não multiplicam os recursos físicos. Mutex curto de claim, locks de produtos, commits e custo de rede podem dominar cargas pequenas. Não selecione só a melhor repetição e não prometa speedup linear. Considere aquecimento JIT, cache, frequência dinâmica, carga do Windows e de outras aplicações, rede Tailscale/DERP, arquitetura ARM/x64 e virtualização.

## Conferência de correção

Para cada lote, aprovado + recusado = N, pendente = processando = 0. Stock final = 3N − soma das quantidades aprovadas por produto. Verifique um único evento FINALIZADO por pedido, ausência de estoque negativo e `attempts>1` apenas quando houve recuperação. Em casos de falha não classifique a computação repetida como venda duplicada; verifique o efeito persistido.

```sql
SELECT status,count(*) FROM orders WHERE run_id='UUID_DO_LOTE' GROUP BY status;
SELECT order_id,count(*) FROM events WHERE kind='FINALIZADO' GROUP BY order_id HAVING count(*)>1;
SELECT * FROM products WHERE stock<0;
SELECT p.id,p.stock,COALESCE(sum(i.quantity) FILTER(WHERE o.status='APROVADO'),0) vendido
FROM products p LEFT JOIN order_items i ON i.product_id=p.id
LEFT JOIN orders o ON o.id=i.order_id AND o.run_id='UUID_DO_LOTE'
GROUP BY p.id,p.stock;
```

Confira que o estoque ainda corresponde ao lote escolhido: uma reposição posterior muda o estoque atual. O JSON `final_stock` conserva o estoque no encerramento de cada execução.


No JSON de exportação, campos PostgreSQL `jsonb` (como `settings`, `result` e a agregação `items`) são retornados pelo driver como strings JSON. Use uma desserialização adicional nesses campos ao analisar programaticamente; o CSV já apresenta as métricas em colunas. O painel trata ambas as representações.
