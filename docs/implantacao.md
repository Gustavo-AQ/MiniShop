# Implantação: Oracle + VM doméstica

Este manual é um procedimento a executar pelo proprietário. Nenhum servidor real foi acessado na implementação. Não reinstale Coolify, Traefik ou redes existentes. Crie um projeto/ambiente e recursos novos com nomes MiniShop. Faça backup antes de alterações de infraestrutura.

Receita de instalação da VM nova: [preparação do Ubuntu e Hyper-V](preparacao-vm.md).

## 1. Preparar a VM

No Hyper-V do Windows 11 Pro: VM Geração 2; Ubuntu Server 24.04 LTS; 4 vCPU; RAM fixa 10 GB (desligar memória dinâmica); VHDX dinâmico de 100 GB no M.2. Use switch externo com internet ou o Default Switch/NAT. O IP LAN pode mudar: usamos o IP estável do Tailscale. Ative inicialização automática da VM e valide reinicialização do Windows; impedir suspensão durante a apresentação. Secure Boot deve usar o modelo Microsoft UEFI Certificate Authority para Ubuntu.

Instale atualizações, `openssh-server`, Git, Docker Engine e plugin Compose v2 segundo a documentação oficial do Docker para Ubuntu. Habilite `ssh` e `docker` no systemd. Cadastre um usuário dedicado ao deployment; acesso ao grupo `docker` equivale a acesso administrativo. Não instale Coolify na VM.

## 2. Tailscale privado (opção principal)

Instale o Tailscale oficial na Oracle e na VM e autentique ambos na mesma tailnet. Faça login pelo fluxo oficial, sem colocar auth keys no repositório. Registre nomes e IPs `100.x.y.z`. Não habilite Funnel, exit node ou anúncio de rotas: não são necessários.

Use tags e ACL/grants para permitir somente:

- Oracle → VM: TCP 22 (gerenciamento SSH) e 5081 (API).
- Oracle → VM: TCP 5432 **somente se** ativar o worker ARM opcional.
- Computador do operador → servidores: SSH conforme necessidade.

A política padrão de uma tailnet pode permitir comunicação ampla: restrinja-a. Teste `tailscale ping NOME-DA-VM` e `ssh USUARIO@IP-TAILSCALE-VM` a partir da Oracle. O Docker da Oracle também precisa alcançar o IP da VM: teste a saúde **de dentro do contêiner web** após implantar. O Tailscale no host encaminha tráfego de contêineres normalmente, mas firewall/forwarding local pode exigir ajuste específico. Não mude regras globais às cegas.

Nenhuma porta no roteador doméstico é necessária. Tailscale estabelece conexões de saída e pode usar relays DERP se não conseguir conexão direta; isso aumenta latência. Teste a rede que será usada antes da apresentação.

## 3. SSH e servidor remoto Coolify

No Coolify existente, gere uma chave de deployment dedicada. Cadastre **a chave pública** em `~/.ssh/authorized_keys` do usuário da VM. Permissões: diretório `.ssh` 700, arquivo 600, propriedade do usuário. Nunca copie chave privada para o Git. Adicione o servidor remoto usando IP Tailscale e usuário; selecione a chave correspondente. Valide o fingerprint do host em canal confiável antes de aceitar. Use o teste de conexão do Coolify e instale/verifique pré-requisitos que ele solicitar. Confirme acesso Docker com esse usuário.

Use OpenSSH convencional sobre Tailscale, sem depender de Tailscale SSH. Não desative autenticação SSH por senha antes de testar a chave. Não abra SSH doméstico publicamente. Não altere o recurso da instalação do Coolify principal.

## 4. Repositório e recurso doméstico

Envie este diretório para um único repositório Git privado ou público **sem `.env`**. No Coolify, conecte GitHub pela integração GitHub App ou por chave read-only do repositório. Crie recurso Docker Compose no servidor remoto doméstico. Diretório base: raiz do repositório. Arquivo: `deploy/compose.home.yml`. O contexto de build é `..` relativo ao arquivo Compose, chegando à raiz; se a versão do Coolify normalizar caminhos de outra forma, confira o Compose gerado antes do deployment.

Defina nas variáveis protegidas do recurso: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SERVICE_KEY`, `ADMIN_KEY`, `HOME_TAILSCALE_IP`. Gere valores aleatórios independentes (mínimo 32 caracteres nas duas chaves). Não use os placeholders do exemplo. `POSTGRES_PASSWORD` inicial só é aplicado ao criar volume vazio; alterar `.env` não altera a senha de um banco existente. Rotacione pelo PostgreSQL e atualize clientes juntos.

O compose doméstico publica API **apenas no IP Tailscale**, não em 0.0.0.0. PostgreSQL fica só na rede Docker. Não atribua domínio público à API. Serviços worker-1/2/3 são independentes. Todos são iniciados; a configuração no painel determina quantos trabalham. Não é preciso recriar contêineres para mudar 1/2/3 consumidores.

Se operar por SSH fora do diretório gerenciado pelo Coolify, crie um `.env` local com os mesmos segredos e IPs e permissão 600. As variáveis cadastradas na interface do Coolify não são automaticamente exportadas para qualquer shell SSH. Não mantenha dois deployments concorrentes usando portas/volumes distintos sem intenção.

Comandos equivalentes via SSH na VM, a partir do clone:

```bash
docker compose --env-file .env -f deploy/compose.home.yml up -d --build
docker compose --env-file .env -f deploy/compose.home.yml ps
```

## 5. Recurso web Oracle ARM

Crie outro recurso Compose no **servidor Oracle existente**. Arquivo `deploy/compose.oracle-web.yml`. Variáveis: `API_BASE_URL=http://IP-TAILSCALE-VM:5081`, mesmas `SERVICE_KEY` e `ADMIN_KEY`, e `ADMIN_PASSWORD` exclusiva para o login do painel. O recurso usa porta interna 8080, sem publicar portas no host. Configure no Coolify o domínio `https://shop.gaqtech.dev` para esse serviço/porta. O Coolify conecta o serviço à rede Traefik e gerencia TLS; não adicione um segundo proxy.

