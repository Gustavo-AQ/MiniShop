# Painel do moderador — tema Sálvia

O painel `/Admin` mantém a autenticação e as operações reais da API. O tema usa fundo marfim, superfícies claras e verde-sálvia, com âmbar, azul e terracota suaves para distinguir os estados. A loja mantém sua identidade visual compatível com essa paleta.

## Como usar

1. **Visão geral:** os quatro indicadores mostram todos os pedidos registrados, incluindo compras e benchmarks. O gráfico circular repete as contagens com cores e legenda textual. A configuração aplicada é a resposta da API, separada do formulário de edição.
2. **Configurar execução:** escolha sequencial, paralelo ou distribuído. Apenas o seletor relevante fica habilitado. Em “Carga de trabalho e limites”, ajuste esforço de CPU, atraso artificial e capacidade da fila. A alteração só vale após aplicar; mudanças ainda não enviadas ficam sinalizadas e são preservadas durante as atualizações.
3. **Testes e estoque:** os três cartões separam benchmark, envio simultâneo de compras e definição de estoque. O benchmark usa os valores do formulário e exige atraso zero. O envio simultâneo usa a configuração já aplicada e o estoque atual. O estoque informado substitui o saldo de cada produto. As respostas aparecem junto ao formulário utilizado.
4. **Progresso:** acompanha o lote em andamento ou o último lote executado. O percentual usa o número real de pedidos finalizados; não é uma animação de tempo estimado.
5. **Workers:** os cartões mostram o papel de cada processo, threads habilitadas, pedidos ativos, CPU e RAM. Threads habilitadas não significam cálculos ativos. Por padrão, cartões e diagnóstico exibem somente workers online. O filtro permite consultar offline cujo último sinal foi recebido nos últimos 7 ou 30 dias; o filtro também vale para a tabela técnica. O resumo geral de workers online não muda com o filtro. O diagnóstico completo fica em uma seção expansível. A CPU usa 100% por processador lógico; a barra representa a fração da capacidade de processadores informada pelo runtime. Sem sinal recente, o cartão identifica o processo como offline e não apresenta sua CPU antiga como leitura atual.
6. **Resultados:** selecione as condições do lote. O gráfico reúne apenas execuções concluídas com igual quantidade de pedidos, iterações, semente e atraso. Cada barra mostra a média, o número de repetições (`n`) e o speedup relativo à média sequencial. Sem referência sequencial, não há speedup. Tempos e gráficos são calculados sobre os resultados persistidos. Compare testes da mesma versão e ambiente; o painel não identifica automaticamente mudanças de hardware ou versão do código.
7. **Histórico e auditoria:** selecione quantos lotes deseja ver; a exportação preserva todos os registros recebidos da API, até 1.000. As tabelas têm rolagem interna e cabeçalhos fixos. Pedidos recentes mostram o motivo do resultado. Identificadores abreviados exibem o valor completo ao passar o mouse; a exportação mantém os identificadores dos lotes completos. Horários usam o fuso do navegador.

O painel consulta as métricas aproximadamente a cada 2 segundos, após o término da consulta anterior. Se a API falhar, o aviso identifica os valores como dados da última consulta. Não há gráficos fictícios, dependências de CDN ou biblioteca JavaScript de gráficos. A visualização usa HTML, CSS, SVG e JavaScript básico; todas as regras de pedidos e concorrência continuam em C#.

## Validação local

- Build Release da solução sem erros ou avisos; imagem Docker Web construída e executada.
- 19 testes C# de integração com PostgreSQL descartável: aprovados, incluindo limpeza com fila ocupada e preservação de estoque, configuração e proteção contra reenvios.
- `scripts/admin-design-smoke.cjs`: valida o painel autenticado, quatro benchmarks reais pequenos, médias dos gráficos, separação de cargas, progresso, exportação, seleção do histórico, detalhes expansíveis e telas de 1440, 1024, 768, 390 e 320 pixels. Também testa respostas vazias e indisponibilidade usando interceptação **somente no navegador de teste**. As capturas mostram dados reais da API local.
- Os scripts de regressão existentes conferem compra, carrinho, login, troca de modos, limites observados e preservação do formulário.

Para repetir os testes de navegador, inicie o Compose local com uma `.env` de desenvolvimento, tenha Playwright disponível para o Node.js e Chromium instalado. Execute:

