# CardVault — deploy desta versão

## Variáveis no Render
Mantenha as variáveis que já existem:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENV=sandbox`

Adicione uma nova:
- `ADMIN_PASSWORD` = escolha uma senha administrativa forte e privada.

Não coloque nenhuma dessas chaves dentro dos arquivos do projeto.

## Deploy
Build Command:
`npm install`

Start Command:
`npm run start`

Depois do deploy:
1. Abra a página inicial.
2. Em **Cartas**, confira o catálogo e a coleção **30th Celebration**.
3. No rodapé, use **Administração** e a senha definida em `ADMIN_PASSWORD`.
4. Edite uma carta e confirme no Supabase.
5. Faça pagamentos apenas no PayPal Sandbox.

## Alterações incluídas
- Página inicial.
- Versão pública do comprador sem botão de edição.
- Área administrativa com login e proteção da rota PUT.
- Checkout somente PayPal Sandbox.
- Validação de preço/estoque do PayPal diretamente no Supabase.
- Baixa de estoque no Supabase após captura PayPal concluída.
- Aba de produtos selados pronta para receber produtos.
- 30th Celebration adicionada ao catálogo com carregamento remoto pela TCGdex quando ainda não existir no banco local.

## Observação
A aba de produtos selados está estruturalmente pronta, mas sem produtos inventados: `data/loja/sealed-products.json` começa vazio.
