# Análise dos materiais

Foram lidos integralmente os dois PDFs recebidos em 20/10/2026:

1. **Arquiteturas paralelas e distribuídas: como construir cada uma**, Prof. Eng. Nicolas Vogiantzis, 18 páginas. Nos slides 16 e 17, exige identificar tarefas independentes, divisão/combinação do trabalho, escolha de threads/processos, nós, comunicação, dados, consistência e falhas. Exige carga igual, versão simples, 2/4/8 threads, 1/2/3 servidores **ou contêineres**, queda de um nó e explicação de resultados reais.
2. **Roteiro do trabalho — Sistema de Processamento de Pedidos**, 5 páginas, proposta do grupo. Acrescenta C#/Docker, lote de 5.000 pedidos com semente fixa, reserva de estoque, pagamento simulado, exportação, repetições e recuperação. O próprio roteiro diferencia essas escolhas das exigências originais do professor.

Não há incompatibilidade entre a mensagem e os PDFs. Três contêineres em um host atendem ao teste de contêineres do slide 17, mas **não demonstram três computadores físicos**. O worker ARM opcional permite mostrar dois hosts reais. Não afirmamos que a versão distribuída será mais rápida.

| Exigência | Implementação/evidência |
|---|---|
| Mesma carga | `Workload.Generate`, semente 42, algoritmo versionado `dataset-v1`; snapshot da configuração em cada execução |
| Sequencial | um processo eleito e uma thread; registro de tempo e resultado |
| 2/4/8 threads | threads C# dedicadas no mesmo processo; logs, thread ID e pico de operações |
| 1/2/3 contêineres | serviços `worker-1/2/3`; slots de coordenação no banco |
| Comunicação | HTTP entre site/API; protocolo PostgreSQL entre workers/banco |
| Consistência | transações, locks em ordem, constraint estoque ≥ 0 e conclusão única |
| Queda de nó | interrupção abrupta, lease expira, outro worker recupera e token antigo perde validade |
| Medições | histórico no banco, CSV/JSON, tabela e gráfico de médias/speedup |
| Apresentação real | roteiro operacional, relatório de execução e resultados históricos identificados |

Os PDFs originais não foram republicados no repositório; os nomes completos recebidos foram `Arquiteturas-paralelas-e-distribuidas-como-constru_261020_082027.pdf` e `Roteiro_Trabalho_Processamento_de_Pedidos_261020_093801.pdf`.
