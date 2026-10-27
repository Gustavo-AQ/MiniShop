# Aula interativa no site

A rota **`/Presentation`** contém nove slides no tema Sálvia. O link **Apresentação** aparece na navegação após entrar com a senha administrativa. O painel também oferece o atalho **Abrir aula interativa**. O acesso direto é protegido por `[Authorize]`, assim como o painel; visitantes são enviados ao login. Após autenticar, o navegador retorna à página local solicitada. Destinos externos não são aceitos pelo retorno do login.

## Como apresentar

- Use **Anterior/Próximo**, os capítulos na lateral ou as teclas **← / →**. **Home / End** vão ao primeiro/último slide. As teclas não trocam slides enquanto você opera um seletor ou slider.
- O botão **Tela cheia** usa o modo de apresentação do navegador; **Esc** sai. Se o navegador não oferecer essa função, o aviso recomenda o modo próprio do navegador.
- Os endereços `#slide-1` a `#slide-9` permitem abrir um capítulo diretamente, por exemplo `/Presentation#slide-5`.
- Expanda **Notas para apresentar** para consultar a explicação e o tempo sugerido. O roteiro completo narrado leva cerca de 9–10 minutos; para incluir uma demonstração real nesse tempo, resuma as animações e siga [`apresentacao.md`](apresentacao.md).
- No final, abra painel e loja em abas separadas. Os links dos resultados reais também abrem outra aba para preservar o ponto da aula.
- A reprodução automática é opcional e pausa ao trocar de slide ou ocultar a página. Com movimento reduzido no sistema, o avanço fica manual.

## Capítulos e interações

| Slide | O que explica | O que o apresentador pode fazer |
|---|---|---|
| 1. A ideia | O mesmo trabalho em três modos | Selecionar sequencial, paralelo ou distribuído para destacar o caminho e ler sua explicação |
| 2. A arquitetura | Oracle, rede privada, API, PostgreSQL e workers | Clicar nos componentes para explorar suas responsabilidades |
| 3. Um pedido por dentro | Recepção, validação, reserva, CPU, pagamento e conclusão | Avançar as etapas; escolher pagamento aprovado ou recusado e observar a reserva voltar |
| 4. Processo, thread e CPU | Diferença entre processo, thread, vCPU e contêiner | Selecionar as peças e explicar o uso observado no Beszel |
| 5. Sequencial e paralelo | Threads habilitadas versus capacidade de executar na CPU | Variar 1/2/4/8 threads e 1–8 vCPU no modelo; avançar ou reproduzir o revezamento |
| 6. Distribuição e retomada | Fila persistida, leases, tokens e recuperação | Variar 1–3 workers, interromper/reiniciar processos ilustrativos e recuperar o pedido abandonado |
| 7. Falhas sob controle | Sobrecarga com 202/503 e independência da Web | Arrastar a capacidade da fila e simular indisponibilidade da API |
| 8. Como medir | Condições equivalentes, repetições e interpretação de speedup | Alterar tempos hipotéticos para observar ganho, igualdade ou piora; abrir os resultados reais |
| 9. Hora da demonstração | Roteiro e contingência | Marcar a lista de apresentação e abrir o sistema real em outras abas |

## Natureza das simulações

As animações são **modelos didáticos identificados na própria página**. Nenhuma delas envia compras, chama a API, altera o estoque, interrompe contêineres ou executa benchmark. A sequência de pedido apresenta estados predeterminados; a aplicação real continua executando suas regras em C# e PostgreSQL.

O modelo de threads usa unidades de trabalho e instantes virtuais, sem temporização real ou consumo de CPU representativo. O modelo de distribuição usa expiração em duas etapas para facilitar a explicação; a lease real é renovada pelo worker e tem duração configurada no backend. Reexecutar o cálculo determinístico após uma falha é permitido; duplicar o efeito final no estoque é impedido pelo banco e pelos tokens.

Os tempos do slide de speedup são **hipotéticos**, não resultados coletados. O modelo idealizado não prevê velocidade real, custos de banco, revezamento do sistema operacional ou contenção de recursos. Três contêineres na VM continuam compartilhando o mesmo computador. Para comprovar desempenho e integridade, use os benchmarks e as demonstrações reais no painel.

A aula não depende da API ou do PostgreSQL estarem disponíveis. Continua exigindo que o site Web esteja acessível e que a sessão administrativa seja válida. Para uma indisponibilidade da própria Web/internet, mantenha o PDF ou HTML de apresentação já exportado como contingência.

## Validação e reprodução

O teste `scripts/presentation-ui-smoke.cjs` inicia somente uma Web descartável em **127.0.0.1:5582**, com API propositalmente inacessível em 5999. Usa as credenciais da `.env` local, encerra apenas o processo que iniciou e não precisa de PostgreSQL. Tenha .NET 10, Playwright disponível no Node.js e Chromium instalado:

```bash
dotnet build MiniShop.slnx -c Release
node scripts/presentation-ui-smoke.cjs
```

Se necessário, defina `DOTNET_PATH` para o executável .NET e `CHROMIUM_PATH` para o navegador. As verificações cobrem autenticação, acesso direto, botões, tela cheia ou fallback, reserva/devolução ilustrativa, 8 threads em 4 vCPU, recuperação após interrupção, 202/503, speedup, teclado, links por capítulo, ausência de chamadas à API e movimento reduzido. Todos os slides são conferidos nas larguras **1440, 1024, 768, 390 e 320 px**.

O relatório e as capturas ficam em [`results/presentation/`](../results/presentation/). As capturas ilustram os modelos da aula; não são evidência de execução de pedidos reais.

## Implantação

Esta aba está no projeto Web e usa CSS/JavaScript locais, sem CDN, instalação ou serviço adicional. Depois da publicação do código, reconstrua e reimplante o Web no Coolify. Se ainda não implantou as alterações de limpeza do histórico, atualize também a API primeiro, conforme [`painel-moderador.md`](painel-moderador.md). Não há nova variável de ambiente obrigatória para os slides.
