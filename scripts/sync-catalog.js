const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'catalogo');
const CARDS_DIR = path.join(DATA_DIR, 'cards');
const STORE_FILE = path.join(ROOT, 'data', 'loja', 'store.json');
const CARD_ASSETS = path.join(ROOT, 'public', 'assets', 'cards');
const SET_ASSETS = path.join(ROOT, 'public', 'assets', 'sets');

const SETS_URL =
  'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';
const CARDS_BASE =
  'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en';

const downloadImages = process.argv.includes('--images');

for (const dir of [DATA_DIR, CARDS_DIR, CARD_ASSETS, SET_ASSETS]) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'CardVault/3.0' }
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

async function download(url, dest) {
  if (!url || fs.existsSync(dest)) return false;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'CardVault/3.0' }
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  const arr = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, arr);
  return true;
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return { products: {}, orders: [] };
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function safeFile(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function runPool(items, limit, fn) {
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

(async () => {
  console.log('Baixando lista completa de coleções...');
  const sets = await fetchJson(SETS_URL);
  fs.writeFileSync(
    path.join(DATA_DIR, 'sets.json'),
    JSON.stringify(sets, null, 2),
    'utf8'
  );

  console.log(`${sets.length} coleções encontradas.`);

  const store = loadStore();
  store.products ||= {};
  store.orders ||= [];

  let totalCards = 0;
  let failures = [];

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    try {
      const cards = await fetchJson(`${CARDS_BASE}/${encodeURIComponent(set.id)}.json`);
      totalCards += cards.length;

      fs.writeFileSync(
        path.join(CARDS_DIR, `${safeFile(set.id)}.json`),
        JSON.stringify(cards, null, 2),
        'utf8'
      );

      // Cria um registro de inventário para cada carta sem inventar estoque/preço.
      for (const card of cards) {
        if (!store.products[card.id]) {
          store.products[card.id] = {
            price: 0,
            stock: 0,
            condition: 'Near Mint',
            enabled: false
          };
        }
      }

      console.log(`[${i + 1}/${sets.length}] ${set.name}: ${cards.length} cartas`);

      if (downloadImages) {
        const setDir = path.join(SET_ASSETS, safeFile(set.id));
        fs.mkdirSync(setDir, { recursive: true });

        try {
          if (set.images?.logo) await download(set.images.logo, path.join(setDir, 'logo.png'));
          if (set.images?.symbol) await download(set.images.symbol, path.join(setDir, 'symbol.png'));
        } catch (e) {
          console.warn(`  Aviso: imagens da coleção ${set.id}: ${e.message}`);
        }

        await runPool(cards, 8, async (card) => {
          const url = card.images?.small;
          if (!url) return;
          const file = path.join(CARD_ASSETS, `${safeFile(card.id)}.png`);
          try {
            await download(url, file);
          } catch (e) {
            failures.push({ card: card.id, error: e.message });
          }
        });
      }
    } catch (e) {
      failures.push({ set: set.id, error: e.message });
      console.error(`ERRO ${set.id}: ${e.message}`);
    }
  }

  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');

  const status = {
    updatedAt: new Date().toISOString(),
    sets: sets.length,
    cards: totalCards,
    imagesDownloaded: downloadImages,
    failures
  };
  fs.writeFileSync(path.join(DATA_DIR, 'sync-status.json'), JSON.stringify(status, null, 2));

  console.log('');
  console.log('Sincronização concluída.');
  console.log(`Coleções: ${sets.length}`);
  console.log(`Cartas: ${totalCards}`);
  console.log(`Falhas: ${failures.length}`);
  if (!downloadImages) {
    console.log('Imagens não foram baixadas. Use: npm.cmd run sync-all');
  } else {
    console.log('As imagens disponíveis foram salvas em public/assets/.');
  }
})().catch(err => {
  console.error('');
  console.error('Falha fatal na sincronização:', err);
  process.exit(1);
});
