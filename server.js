require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas variáveis de ambiente.');
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function signAdminToken(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyAdminToken(token) {
  if (!ADMIN_PASSWORD || !token) return false;
  const [expiresAt, sig] = String(token).split('.');
  if (!expiresAt || !sig || Number(expiresAt) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(expiresAt).digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Acesso administrativo não autorizado.' });
  next();
}

const SETS_FILE = path.join(ROOT, 'data', 'catalogo', 'sets.json');
const CARDS_DIR = path.join(ROOT, 'data', 'catalogo', 'cards');
const STORE_FILE = path.join(ROOT, 'data', 'loja', 'store.json');

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(ROOT, 'public')));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function safeFile(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return { products: {}, orders: [] };
  return readJson(STORE_FILE);
}
function saveStore(store) {
  writeJson(STORE_FILE, store);
}
function localCardImage(card) {
  const file = path.join(ROOT, 'public', 'assets', 'cards', `${safeFile(card.id)}.png`);
  if (fs.existsSync(file)) return `/assets/cards/${safeFile(card.id)}.png`;
  return card.images?.small || '';
}
function localSetImages(set) {
  const dir = path.join(ROOT, 'public', 'assets', 'sets', safeFile(set.id));
  const logo = path.join(dir, 'logo.png');
  const symbol = path.join(dir, 'symbol.png');
  return {
    logo: fs.existsSync(logo) ? `/assets/sets/${safeFile(set.id)}/logo.png` : set.images?.logo || '',
    symbol: fs.existsSync(symbol) ? `/assets/sets/${safeFile(set.id)}/symbol.png` : set.images?.symbol || ''
  };
}

// ---------- LOCAL CATALOG ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, catalog: 'local', paypal: paypalConfigured() });
});

