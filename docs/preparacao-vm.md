# Preparação da VM Ubuntu 24.04

Execute estes comandos **na VM nova**, não no servidor Oracle que já hospeda aplicações. São instruções para o operador; não foram executados nos seus computadores nesta entrega.

## Hyper-V

Crie a VM pelo Gerenciador Hyper-V com ISO oficial Ubuntu Server 24.04 LTS, Geração 2, disco VHDX dinâmico 100 GB no M.2, 4 vCPU, 10 GB de RAM fixa e switch com acesso à internet. Para ajustar uma VM já criada com o nome abaixo, PowerShell administrativo no Windows:

```powershell
Set-VMProcessor -VMName 'MiniShop-Ubuntu' -Count 4
Set-VMMemory -VMName 'MiniShop-Ubuntu' -DynamicMemoryEnabled $false -StartupBytes 10GB
Set-VMFirmware -VMName 'MiniShop-Ubuntu' -SecureBootTemplate MicrosoftUEFICertificateAuthority
Set-VM -Name 'MiniShop-Ubuntu' -AutomaticStartAction Start -AutomaticStartDelay 30 -AutomaticStopAction ShutDown
```

O nome deve corresponder à VM real. Durante a instalação Ubuntu, habilite OpenSSH e crie o usuário do operador. Confirme acesso à internet e DNS. Não instale ambiente gráfico ou uma segunda instância do Coolify.

## Docker Engine e Compose

Repositório oficial Docker para Ubuntu Noble:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssh-server
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<DOCKER_REPO
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER_REPO
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker ssh
sudo usermod -aG docker "$USER"
```

Saia e entre novamente no SSH para aplicar o grupo. Valide `docker version`, `docker compose version` e `docker run --rm hello-world`. Membros do grupo docker têm privilégios administrativos sobre o host. O usuário/chave cadastrados no Coolify devem conseguir executar Docker; conclua a validação do servidor no Coolify antes de implantar.

Referência oficial: https://docs.docker.com/engine/install/ubuntu/

## Tailscale

Na VM Noble:

```bash
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list > /dev/null
sudo apt-get update
sudo apt-get install -y tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=minishop-home
tailscale ip -4
```

Autentique pela URL fornecida no navegador e registre o IP privado. Na Oracle siga o procedimento oficial correspondente à versão de Ubuntu dela: não aplique automaticamente um repositório Noble a outra versão. Se Tailscale já existir, use essa instalação. Na tailnet, confira ACL/grants, tags e expiração de credenciais de dispositivos que precisam ficar ligados durante a aula. Não coloque auth keys em scripts versionados.

Referência oficial: https://tailscale.com/kb/1031/install-linux

Volte ao [manual de implantação](implantacao.md) para cadastrar a chave pública SSH, o servidor remoto Coolify, as variáveis privadas e os recursos separados.
