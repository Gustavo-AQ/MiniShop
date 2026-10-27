# Apresentação presencial — aproximadamente 10 minutos

A aba administrativa **Apresentação** (`/Presentation`) oferece nove slides interativos para explicar o projeto. Veja os [controles e modelos didáticos](apresentacao-interativa.md). As animações são explicativas; use o roteiro abaixo para demonstrar o comportamento real no painel.

## Preparação (antes da aula)

Teste a VM, internet doméstica, energia, Tailscale, SSH, recursos Coolify, DNS e HTTPS. Desative suspensão do Windows. Abra loja e painel em abas separadas. Deixe um terminal SSH do operador conectado à VM para controlar apenas os contêineres MiniShop, ou abra os controles individuais de serviço no Coolify. O computador da faculdade pode usar o terminal web do Coolify no navegador; não precisa de SDK ou Docker.

Faça o benchmark completo de 5.000 × 3 repetições **antes** da aula no hardware final. Exporte CSV/JSON e mantenha uma cópia local dos resultados e capturas. Não tente esperar 21 lotes longos dentro dos dez minutos. Durante a aula use 100 pedidos com CPU suficiente e dados históricos identificados para a comparação completa.

Defina os nomes do grupo e leve `docs/slides.html` (quando gerado a partir dos resultados) ou apresente as nove seções abaixo como slides. Ao mostrar resultados pré-coletados diga local, data, quantidade e iterações. Não os apresente como execução ao vivo.

## Roteiro

| Tempo | Ação e explicação |
|---|---|
| 0:00–0:50 | Título, integrantes, objetivo. Mostre arquitetura: navegador → Oracle → API doméstica → fila PostgreSQL → workers. Dois produtos; pagamento fictício. |
| 0:50–1:30 | No painel: sequencial, atraso 0, estoque 100. Na loja adicione uma unidade e finalize. Mostre ID e estado final; pode ocorrer recusa fictícia de pagamento (~5%), explicando o motivo. Não há cobrança real. |
| 1:30–2:15 | Fila vazia: paralelo 4, atraso 0, estoque 5. No painel envie 20 compras simultâneas do produto 1. Mostre aprovados/recusados e estoque ≥ 0; recusas de pagamento podem permitir menos de cinco vendas. Explique a transação. |
| 2:15–3:10 | Configure sequencial, atraso 0 e carga CPU fixa (por exemplo 50.000). Inicie benchmark de 100. Mostre apenas um worker com um pedido ativo. |
| 3:10–4:10 | Ao terminar, repita com paralelo 4, o mesmo lote/carga; mostre pico e thread IDs nos logs. Compare tempo; não prometa ganho linear. Use histórico para as séries 2/4/8. |
| 4:10–5:00 | Distribuído 3, atraso 0: inicie outro lote de 100. Mostre três PIDs/contêineres. Esclareça que os três dividem um host; opcionalmente mostre ARM na Oracle e x64 na VM, se essa topologia foi validada. |
| 5:00–5:50 | Fila vazia: paralelo 2, atraso 2.500 ms, limite de fila 5; envie 30 compras. Mostre espera, ocupação e resumo HTTP 202/503. 202 ainda não é aprovação. Aguarde esvaziar. |
| 5:50–7:25 | Distribuído 3, atraso 2.500 ms, limite 1000, estoque 100. Envie 24 compras (não benchmark: o benchmark exige atraso 0). Com três workers ocupados, pare worker-2 abruptamente. Mostre os dois restantes e depois evento RECUPERADO (até 15 s após última renovação + espera de fila). Mostre `attempts=2`, conclusão e unicidade do evento final. Reinicie worker-2. |
| 7:25–8:05 | Pare temporariamente a API; atualize a loja. O HTML continua carregando e exibe indisponibilidade em poucos segundos. Reinicie a API. |
| 8:05–9:20 | Apresente tabela/gráfico dos sete cenários com três repetições de 5.000. Identifique histórico e ambiente. Explique CPU, banco, contenção, rede e por que 8 threads em 4 vCPU pode saturar. |
| 9:20–10:00 | Conferência final: aprovados + recusados = total; estoque correto; nenhuma venda duplicada; cálculo pode ser repetido na recuperação, efeito final não. Limites: banco único e dependência do PC doméstico. |

## Comandos do operador

No clone da VM, use `docker compose --env-file .env -f deploy/compose.home.yml` como prefixo. Localmente, `bash scripts/compose.sh`. Substitua abaixo `COMPOSE` por um desses prefixos completos, sem executar a palavra literalmente.

```bash
COMPOSE ps
COMPOSE logs -f --tail=40 worker-1 worker-2 worker-3
# SIGTERM sem espera e SIGKILL: interrupção abrupta de um único serviço
COMPOSE stop -t 0 worker-2
COMPOSE start worker-2
COMPOSE stop api
COMPOSE start api
```

O restart `unless-stopped` não traz de volta um serviço parado manualmente; `start` reativa. Para evidência de falha preserve logs/eventos e capture os estados. Não reinicie o Docker daemon, a VM inteira ou o Coolify durante a apresentação. Logs contêm IDs e digest, nunca chaves.

Para exibir SQL, abra o psql dentro do serviço `db` com o usuário/banco configurados e execute as consultas de `experimentos.md`. No painel, a tabela de auditoria mostra eventos recentes e os pedidos mostram tentativas; para histórico completo use SQL/exportação do lote.

## Contingência honesta

- **Internet da faculdade falhou:** abra os slides HTML e capturas previamente salvos no navegador, sem internet. Informe que são resultados históricos. Mostre o vídeo/capturas da queda do worker se coletado antes. Não finja executar remoto.
- **PC doméstico indisponível e internet funciona:** o site Oracle continua servindo HTML e informa que pedidos estão indisponíveis. Use os resultados históricos salvos; não migre banco/carga pesada às pressas para Oracle compartilhada.
- **Máquina de apoio disponível:** previamente instale Docker e clone o projeto nela; inicie o Compose local e acesse localhost. Essa opção precisa ser preparada antes; não é requisito para o computador da faculdade.
- **Ambiente de apresentação diferente do medido:** identifique explicitamente a diferença. Não misture tempos de Codex, Ryzen e Oracle no mesmo cálculo de speedup.

O roteiro cabe em dez minutos desde que os lotes ao vivo sejam pequenos e os completos estejam coletados. Ensaie uma vez cronometrando o intervalo real da recuperação. Use atraso visual só nas falhas; desligue antes de qualquer benchmark.
