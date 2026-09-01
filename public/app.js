let sets=[], currentSet=null, cards=[], mode='sets', inventory={}, selectedAdmin=null;
let cart=JSON.parse(localStorage.getItem('cv-full-cart')||'{}');
let paypalReady=false;

const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

async function fetchJson(url,opts={}){
  const r=await fetch(url,opts);
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
  return data;
}
async function loadInventory(){
  inventory=await fetchJson('/api/store/products');
}
async function init(){
  try{
    await loadInventory();
    const r=await fetchJson('/api/catalog/sets');
    sets=r.data||[];
    if(!sets.length){
      $('status').textContent='O catálogo ainda não foi sincronizado. Rode npm.cmd run sync-all.';
      $('catalog').innerHTML='<div class="empty">Banco vazio. Execute <b>npm.cmd run sync-all</b> no terminal e depois atualize a página.</div>';
      return;
    }
    $('status').textContent=`Banco local: ${sets.length} coleções sincronizadas.`;
    renderSets();
  }catch(e){
    $('status').textContent='Erro ao ler o banco local.';
    $('catalog').innerHTML=`<div class="empty">${safe(e.message)}</div>`;
  }
}
function renderSets(){
  mode='sets';$('backBtn').style.display='none';$('title').textContent='Coleções';$('subtitle').textContent='';
  const q=$('search').value.trim().toLowerCase(),sort=$('sort').value;
  let list=sets.filter(s=>!q||s.name.toLowerCase().includes(q)||String(s.series||'').toLowerCase().includes(q));
  if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if(sort==='nameDesc')list.sort((a,b)=>b.name.localeCompare(a.name,'pt-BR'));
  if(sort==='dateDesc')list.sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||'')));
  $('catalog').innerHTML=`<div class="setGrid">${list.map(s=>`
    <article class="setCard">
      <div class="setLogoWrap">${s.localImages?.logo?`<img src="${safe(s.localImages.logo)}" alt="">`:'<span class="muted">Sem logo</span>'}</div>
      <div class="setBody">
        <div class="setName">${safe(s.name)}</div>
        <div class="meta">${safe(s.series||'')} • ${safe(s.releaseDate||'')}</div>
        <div class="meta">${s.total??s.printedTotal??'?'} cartas</div>
        <button class="btn primary" style="margin-top:10px" onclick="openSet('${safe(s.id)}')">Ver coleção</button>
      </div>
    </article>`).join('')||'<div class="empty">Nenhuma coleção encontrada.</div>'}</div>`;
}
async function openSet(id){
  try{
    $('status').textContent='Carregando coleção local…';
    const r=await fetchJson(`/api/catalog/sets/${encodeURIComponent(id)}`);
    currentSet=r.data;cards=currentSet.cards||[];mode='cards';
    $('backBtn').style.display='inline-block';$('title').textContent=currentSet.name;$('subtitle').textContent=`${cards.length} cartas`;
    $('status').textContent=`${currentSet.name} carregada do banco local.`;
    await renderCards();
  }catch(e){$('catalog').innerHTML=`<div class="empty">${safe(e.message)}</div>`}
}
async function renderCards(){
  const q=$('search').value.trim().toLowerCase();
  const only=$('availability').value==='available';
  let list=cards.filter(c=>{
    const inv=inventory[c.id]||{price:0,stock:0,enabled:false};
    const match=!q||String(c.name||'').toLowerCase().includes(q)||String(c.number||'').toLowerCase().includes(q);
    return match&&(!only||(inv.enabled&&inv.stock>0));
  });
  $('catalog').innerHTML=`<div class="cardGrid">${list.map(c=>{
    const inv=inventory[c.id]||{price:0,stock:0,condition:'Near Mint',enabled:false};
    const available=inv.enabled&&Number(inv.stock)>0&&Number(inv.price)>0;
    return `<article class="card">
      <div class="art">${c.localImage?`<img loading="lazy" src="${safe(c.localImage)}" alt="${safe(c.name)}">`:`<div class="artFallback">${safe(c.name)}</div>`}</div>
      <div class="cardBody">
        <div class="cardName">${safe(c.name)}</div>
        <div><span class="badge">#${safe(c.number||'—')}</span> <span class="badge">${safe(c.rarity||'—')}</span></div>
        <div class="meta">${safe(inv.condition||'Near Mint')}</div>
        <div class="price">${available?brl(inv.price):'Não cadastrado'}</div>
        <div class="stock ${available?'ok':'no'}">${available?`${inv.stock} em estoque`:'Indisponível'}</div>
        <div class="cardActions">
          <button class="btn primary" ${available?'':'disabled'} onclick='addToCart(${JSON.stringify(c.id)},${JSON.stringify(c.name)},${Number(inv.price)},${Number(inv.stock)})'>Adicionar</button>
          <button class="btn secondary" onclick='editProduct(${JSON.stringify(c.id)},${JSON.stringify(c.name)},${Number(inv.price)},${Number(inv.stock)},${JSON.stringify(inv.condition||"Near Mint")},${Boolean(inv.enabled)})'>Editar</button>
        </div>
      </div>
    </article>`;
  }).join('')||'<div class="empty">Nenhuma carta encontrada.</div>'}</div>`;
}
function addToCart(id,name,price,stock){
  const cur=cart[id]?.qty||0;
  if(cur>=stock)return alert('Quantidade máxima em estoque atingida.');
  cart[id]={id,name,price,stock,qty:cur+1};
  saveCart();renderCart();
}
function changeQty(id,d){
  if(!cart[id])return;
  cart[id].qty+=d;
  if(cart[id].qty<=0)delete cart[id];
  else cart[id].qty=Math.min(cart[id].qty,cart[id].stock);
  saveCart();renderCart();
}
function saveCart(){
  localStorage.setItem('cv-full-cart',JSON.stringify(cart));
  $('cartCount').textContent=Object.values(cart).reduce((s,i)=>s+i.qty,0);
}
function totals(){
  const items=Object.values(cart);
  const sub=items.reduce((s,i)=>s+i.price*i.qty,0);
  const ship=sub===0?0:(sub>=250?0:18.9);
  return {sub,ship,total:sub+ship};
}
function renderCart(){
  const items=Object.values(cart);
  $('cartItems').innerHTML=items.length?items.map(i=>`<div class="cartItem"><strong>${safe(i.name)}</strong><div>${brl(i.price*i.qty)}</div><div class="qty"><button onclick='changeQty(${JSON.stringify(i.id)},-1)'>−</button><strong>${i.qty}</strong><button onclick='changeQty(${JSON.stringify(i.id)},1)'>+</button></div></div>`).join(''):'<div class="empty">Carrinho vazio.</div>';
  const t=totals();$('subtotal').textContent=brl(t.sub);$('shipping').textContent=t.ship===0&&t.sub>0?'Grátis':brl(t.ship);$('total').textContent=brl(t.total);saveCart();
}
function openCart(){$('cartDrawer').classList.add('open');$('overlay').classList.add('show')}
function closeAll(){$('cartDrawer').classList.remove('open');$('checkout').classList.remove('show');$('adminModal').classList.remove('show');$('overlay').classList.remove('show')}
async function openCheckout(){
  if(!Object.keys(cart).length)return alert('Carrinho vazio.');
  $('cartDrawer').classList.remove('open');$('checkout').classList.add('show');$('overlay').classList.add('show');
  paymentChanged();
  if(!paypalReady) await setupPayPal();
}
function paymentChanged(){
  const method=document.querySelector('input[name=pay]:checked')?.value||'paypal';
  $('paypalArea').style.display=method==='paypal'?'block':'none';
  $('demoOrderBtn').style.display=method==='paypal'?'none':'inline-block';
}
async function createDemoOrder(){
  const method=document.querySelector('input[name=pay]:checked')?.value||'demo';
  try{
    const r=await fetchJson('/api/orders/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:Object.values(cart),paymentMethod:method})});
    alert(`Pedido ${r.order.id} criado em modo demonstrativo.`);
    closeAll();
  }catch(e){alert(e.message)}
}
function editProduct(id,name,price,stock,condition,enabled){
  selectedAdmin={id,name};
  $('adminCurrent').textContent=`Editando: ${name}`;
  $('adminPrice').value=price||'';
  $('adminStock').value=stock||0;
  $('adminCondition').value=condition||'Near Mint';
  $('adminEnabled').checked=Boolean(enabled);
  $('adminModal').classList.add('show');$('overlay').classList.add('show');
}
async function saveAdmin(){
  if(!selectedAdmin)return alert('Selecione uma carta.');
  try{
    await fetchJson(`/api/store/product/${encodeURIComponent(selectedAdmin.id)}`,{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        price:Number($('adminPrice').value||0),
        stock:Number($('adminStock').value||0),
        condition:$('adminCondition').value,
        enabled:$('adminEnabled').checked
      })
    });
    await loadInventory();closeAll();if(mode==='cards')renderCards();
  }catch(e){alert(e.message)}
}
async function setupPayPal(){
  try{
    const config=await fetchJson('/api/paypal/config');
    if(!config.configured){
      $('paypalStatus').textContent='PayPal Sandbox ainda não configurado. Preencha o arquivo .env.';
      return;
    }

    let tries=0;
    while(!window.paypal && tries<50){await new Promise(r=>setTimeout(r,100));tries++}
    if(!window.paypal)throw new Error('SDK do PayPal não carregou.');

    const tokenData=await fetchJson('/paypal-api/auth/browser-safe-client-token');
    const sdk=await window.paypal.createInstance({
      clientToken:tokenData.accessToken,
      components:['paypal-payments'],
      pageType:'checkout',
      locale:'pt-BR'
    });

    const methods=await sdk.findEligibleMethods({currencyCode:'BRL'});
    if(!methods.isEligible('paypal')){
      $('paypalStatus').textContent='PayPal não está elegível neste ambiente/conta Sandbox.';
      return;
    }

    const session=sdk.createPayPalOneTimePaymentSession({
      onApprove:async ({orderId})=>{
        try{
          $('paypalStatus').textContent='Capturando pagamento Sandbox…';
          const result=await fetchJson(`/paypal-api/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST'});
          if(result.status==='COMPLETED'){
            alert('Pagamento Sandbox concluído.');
            cart={};saveCart();renderCart();await loadInventory();closeAll();if(mode==='cards')renderCards();
          }else{
            $('paypalStatus').textContent=`PayPal retornou: ${result.status||'status desconhecido'}`;
          }
        }catch(e){$('paypalStatus').textContent='Erro ao capturar: '+e.message}
      },
      onCancel:()=>{$('paypalStatus').textContent='Pagamento cancelado.'},
      onError:(e)=>{$('paypalStatus').textContent='Erro PayPal: '+(e?.message||e)}
    });

    const btn=$('paypalButton');
    btn.hidden=false;
    btn.addEventListener('click',async ()=>{
      try{
        $('paypalStatus').textContent='Abrindo PayPal Sandbox…';
        const orderPromise=fetch('/paypal-api/checkout/orders/create',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({items:Object.values(cart)})
        }).then(async r=>{
          const d=await r.json();
          if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
          return {orderId:d.id};
        });
        await session.start({presentationMode:'auto'},orderPromise);
      }catch(e){$('paypalStatus').textContent='Erro ao iniciar PayPal: '+e.message}
    },{once:false});

    $('paypalStatus').textContent='PayPal Sandbox pronto.';
    paypalReady=true;
  }catch(e){
    $('paypalStatus').textContent='PayPal Sandbox: '+e.message;
  }
}

$('search').addEventListener('input',()=>mode==='sets'?renderSets():renderCards());
$('sort').addEventListener('change',()=>mode==='sets'?renderSets():renderCards());
$('availability').addEventListener('change',()=>mode==='cards'&&renderCards());
$('backBtn').onclick=renderSets;$('cartBtn').onclick=openCart;$('closeCart').onclick=closeAll;$('overlay').onclick=closeAll;
$('checkoutBtn').onclick=openCheckout;$('cancelCheckout').onclick=closeAll;$('demoOrderBtn').onclick=createDemoOrder;
document.querySelectorAll('input[name=pay]').forEach(x=>x.addEventListener('change',paymentChanged));
$('adminBtn').onclick=()=>{$('adminModal').classList.add('show');$('overlay').classList.add('show')};$('closeAdmin').onclick=closeAll;$('saveAdmin').onclick=saveAdmin;

renderCart();init();
