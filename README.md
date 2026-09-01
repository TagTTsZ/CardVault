# CardVault TCG — Banco completo local + PayPal Sandbox

Esta versão foi feita para:

- sincronizar **todas as coleções e cartas** do repositório público `PokemonTCG/pokemon-tcg-data`;
- manter os JSONs localmente;
- opcionalmente baixar as **imagens das cartas, logos e símbolos** para `public/assets`;
- manter **preço, estoque, condição e disponibilidade** separados do catálogo;
- testar checkout com **PayPal Sandbox** no backend;
- manter Pix, cartão e boleto como demonstração por enquanto.

## 1. Instalar

Descompacte o ZIP e abra a pasta inteira no VS Code.

No Terminal:

```powershell
npm.cmd install
```

## 2. Baixar o banco completo + imagens

Use:

```powershell
npm.cmd run sync-all
```

Esse comando:

1. baixa `sets/en.json` do repositório público do Pokémon TCG;
2. baixa o JSON de cada coleção;
3. cria um registro de estoque para cada carta;
4. baixa a imagem pequena de cada carta disponível;
5. baixa logos e símbolos das coleções.

Como há milhares de cartas, o processo pode demorar e o projeto pode ocupar bastante espaço.

Se quiser somente os dados JSON, sem baixar imagens:

```powershell
npm.cmd run sync-catalog
```

## 3. Conferir o banco

```powershell
npm.cmd run verify
```

Isso mostra quantas coleções, cartas e imagens existem localmente.

## 4. Configurar PayPal Sandbox

Copie:

```text
.env.example
```

e renomeie a cópia para:

```text
.env
```

Preencha:

```text
PAYPAL_CLIENT_ID=seu_client_id_sandbox
PAYPAL_CLIENT_SECRET=seu_secret_sandbox
PAYPAL_ENV=sandbox
PORT=3000
```

O `Client Secret` fica somente no backend. Não coloque o secret em `public/app.js` ou `index.html`.

## 5. Iniciar

```powershell
npm.cmd start
```

Abra:

```text
http://localhost:3000
```

## 6. Estoque

O catálogo Pokémon e o estoque da loja são separados.

Depois da sincronização, todas as cartas começam assim:

```json
{
  "price": 0,
  "stock": 0,
  "condition": "Near Mint",
  "enabled": false
}
```

Isso é intencional: um banco de cartas não sabe quantas unidades físicas você possui.

Abra uma coleção, clique em **Editar** e informe:

- preço;
- quantidade em estoque;
- condição;
- se a carta está disponível para venda.

O inventário é salvo em:

```text
data/loja/store.json
```

## 7. PayPal

O PayPal está configurado para **Sandbox**.

O backend:

- gera o token para o Web SDK v6;
- cria o pedido;
- recalcula preço/estoque no servidor;
- captura o pagamento;
- só depois de `COMPLETED` reduz o estoque.

## 8. Fonte do catálogo

Os dados são sincronizados do projeto público:

```text
PokemonTCG/pokemon-tcg-data
```

As imagens são referenciadas pelo próprio dataset e, com `sync-all`, são armazenadas localmente quando o download está disponível.

## Observação

Algumas cartas/coleções do dataset podem não ter imagem disponível. Nesses casos o CardVault mostra um fallback em vez de quebrar o catálogo.