No Cloudflare, crie DNS A `shop` para o IPv4 público da Oracle (e AAAA só se IPv6 funcionar). Pode usar proxy Cloudflare, TLS **Full (strict)** e certificado de origem válido no Traefik. Evite Flexible. Para provisionamento inicial do certificado, use o método suportado pelo Coolify e sua configuração atual (DNS challenge ou HTTP challenge). Não substitua a configuração TLS de outras aplicações. Desative cache para `/Admin*`, `/Login*` e URLs com `handler`; respostas de pedidos não devem ser cacheadas. Não crie regra “cache everything” para a loja.

Se o site exigir HTTPS atrás do Traefik, os cookies de produção já são Secure. O volume `web-keys` conserva as chaves de Data Protection. Não mude o ambiente para Development na Oracle para contornar login/HTTPS.

Verificação: loja abre; senha do painel funciona; catálogo responde; compra chega na VM; API não é acessível pela internet; PostgreSQL não é acessível publicamente; reinício dos recursos preserva pedidos e estoque. Pare só a API doméstica e confirme que o HTML da Oracle continua disponível.

## 6. Worker opcional em dois hosts físicos

Esta etapa muda a superfície privada do banco; execute apenas para a demonstração entre hosts. Primeiro, inicialize o schema com a API. Crie o papel `minishop_worker` usando `deploy/worker-role.sql` e defina sua senha interativamente com `\password minishop_worker` no psql. O worker recebe apenas SELECT, mudanças de pedidos/estoque/runs, eventos e heartbeat; não usa superusuário nem executa DDL.

Na VM:

```bash
docker compose --env-file .env -f deploy/compose.home.yml \
  -f deploy/compose.db-tailnet.yml up -d
```

Restrinja 5432 via ACL Tailscale **e** firewall de encaminhamento Docker (DOCKER-USER/nftables correspondente à instalação). UFW sozinho não garante proteção de portas publicadas pelo Docker. Confirme a publicação somente no IP Tailscale e teste rejeição de origens não autorizadas. O tráfego Tailscale é criptografado; não desative sua ACL para resolver conexão.

Na Oracle crie recurso `deploy/compose.oracle-worker.yml` com `WORKER_DB_CONNECTION` apontando para o IP Tailscale da VM, usuário restrito e senha; `SKIP_SCHEMA_INIT=true` já está no Compose. Não atribua domínio nem publique portas. Para três workers totais em **dois computadores**, deixe dois workers domésticos e um Oracle ligados, interrompendo worker-3 na VM. Selecione distribuído/3 no painel. Documente host, vCPU e carga concorrente de cada máquina.

Para as comparações básicas feitas só na VM, pare o worker Oracle. Caso contrário, a eleição do modo sequencial/paralelo poderia acontecer no host ARM e invalidar a comparação com o Ryzen. Retorne todos os cenários ao mesmo host antes de medir speedup.

## Alternativa: Cloudflare Tunnel

A opção preferida é HTTP privado pelo Tailscale, pois já é necessário ao SSH do Coolify. Um Tunnel pode publicar uma origem doméstica sem abrir portas, mas um hostname do túnel **não pode expor a API sem proteção**. Se optar por ele: crie hostname separado, Cloudflare Access com service token, configure o `cloudflared` na VM apontando para `http://api:8080` na mesma rede Docker, adicione os headers de Access no HttpClient servidor do site e mantenha `X-Service-Key`. Tokens ficam só nas variáveis protegidas. Essa alternativa requer configuração adicional que não está ativada no Compose entregue. Não use Tunnel como desculpa para abrir PostgreSQL ou remover autenticação. Para o worker ARM use Tailscale ao banco, nunca túnel HTTP.

## Imagens, operação e backups

O Dockerfile usa imagens oficiais multiarch .NET 10 e PostgreSQL 17. Não instala ferramentas x86 nem usa GPU. Em cada host o build nativo seleciona sua arquitetura. Pode publicar com Buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/Dockerfile --build-arg PROJECT=Worker \
  -t ghcr.io/SEU_USUARIO/minishop-worker:VERSAO --push .
```

Repita para Api/Web/Benchmarks quando necessário. Requer registry e builder/QEMU ou nós nativos. Fixe tags/digests de imagens após a validação para congelar o experimento. A compatibilidade ARM dos fontes/imagens base não substitui o teste na Oracle.

Faça `pg_dump` periódico e teste restauração em banco separado. Os segredos do dump também precisam de proteção. Reinício: `restart: unless-stopped`; contêiner parado manualmente permanece parado até `start`. Mudanças de código/variáveis do processo exigem novo deployment; modo/threads/limite/atraso não exigem reinício. Use os comandos de falha do roteiro para manipular apenas os serviços MiniShop, nunca o Docker daemon ou serviços existentes da Oracle.