```bash
node scripts/admin-design-smoke.cjs
node scripts/concurrency-ui-smoke.cjs
node scripts/ui-smoke.cjs
```

Esses scripts são para o ambiente local descartável: geram pedidos, alteram configurações e produzem evidências. O teste novo restaura a configuração inicial ao terminar; pedidos e benchmarks gerados ficam registrados. Os scripts antigos atualizam suas próprias evidências históricas, portanto revise os arquivos alterados antes de fazer um commit.

Capturas e relatório da interface ficam em [`results/interface/`](../results/interface/). São evidências do ambiente de desenvolvimento; não representam uma execução na infraestrutura doméstica ou na Oracle.

## Limpeza do histórico

A seção **Limpar histórico**, acessível pelo menu lateral, exige digitar `APAGAR HISTORICO`. A Web envia uma requisição com autenticação e antiforgery para `POST /api/admin/history/clear`, com JSON `{"confirmation":"APAGAR HISTORICO"}`. A API exige as chaves de serviço e administrativa. Retorna 400 se a frase estiver incorreta, 409 com pedidos/benchmarks em andamento e 200 com as quantidades apagadas quando conclui.

A limpeza mantém produtos, estoque, configuração e workers online. Apaga pedidos, itens, eventos, benchmarks e workers offline, inclusive os mais antigos que não aparecem nos filtros. As quatro tabelas de histórico são esvaziadas em uma transação, sob o mesmo bloqueio de admissão das compras e com a fila vazia. Não usa `CASCADE` para alcançar tabelas externas. Os registros de workers online continuam recebendo seus sinais normalmente.

A tabela técnica `retired_order_keys` guarda somente SHA-256 das chaves das compras apagadas. Ela não contém carrinhos, valores ou identificadores dos pedidos. Reenviar uma chave aposentada retorna 409, sem gerar uma nova compra; consultar o pedido apagado retorna 404. Isso preserva a garantia de idempotência mesmo depois da limpeza. Uma compra nova usa uma chave nova. Exportações JSON já baixadas ou arquivos CSV no disco não são apagados.

### Teste isolado da limpeza

O teste de navegador da limpeza é **destrutivo** e usa um banco dedicado, fora do ambiente principal. O relatório está em [`results/history/`](../results/history/). Os registros offline de 1, 10 e 40 dias são fixtures sintéticas identificadas no relatório; os três processos online, a compra, o benchmark e a exclusão são reais.

Em uma instalação local de testes, com Docker, .NET 10, Python 3, Playwright e Chromium disponíveis, crie um PostgreSQL descartável (se esse contêiner de teste já existir, use-o):

```bash
docker run -d --name minishop-concurrency-test -p 127.0.0.1:55433:5432 \
  -e POSTGRES_USER=minishop -e POSTGRES_PASSWORD=concurrency-test-only \
  -e POSTGRES_DB=minishop_test postgres:17-alpine
# Aguarde pg_isready indicar que o banco está pronto.
docker exec minishop-concurrency-test pg_isready -U minishop
docker exec minishop-concurrency-test psql -U minishop -d postgres \
  -c 'CREATE DATABASE minishop_history_ui'
dotnet build MiniShop.slnx -c Release
python3 scripts/history-test-server.py
```

Tenha uma `.env` local com as chaves e senha de administração. O script usa apenas essas credenciais e inicia seus próprios processos em **5580/5581**, ligados exclusivamente ao banco `minishop_history_ui`. Ele não usa o banco principal nem reinicia os contêineres da demonstração. Em outro terminal, execute `node scripts/history-ui-smoke.cjs`. Ao terminar, use Ctrl+C no servidor de teste. O teste deixa uma compra nova registrada para demonstrar que a loja continua operando.

## Implantação

Após publicar, faça rebuild/redeploy da **API primeiro** e depois do **Web** no Coolify. A inicialização da API cria a tabela técnica de idempotência em uma migração aditiva. O usuário que já inicializa o schema deve ter permissão para criá-la e esvaziar as tabelas de histórico. Não apague o volume do PostgreSQL. Não há nova variável de ambiente obrigatória. Os workers não precisam de alterações para a limpeza, mas devem estar na versão com os diagnósticos de concorrência. Os arquivos CSS e JavaScript recebem versão na URL para atualizar o cache do navegador.
