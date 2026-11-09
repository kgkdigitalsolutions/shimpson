# Simpson Burguer — pronto para Vercel

Projeto front-end da loja virtual Simpson Burguer, configurado com Vite para publicação na Vercel.

## Publicar na Vercel (sem terminal)

1. Extraia este ZIP.
2. Crie um repositório no GitHub e envie todos os arquivos desta pasta para ele.
3. Entre em https://vercel.com e faça login.
4. Clique em **Add New → Project** e importe o repositório do GitHub.
5. A Vercel deverá identificar **Vite** automaticamente. Confira:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
6. Clique em **Deploy**. Ao terminar, a Vercel fornecerá um endereço público `*.vercel.app`.

## Testar localmente

É necessário ter Node.js instalado.

```bash
npm install
npm run dev
```

Abra o endereço local informado pelo Vite (normalmente http://localhost:5173).

Para testar a versão de produção:

```bash
npm run build
npm run preview
```

## Acesso administrativo de demonstração

No rodapé da loja, clique em **Acesso administrativo**.

Senha inicial: `1234`.

## O que está incluído

- `index.html` — estrutura da loja e telas.
- `styles.css` — identidade visual responsiva.
- `app.js` — cardápio, carrinho, checkout demonstrativo, acompanhamento e painel administrativo com cadastro, edição e exclusão de produtos, configuração da taxa e validação do código de entrega.
- `package.json` — scripts e dependência Vite.
- `vite.config.js` — configuração de desenvolvimento e build.
- `vercel.json` — configuração de build/publicação na Vercel.

## Limitações desta versão

Esta ainda é uma demonstração front-end:
- Pix e cartão são apenas opções de interface; não processam pagamentos reais.
- Os pedidos e produtos ficam no `localStorage` do navegador e não são compartilhados entre clientes e administrador.
- A senha administrativa está no código do navegador e não oferece segurança de produção.
- A taxa de entrega é única e configurável; não existe cálculo real por CEP ou bairro.
- Para pedidos de entrega, o cliente recebe um código de 6 dígitos. O administrador só consegue concluir o status como “Pedido entregue” após o entregador digitar o código correto no pedido, depois que a cliente o informar na entrega.
- O código é exibido ao cliente na confirmação do pedido; oriente a cliente a não compartilhá-lo antes de receber o pedido.
- Fotos e fontes dependem de conexão com a internet.

## Antes de receber pedidos reais

Para operar comercialmente, a próxima versão precisa de backend e banco de dados, autenticação segura, integração de pagamento processada no servidor (por exemplo, Mercado Pago), confirmação via webhook, notificações e configuração de domínio. Nunca coloque tokens privados de pagamento no JavaScript do navegador.
