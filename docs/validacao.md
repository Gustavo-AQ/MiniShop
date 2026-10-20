# Validação executada

Ambiente de desenvolvimento Codex Linux amd64, 3 processadores lógicos disponibilizados e aproximadamente 9,7 GiB de RAM. Não é a VM Hyper-V final nem a Oracle. Data: 20/10/2026 UTC.

## Verificações concluídas

- Compilação Release da solução .NET 10 sem warnings nem erros.
- 15 testes C# xUnit com PostgreSQL 17 real: todos passaram, nenhum ignorado. Evidência TRX em `results/validation/integration.trx`.
- Build e execução real das imagens Api, Web, Worker e Benchmarks; serviços sem root, com verificações de saúde, volume PostgreSQL e reinício configurado.
- Smoke HTTP real: chaves exigidas, idempotência, vinte compras simultâneas sobre cinco unidades, estoque reconciliado, fila limitada com HTTP 503.
- Três processos em três contêineres: interrupção abrupta de worker-2 quando tinha uma reserva; outro recuperou o pedido com segunda tentativa, finalização única, sobreviventes continuaram. IDs/evidência em `results/validation/smoke.json`.
- Reinício real do PostgreSQL e API com cinco pedidos aguardando e workers parados: pedidos preservados e concluídos depois da retomada (`durability.json`).
- API parada: HTML da loja permaneceu disponível e consulta respondeu 503 em prazo limitado.
- Chromium real: catálogo com dois produtos da API, carrinho, quantidade, remoção, compra pela interface com antiforgery até estado final, versão móvel sem overflow, acesso protegido e login do painel. Capturas e `ui.json` em `results/validation/`.
- OpenAPI em Development: documento gerado realmente, dez caminhos, rotas de pedidos e testes presentes (`openapi.json`).
- Manifesto da imagem oficial ASP.NET 10 confirmado com linux/amd64 e linux/arm64.

## Campanha auditada

A campanha histórica foi concluída e auditada: **21 lotes, 105.000 pedidos**, 5.000 iterações CPU por pedido e atraso zero. Todos os lotes tiveram 4.739 aprovações, 261 recusas fictícias de pagamento e zero erros técnicos registrados. As entradas, pagamentos e digests coincidiram, e os estoques finais foram reconciliados em todas as repetições. Nos testes distribuídos, a quantidade de processos que finalizou pedidos coincidiu com 1/2/3 configurados. Veja `results/reference-codex/audit.json`, CSVs, JSON e `orders.tar.gz` (todos os pedidos exportados).

A comparação está em [comparacao.md](comparacao.md), e a apresentação tem nove slides em HTML/PDF. As quatro imagens finais foram construídas e executadas; API, web e três workers ficaram saudáveis. O usuário não root (UID 1654) conseguiu gravar a chave de autenticação no volume persistente. A sintaxe dos quatro cenários Compose e do overlay privado também foi validada com variáveis de exemplo.

Não use os tempos deste ambiente para prometer desempenho no Ryzen. A carga padrão do projeto (50.000 iterações) pode ser maior do que a campanha de desenvolvimento; identifique o parâmetro ao comparar.

## O que depende da infraestrutura real

Não foram testados nem alterados: Oracle ARM64, Hyper-V/Windows, Coolify existente, Traefik, DNS/HTTPS Cloudflare, chaves SSH reais, Tailscale entre hosts e worker físico na Oracle. O build/execução efetiva ARM64 permanece a validar. Os arquivos e o manual preparam essas etapas, mas uma imagem base multiarch não prova execução ARM nesta sessão.

O workflow GitHub Actions foi preparado, mas não executado remotamente: nenhum repositório GitHub de destino foi fornecido.
