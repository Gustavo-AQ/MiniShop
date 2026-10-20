# MiniShop — pedidos em C#

Loja acadêmica funcional com dois produtos, Razor Pages, API ASP.NET Core, PostgreSQL e workers .NET 10 LTS. Compara **sequencial, paralelo (2/4/8 threads) e distribuído (1/2/3 processos)** usando a mesma rotina de CPU e as mesmas regras de negócio.

## Começar localmente

Pré-requisitos: Docker Engine + Compose v2 (ou Docker Desktop), Git, Bash e Python 3 para gerar segredos. A aplicação não precisa de Python: toda a lógica e os testes são C#.

```bash
git clone https://github.com/Gustavo-AQ/MiniShop.git
cd MiniShop
bash scripts/new-env.sh
bash scripts/compose.sh up -d --build
```

Abra **http://localhost:8080**. Painel: **http://localhost:8080/Admin**; senha `ADMIN_PASSWORD` do arquivo `.env` local. Não publique esse arquivo. O gerador cria senhas aleatórias; não há uma senha universal. A API fica em `127.0.0.1:5081`, protegida por chave. PostgreSQL não publica porta.

Os três contêineres worker ficam ligados. No modo sequencial apenas um assume a execução; no paralelo um assume o lote com N threads; no distribuído até N processos assumem uma tarefa cada. Selecione o modo no painel com a fila vazia. Isso não cria novos contêineres nem distribui Compose entre servidores.

```bash
bash scripts/compose.sh ps
bash scripts/compose.sh logs -f worker-1 worker-2 worker-3
# 7 cenários × 3 repetições; pode levar vários minutos
bash scripts/compose.sh --profile tools build benchmark
bash scripts/benchmark.sh 5000 3
# Encerrar sem apagar o banco
bash scripts/compose.sh down
```

Resultados reais são gravados em `results/live/`. O painel também inicia lotes e exporta seu histórico. **Nunca use `down -v` na implantação: apaga o volume.**

## Estrutura

| Caminho | Responsabilidade |
|---|---|
| `src/MiniShop.Core` | contratos, validações, lote determinístico e trabalho SHA-256 |
| `src/MiniShop.Infrastructure` | SQL, transações, fila, leases, processamento e métricas |
| `src/MiniShop.Api` | REST privada, autenticação por chaves, OpenAPI em desenvolvimento |
| `src/MiniShop.Worker` | processo consumidor; threads dedicadas com limite configurável |
| `src/MiniShop.Web` | loja e painel Razor Pages; proxy HTTP no servidor |
| `src/MiniShop.Benchmarks` | suíte de sete cenários, repetições e exportação |
| `tests/MiniShop.Tests` | testes C# de integração com PostgreSQL real |
| `deploy/` | Dockerfile multi-stage, quatro topologias e overlay privado opcional |
| `docs/` | análise dos PDFs, arquitetura, operação, experimento e apresentação |

## Documentação

- [Análise dos materiais acadêmicos](docs/requisitos.md)
- [Arquitetura, integridade e limites](docs/arquitetura.md)
- [Execução, API e testes](docs/desenvolvimento.md)
- [Oracle, Hyper-V, Tailscale e Coolify](docs/implantacao.md)
- [Benchmarks e interpretação](docs/experimentos.md)
- [Roteiro de 10 minutos e contingência](docs/apresentacao.md)
- [Relatório de validação realizada](docs/validacao.md)
- [Comparação real dos sete cenários](docs/comparacao.md)
- [Apresentação em PDF — 9 slides](docs/apresentacao.pdf)
- [Slides HTML para abrir no navegador](docs/slides.html)

## Pontos essenciais

PostgreSQL é a fonte de verdade. A admissão é idempotente; a reserva é transacional; pagamentos recusados devolvem a reserva. Workers usam `FOR UPDATE SKIP LOCKED`, posse renovável de 15 s e token por tentativa. Um worker antigo não consegue concluir após outro recuperar o pedido. Não há pagamento real nem promessa de executar CPU exatamente uma vez: garantimos um único efeito final persistido.

**Implantação real ainda exige configurar seus servidores.** Nenhum acesso à Oracle ou ao computador doméstico foi feito. Use recursos separados no Coolify para a Oracle e a VM, seguindo o manual. O servidor da faculdade só precisa de navegador e internet.


## Evidências desta entrega

15 testes C# passaram contra PostgreSQL real. A campanha histórica processou 105.000 pedidos (5.000 × 7 cenários × 3 repetições) sem erros técnicos registrados. Uma auditoria dos arquivos confirmou equivalência de dados, pagamentos e digests e reconciliou os estoques de todos os lotes. A carga dessa campanha foi 5.000 iterações por pedido, diferente do padrão 50.000 do projeto.

As médias foram 45,60 s no sequencial, 31,26/29,27/30,30 s com 2/4/8 threads e 44,52/28,93/29,52 s com 1/2/3 workers. Esses tempos são do ambiente de desenvolvimento; repita na VM final. Os CSV/JSON e exportações dos 21 lotes estão em `results/reference-codex/`. Consulte as limitações e os testes ainda pendentes no relatório.


## Repositório GitHub

Publicado em **https://github.com/Gustavo-AQ/MiniShop**, branch `main`. O GitHub Actions compilou a solução e aprovou os 15 testes de integração em [execução remota verificada](https://github.com/Gustavo-AQ/MiniShop/actions/runs/39461154897).

### Publicar uma cópia na sua conta

O ZIP contém fontes e evidências, sem credenciais nem metadados `.git`. Se estiver usando o ZIP, inicialize o Git e configure sua identidade Git antes do primeiro commit. Crie um repositório vazio na sua conta e execute na raiz:

```bash
git init -b main
git add .
git commit -m "Projeto acadêmico MiniShop"
git remote add origin git@github.com:SEU_USUARIO/MiniShop.git
git push -u origin main
```

Se usar o repositório local já inicializado desta entrega, basta cadastrar seu remoto e enviar a branch. Depois conecte esse repositório aos recursos separados do Coolify, conforme `docs/implantacao.md`.
