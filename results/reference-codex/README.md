# Evidência histórica — Codex, 20/10/2026 UTC

Campanha real com 5.000 pedidos por lote, sete cenários e três repetições: 105.000 pedidos. Semente 42; dataset-v1; 5.000 iterações SHA-256 por pedido; atraso artificial zero. O padrão do projeto é 50.000 iterações e não deve ser confundido com esta campanha.

Ambiente Linux amd64 em Docker, três processadores lógicos disponíveis e cerca de 9,7 GiB de RAM. SDK local .NET 10.0.402, PostgreSQL 17.11. Não é o Ryzen/Hyper-V nem a Oracle. Nenhuma outra compilação/teste pesado foi executado em paralelo à campanha final. As medições preliminares de depuração não integram estes 21 registros.

- `runs.csv`: métricas em colunas de todas as repetições.
- `runs.json`: registros completos, configuração, ambiente e resultado.
- `averages.csv`: médias e speedup calculados pelo programa C#.
- `orders.tar.gz`: 21 arquivos JSON, cada um com os 5.000 pedidos e itens do respectivo lote.
- `audit.json`: auditoria dos 105.000 registros, equivalência de dados/pagamentos/digests e reconciliação de estoques. Um vetor SHA-256 foi conferido por implementação independente.
- `benchmark.svg` / `benchmark.png`: gráfico dos dados reais, exportável.

Em todos os lotes: 4.739 aprovados, 261 recusados por pagamento fictício, zero erros técnicos registrados e tentativas = 5.000. Os dois estoques finais foram 10.181 e 10.365, correspondendo a 15.000 unidades iniciais por produto menos vendas aprovadas. Os trabalhadores efetivos foram 1/2/3 nos respectivos cenários distribuídos.

Os campos jsonb do driver aparecem como strings JSON dentro das exportações JSON; desserialize novamente `settings`, `result` ou `items` quando necessário. Não há informações pessoais de compradores: todos os clientes são fictícios.

O painel ao vivo pode incluir outros testes de desenvolvimento em seu histórico. Para esta campanha, use os 21 IDs deste diretório. Repita no hardware final antes da apresentação e identifique qualquer resultado histórico como tal.