app.get('/api/catalog/sets', (_req, res) => {
  try {
    if (!fs.existsSync(SETS_FILE)) return res.json({ ok: true, data: [] });
    const sets = readJson(SETS_FILE).map(set => ({
      ...set,
      localImages: localSetImages(set)
    }));

    // A fonte histórica do projeto pode demorar para receber lançamentos.
    // Enquanto isso, a 30th Celebration é carregada sob demanda pela TCGdex.
    if (!sets.some(s => s.id === 'me6pt5')) {
      sets.push({
        id: 'me6pt5',
        name: '30th Celebration',
        series: 'Mega Evolution',
        releaseDate: '2026/09/16',
        total: 203,
        printedTotal: 203,
        localImages: { logo: '', symbol: '' },
        remoteCatalog: 'tcgdex'
      });
    }
    res.json({ ok: true, data: sets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/catalog/sets/:id', async (req, res) => {
  try {
    const id = safeFile(req.params.id);
    const file = path.join(CARDS_DIR, `${id}.json`);

    if (!fs.existsSync(file) && id === 'me6pt5') {
      const remote = await fetch('https://api.tcgdex.net/v2/en/sets/me6pt5');
      if (!remote.ok) return res.status(502).json({ error: 'A coleção 30th Celebration está temporariamente indisponível.' });
      const set = await remote.json();
      const cards = (set.cards || []).map(card => ({
        id: card.id,
        name: card.name,
        number: card.localId || card.id,
        rarity: card.rarity || '',
        localImage: card.image || ''
      }));
      return res.json({
        ok: true,
        data: {
          id: 'me6pt5',
          name: set.name || '30th Celebration',
          series: set.serie?.name || 'Mega Evolution',
          releaseDate: set.releaseDate || '2026/09/16',
          total: set.cardCount?.total || cards.length,
          cards
        }
      });
    }

    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Coleção não sincronizada.' });

    const sets = fs.existsSync(SETS_FILE) ? readJson(SETS_FILE) : [];
    const set = sets.find(s => safeFile(s.id) === id) || { id: req.params.id, name: req.params.id };
    const cards = readJson(file).map(card => ({
      ...card,
      localImage: localCardImage(card)
    }));

    res.json({
      ok: true,
      data: { ...set, localImages: localSetImages(set), cards }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/catalog/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ ok: true, data: [] });

    const sets = fs.existsSync(SETS_FILE) ? readJson(SETS_FILE) : [];
    const results = [];
    for (const set of sets) {
      const file = path.join(CARDS_DIR, `${safeFile(set.id)}.json`);
      if (!fs.existsSync(file)) continue;
      const cards = readJson(file);
      for (const card of cards) {
        if (
          String(card.name || '').toLowerCase().includes(q) ||
          String(card.number || '').toLowerCase().includes(q) ||
          String(card.id || '').toLowerCase().includes(q)
        ) {
          results.push({
            ...card,
            set: { id: set.id, name: set.name },
            localImage: localCardImage(card)
          });
          if (results.length >= 200) break;
        }
      }
      if (results.length >= 200) break;
    }
    res.json({ ok: true, data: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- ADMIN ----------
app.get('/api/admin/status', (_req, res) => {
  res.json({ enabled: Boolean(ADMIN_PASSWORD) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD não foi configurada no Render.' });
  const supplied = String(req.body?.password || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Senha administrativa incorreta.' });
  const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
  res.json({ token: signAdminToken(expiresAt), expiresAt });
});

// ---------- SEALED PRODUCTS ----------
app.get('/api/sealed-products', async (_req, res) => {
  try {
    const file = path.join(ROOT, 'data', 'loja', 'sealed-products.json');
    const products = fs.existsSync(file) ? readJson(file) : [];
    const ids = products.map(p => `sealed:${p.id}`);
    let rows = [];
    if (ids.length) {
      const { data, error } = await supabase.from('inventory').select('*').in('card_id', ids);
      if (error) throw error;
      rows = data || [];
    }
    const inv = Object.fromEntries(rows.map(r => [String(r.card_id).replace(/^sealed:/,''), r]));
    res.json({ ok: true, data: products.map(p => ({
      ...p,
      price: Number(inv[p.id]?.price || 0),
      stock: Number(inv[p.id]?.stock || 0),
      enabled: Boolean(inv[p.id]?.enabled)
    })) });
  } catch (e) { res.status(500).json({ error: 'Erro ao carregar produtos selados.' }); }
});

app.put('/api/sealed-products/:id', requireAdmin, async (req, res) => {
  try {
    const { price, stock, enabled } = req.body || {};
    if (!Number.isFinite(Number(price)) || !Number.isInteger(Number(stock)) || Number(price) < 0 || Number(stock) < 0) {
      return res.status(400).json({ error: 'Preço ou estoque inválido.' });
    }
    const product = {
      card_id: `sealed:${String(req.params.id)}`,
      price: Number(price), stock: Number(stock), condition: 'Selado',
      enabled: enabled !== false, updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('inventory').upsert(product, { onConflict: 'card_id' }).select().single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao salvar produto selado.' }); }
});

// ---------- INVENTORY ----------
app.get('/api/store/products', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*');

    if (error) {
      console.error('Erro Supabase:', error);
      return res.status(500).json({
        error: 'Erro ao carregar inventário.'
      });
    }

    const products = {};

    for (const product of data || []) {
      products[product.card_id] = {
        price: Number(product.price),
        stock: Number(product.stock),
        condition: product.condition || 'Near Mint',
        enabled: product.enabled
      };
    }

    res.json(products);

  } catch (error) {
    console.error('Erro ao carregar inventário:', error);

    res.status(500).json({
      error: 'Erro interno ao carregar inventário.'
    });
  }
});

app.get('/api/store/product/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('card_id', String(req.params.id))
      .maybeSingle();

    if (error) {
      console.error('Erro Supabase:', error);
      return res.status(500).json({
        error: 'Erro ao carregar produto.'
      });
    }

    if (!data) {
      return res.json(null);
    }

    res.json({
      price: Number(data.price),
      stock: Number(data.stock),
      condition: data.condition || 'Near Mint',
      enabled: data.enabled
    });

  } catch (error) {
    console.error('Erro ao carregar produto:', error);

    res.status(500).json({
      error: 'Erro interno ao carregar produto.'
    });
  }
});

app.put('/api/store/product/:id', requireAdmin, async (req, res) => {
  try {
    const { price, stock, condition, enabled } = req.body || {};

    if (
      !Number.isFinite(Number(price)) ||
      !Number.isInteger(Number(stock)) ||
      Number(price) < 0 ||
      Number(stock) < 0
    ) {
      return res.status(400).json({
        error: 'Preço ou estoque inválido.'
      });
    }

    const product = {
      card_id: String(req.params.id),
      price: Number(price),
      stock: Number(stock),
      condition: condition || 'Near Mint',
      enabled: enabled !== false,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('inventory')
      .upsert(product, { onConflict: 'card_id' })
      .select()
      .single();

    if (error) {
      console.error('Erro Supabase:', error);
      return res.status(500).json({
        error: 'Erro ao salvar produto no Supabase.'
      });
    }

    res.json({
      ok: true,
      product: data
    });

  } catch (error) {
    console.error('Erro ao atualizar produto:', error);

    res.status(500).json({
      error: 'Erro interno ao atualizar produto.'
    });
  }
});

app.get('/api/orders', (_req, res) => {
  res.json(loadStore().orders || []);
});

// ---------- PAYPAL SANDBOX ----------
function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}
function paypalBase() {
  return process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}
async function paypalAccessToken(extraForm = '') {
  if (!paypalConfigured()) throw new Error('Credenciais PayPal não configuradas no .env');
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const body = `grant_type=client_credentials${extraForm ? '&' + extraForm : ''}`;
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || `PayPal ${r.status}`);
  return data.access_token;
}

app.get('/api/paypal/config', (_req, res) => {
  res.json({
    configured: paypalConfigured(),
    environment: process.env.PAYPAL_ENV || 'sandbox'
  });
});

app.get('/paypal-api/auth/browser-safe-client-token', async (req, res) => {
  try {
    // Web SDK v6 browser-safe token.
    const domain = req.hostname === 'localhost' ? 'localhost' : req.hostname;
    const token = await paypalAccessToken(
      `response_type=client_token&domains[]=${encodeURIComponent(domain)}&intent=sdk_init`
    );
    res.json({ accessToken: token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function cartTotals(items) {
  const requested = (items || []).filter(i => i && i.id && Number(i.qty) > 0);
  if (!requested.length) throw new Error('Carrinho vazio.');

  const ids = requested.map(i => String(i.id));
  const { data, error } = await supabase
    .from('inventory')
    .select('card_id, price, stock, enabled')
    .in('card_id', ids);

  if (error) throw new Error('Não foi possível validar o estoque.');
  const byId = Object.fromEntries((data || []).map(x => [x.card_id, x]));

  let subtotal = 0;
  const normalized = [];
  for (const item of requested) {
    const inventory = byId[String(item.id)];
    if (!inventory || !inventory.enabled) throw new Error(`Produto indisponível: ${item.name || item.id}`);
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > Number(inventory.stock)) {
      throw new Error(`Estoque insuficiente: ${item.name || item.id}`);
    }
    const price = Number(inventory.price);
    subtotal += price * qty;
    normalized.push({ id: String(item.id), name: item.name || item.id, qty, price });
  }

  const shipping = subtotal > 0 && subtotal < 250 ? 18.90 : 0;
  return { subtotal, shipping, total: subtotal + shipping, items: normalized };
}

app.post('/paypal-api/checkout/orders/create', async (req, res) => {
  try {
    const store = loadStore();
    const totals = await cartTotals(req.body.items);
    const accessToken = await paypalAccessToken();

    const r = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'BRL',
            value: totals.total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: 'BRL',
                value: totals.subtotal.toFixed(2)
              },
              shipping: {
                currency_code: 'BRL',
                value: totals.shipping.toFixed(2)
              }
            }
          },
          items: totals.items.map(item => ({
            name: item.name.slice(0, 127),
            quantity: String(item.qty),
            unit_amount: {
              currency_code: 'BRL',
              value: item.price.toFixed(2)
            }
          }))
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Guarda o carrinho associado ao pedido para validar/cumprir após capture.
    store.pendingPayPal ||= {};
    store.pendingPayPal[data.id] = {
      items: totals.items,
      total: totals.total,
      createdAt: new Date().toISOString()
    };
    saveStore(store);

    res.json({ id: data.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/paypal-api/checkout/orders/:orderId/capture', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const store = loadStore();
    const pending = store.pendingPayPal?.[orderId];
    if (!pending) return res.status(400).json({ error: 'Pedido PayPal desconhecido.' });

    const accessToken = await paypalAccessToken();
    const r = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    if (data.status === 'COMPLETED') {
      for (const item of pending.items) {
        const { data: inv, error: readError } = await supabase
          .from('inventory')
          .select('stock')
          .eq('card_id', String(item.id))
          .single();
        if (readError || !inv) throw new Error(`Falha ao atualizar estoque de ${item.name || item.id}.`);
        const nextStock = Math.max(0, Number(inv.stock) - Number(item.qty));
        const { error: updateError } = await supabase
          .from('inventory')
          .update({ stock: nextStock, updated_at: new Date().toISOString() })
          .eq('card_id', String(item.id));
        if (updateError) throw new Error(`Falha ao atualizar estoque de ${item.name || item.id}.`);
      }

      store.orders ||= [];
      store.orders.push({
        id: `CV-${Date.now()}`,
        paypalOrderId: orderId,
        paymentMethod: 'paypal',
        status: 'paid',
        items: pending.items,
        total: pending.total,
        createdAt: new Date().toISOString()
      });

      delete store.pendingPayPal[orderId];
      saveStore(store);
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(` CardVault: http://localhost:${PORT}`);
  console.log(' Catálogo: banco local');
  console.log(` PayPal: ${paypalConfigured() ? 'SANDBOX configurado' : 'não configurado'}`);
  console.log('==============================================');
  console.log('');
});
