# Lovable Project Downloader

Userscript para baixar um projeto completo do Lovable em um arquivo ZIP diretamente pelo navegador.

## Instalação rápida

### Opção 1 — instalar pelo GitHub

1. Abra o arquivo [`lovable-project-downloader.user.js`](./lovable-project-downloader.user.js).
2. Clique em **Raw**.
3. O Tampermonkey deverá abrir a tela de instalação.
4. Confirme em **Instalar**.

### Opção 2 — copiar e colar

1. Abra [`lovable-project-downloader.user.js`](./lovable-project-downloader.user.js).
2. Copie todo o conteúdo.
3. Abra o Tampermonkey.
4. Crie um novo script.
5. Apague o conteúdo padrão.
6. Cole o código.
7. Salve.

## Como usar

1. Entre em `lovable.dev`.
2. Abra um projeto ao qual você tenha acesso.
3. Clique em **Baixar projeto completo** no canto inferior direito.
4. Aguarde o ZIP ser gerado e baixado.

## Recursos

- Exporta todos os arquivos do projeto em ZIP
- Barra de progresso
- Cancelamento da exportação
- Tentativas automáticas em falhas de rede
- Suporte a arquivos binários
- Compactação local no navegador
- Não envia o projeto para servidores externos

## Segurança e privacidade

O script usa apenas a sessão já aberta no Lovable para acessar projetos autorizados. Nenhum token, senha ou cookie pessoal está gravado no código.

Use somente em projetos aos quais você possui acesso legítimo.

## Aviso

Projeto independente, sem vínculo oficial com a Lovable.

## Licença

MIT
