require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

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
    res.json({ ok: true, data: sets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/catalog/sets/:id', (req, res) => {
  try {
    const id = safeFile(req.params.id);
    const file = path.join(CARDS_DIR, `${id}.json`);
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

// ---------- INVENTORY ----------
app.get('/api/store/products', (_req, res) => {
  res.json(loadStore().products || {});
});

app.get('/api/store/product/:id', (req, res) => {
  res.json(loadStore().products?.[req.params.id] || null);
});

app.put('/api/store/product/:id', (req, res) => {
  const { price, stock, condition, enabled } = req.body || {};
  if (!Number.isFinite(Number(price)) || !Number.isInteger(Number(stock)) || Number(price) < 0 || Number(stock) < 0) {
    return res.status(400).json({ error: 'Preço ou estoque inválido.' });
  }
  const store = loadStore();
  store.products ||= {};
  store.products[req.params.id] = {
    price: Number(price),
    stock: Number(stock),
    condition: condition || 'Near Mint',
    enabled: enabled !== false
  };
  saveStore(store);
  res.json({ ok: true, product: store.products[req.params.id] });
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

function cartTotals(store, items) {
  let subtotal = 0;
  const normalized = [];

  for (const item of items || []) {
    const inventory = store.products?.[item.id];
    if (!inventory || !inventory.enabled) {
      throw new Error(`Produto indisponível: ${item.name || item.id}`);
    }
    if (Number(item.qty) < 1 || Number(item.qty) > Number(inventory.stock)) {
      throw new Error(`Estoque insuficiente: ${item.name || item.id}`);
    }

    const price = Number(inventory.price);
    const qty = Number(item.qty);
    subtotal += price * qty;
    normalized.push({
      id: item.id,
      name: item.name || item.id,
      qty,
      price
    });
  }

  const shipping = subtotal > 0 && subtotal < 250 ? 18.90 : 0;
  return {
    subtotal,
    shipping,
    total: subtotal + shipping,
    items: normalized
  };
}

app.post('/paypal-api/checkout/orders/create', async (req, res) => {
  try {
    const store = loadStore();
    const totals = cartTotals(store, req.body.items);
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
        const inv = store.products?.[item.id];
        if (inv) inv.stock = Math.max(0, Number(inv.stock) - Number(item.qty));
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

// Checkout local de demonstração para Pix/cartão/boleto.
app.post('/api/orders/demo', (req, res) => {
  try {
    const store = loadStore();
    const totals = cartTotals(store, req.body.items);
    const order = {
      id: `CV-${Date.now()}`,
      paymentMethod: req.body.paymentMethod || 'demo',
      status: 'pending',
      items: totals.items,
      total: totals.total,
      createdAt: new Date().toISOString()
    };
    store.orders ||= [];
    store.orders.push(order);
    saveStore(store);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
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
