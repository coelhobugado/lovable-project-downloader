# Lovable Project Downloader

Exporte projetos do [Lovable](https://lovable.dev/) como arquivos ZIP diretamente pelo navegador usando Tampermonkey.

## Recursos

- Exportação completa do projeto atual em ZIP
- Download paralelo com controle de concorrência
- Tentativas automáticas em falhas temporárias
- Validação da árvore de arquivos antes da compactação
- Suporte seguro a arquivos binários
- Barra de progresso e cancelamento
- Compactação ZIP feita no próprio navegador
- Não envia o conteúdo do projeto para servidores externos

## Instalação

1. Instale o [Tampermonkey](https://www.tampermonkey.net/) no navegador.
2. Abra o arquivo [`lovable-project-downloader.user.js`](./lovable-project-downloader.user.js).
3. Clique em **Raw** no GitHub.
4. Confirme a instalação no Tampermonkey.
5. Abra um projeto em `lovable.dev`.
6. Use o botão **Baixar projeto completo** no canto inferior direito.

## Como funciona

O userscript usa a sessão autenticada já aberta no Lovable para consultar os endpoints Git utilizados pela própria aplicação. Em seguida:

1. identifica o projeto atual;
2. obtém a árvore de arquivos;
3. baixa os arquivos com concorrência limitada;
4. valida todos os resultados;
5. gera o ZIP localmente;
6. inicia o download no navegador.

## Privacidade e segurança

- O script roda apenas em `lovable.dev` e subdomínios.
- O ZIP é criado localmente no navegador.
- Nenhum arquivo do projeto é enviado a serviços de terceiros.
- Tokens de autenticação não são gravados no repositório.
- Use apenas em projetos aos quais você possui acesso autorizado.

## Limitações

- Depende dos endpoints internos atualmente utilizados pelo Lovable.
- Mudanças na API ou na autenticação do Lovable podem exigir atualização.
- O formato ZIP32 limita o arquivo final a aproximadamente 4 GiB e 65.535 arquivos.
- Projetos muito grandes podem consumir bastante memória do navegador.

## Compatibilidade

Testado para navegadores compatíveis com:

- Tampermonkey
- `fetch`
- `AbortController`
- `CompressionStream` — opcional; sem suporte, os arquivos são armazenados sem compressão

## Desenvolvimento

O projeto é mantido como um userscript único, sem processo de build.

Para contribuir:

1. faça um fork;
2. crie uma branch;
3. altere o arquivo `.user.js`;
4. teste em um projeto autorizado;
5. abra um pull request descrevendo a mudança.

Consulte também o arquivo [CONTRIBUTING.md](./CONTRIBUTING.md).

## Aviso

Este projeto é independente e não possui vínculo oficial com a Lovable. Os nomes e marcas citados pertencem aos seus respectivos proprietários.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](./LICENSE).
