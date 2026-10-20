# Desenvolvimento, API e testes

## Sem Docker para os processos C#

Instale SDK .NET 10 LTS. Um PostgreSQL 17 real é necessário; não há substituto em memória que finja os testes de concorrência.

```bash
dotnet build MiniShop.slnx -c Release
export ConnectionStrings__Shop='Host=localhost;Port=5432;Database=minishop;Username=minishop;Password=SUA_SENHA;Timeout=5'
export ServiceKey='CHAVE_DE_SERVICO_ALEATORIA_32_OU_MAIS'
export AdminKey='OUTRA_CHAVE_ADMIN_ALEATORIA_32_OU_MAIS'
export AdminPassword='SENHA_LOCAL_FORTE_16_OU_MAIS'
export ApiBaseUrl='http://localhost:5081'
# Terminais separados, mesmas variáveis:
ASPNETCORE_URLS=http://localhost:5081 ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/MiniShop.Api
ASPNETCORE_URLS=http://localhost:8080 ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/MiniShop.Web
dotnet run --project src/MiniShop.Worker
# Repita o worker em outros dois terminais para o distribuído.
```

Não configure `SKIP_SCHEMA_INIT=true` antes de criar o schema com a API. Esta variável é reservada ao worker opcional com privilégios restritos.

Para aplicar configuração por ambiente, com fila vazia:

```bash
Processing__Mode=parallel Processing__Threads=4 dotnet run --project src/MiniShop.Worker -- --configure
```

A configuração fica no PostgreSQL e pode ser alterada pelo painel. Não se redefine silenciosamente a configuração a cada reinício de worker.

## API privada

Todas as rotas, exceto `/api/health`, exigem `X-Service-Key`. Rotas administrativas exigem também `X-Admin-Key`. Mantenha as chaves fora do navegador e do Git. OpenAPI: `/openapi/v1.json` **somente em Development**, também com chave de serviço. O projeto fornece o documento OpenAPI; não depende de Swagger UI hospedado externamente.

| Método e rota | Contrato |
|---|---|
| GET `/api/products` | catálogo de dois produtos e disponível |
| POST `/api/orders` | `{"items":[{"productId":1,"quantity":2}]}`; header `Idempotency-Key` obrigatório |
| GET `/api/orders/{uuid}` | estado, motivo, itens e auditoria básica |
| GET `/api/health` | 200 se DB responde; 503 caso contrário |
| GET `/api/admin/metrics` | estoque, estados, workers, fila, pedidos, eventos e lotes |
| PUT `/api/admin/settings` | `{"mode":"parallel","threads":4,"workers":1,"iterations":50000,"delayMs":0,"queueLimit":10000}` |
| POST `/api/admin/stock/reset` | `{"stock":100}`; define disponível de ambos os produtos |
| POST `/api/admin/tests/start` | `{"count":5000,"seed":42,"settings":{"mode":"distributed","threads":1,"workers":3,"iterations":50000,"delayMs":0,"queueLimit":10000}}` |
| GET `/api/admin/tests/{uuid}` | configuração, progresso via métricas e resultado final |
| GET `/api/admin/tests/{uuid}/orders` | todos os pedidos e itens do lote, exportáveis |

202 é admissão, não aprovação. 400 indica dados inválidos, 401 chave ausente/inválida, 404 recurso inexistente, 409 conflito de idempotência ou tentativa de alterar condições com trabalho ativo, 503 fila cheia/banco indisponível/benchmark exclusivo. Recusa por estoque/pagamento é estado final RECUSADO, pois o pedido já foi aceito na fila. Consulte-o por GET. O rate limiter do site pode responder 429; isso é distinto do limite persistido de fila, que retorna 503.

Exemplo em terminal com variáveis previamente definidas, sem imprimir credenciais:

```bash
curl -H "X-Service-Key: $ServiceKey" http://localhost:5081/api/products
curl -X POST http://localhost:5081/api/orders \
  -H "X-Service-Key: $ServiceKey" -H 'Idempotency-Key: exemplo-compra-001' \
  -H 'Content-Type: application/json' --data '{"items":[{"productId":1,"quantity":1}]}'
```

## Testes automatizados C#

**Use banco descartável separado.** A suíte trunca as tabelas no início de cada teste. Nunca aponte para a implantação ou para resultados que deseja preservar.

```bash
docker run -d --name minishop-test-db \
  -e POSTGRES_USER=minishop -e POSTGRES_PASSWORD=senha-somente-teste \
  -e POSTGRES_DB=minishop_test -p 127.0.0.1:55432:5432 postgres:17-alpine
export MINISHOP_TEST_DB='Host=127.0.0.1;Port=55432;Database=minishop_test;Username=minishop;Password=senha-somente-teste'
dotnet test MiniShop.slnx -c Release --logger trx --results-directory TestResults
```

Cobertura: compra suficiente/insuficiente; pagamento e devolução; concorrência sobre cinco unidades; estoque não negativo; idempotência concorrente e conflito de carrinho; token antigo inválido, reserva única e recuperação; limite de fila e proteção de reset; CPU determinística; sete combinações de modos com finalização, eventos e reconciliação do estoque.

Os testes de modos instanciam três motores isolados logicamente no mesmo processo de teste para exercitar as travas PostgreSQL. **Isso não substitui a validação com processos/contêineres**, realizada pelo smoke test descrito no relatório. `scripts/smoke.py` opera uma instalação local de demonstração por HTTP e testa interrupção real via Compose. Ele cria pedidos, muda condições e reinicializa estoque; execute apenas no ambiente descartável indicado.


## Verificações operacionais opcionais

Após iniciar o Compose **local e descartável**, execute `python3 scripts/smoke.py` e `python3 scripts/durability-smoke.py`. Ambos alteram estoque/configuração e interrompem exclusivamente serviços MiniShop locais. Não os execute durante um benchmark. Para a interface existe `scripts/ui-smoke.cjs`, usando Playwright/Chromium como ferramenta de teste opcional; não é dependência do site. O relatório registra as verificações realizadas aqui sem exigir Node ou Python para executar os serviços C#.
