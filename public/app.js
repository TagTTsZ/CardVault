let sets=[], currentSet=null, cards=[], mode='sets', inventory={}, selectedAdmin=null, sealedProducts=[];
let cart=JSON.parse(localStorage.getItem('cv-full-cart')||'{}');
let paypalReady=false;
let adminToken=sessionStorage.getItem('cv-admin-token')||'';
let adminMode=Boolean(adminToken);

const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

async function fetchJson(url,opts={}){
  const r=await fetch(url,opts);
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
  return data;
}
function adminHeaders(extra={}){
  return {...extra,...(adminToken?{Authorization:`Bearer ${adminToken}`}:{})};
}
function updateAdminUI(){
  adminMode=Boolean(adminToken);
  $('adminLogoutBtn').hidden=!adminMode;
  if(mode==='cards')renderCards();
}
function setActiveNav(id){
  ['navHome','navCards','navSealed'].forEach(x=>$(x).classList.toggle('active',x===id));
}
function showView(view){
  $('homeView').hidden=view!=='home';
  $('catalogView').hidden=view!=='catalog';
  $('sealedView').hidden=view!=='sealed';
  if(view==='home')setActiveNav('navHome');
  if(view==='catalog')setActiveNav('navCards');
  if(view==='sealed')setActiveNav('navSealed');
  window.scrollTo({top:0,behavior:'smooth'});
}
async function loadInventory(){ inventory=await fetchJson('/api/store/products'); }

async function init(){
  try{
    await loadInventory();
    const [catalog,sealed]=await Promise.all([fetchJson('/api/catalog/sets'),fetchJson('/api/sealed-products')]);
    sets=catalog.data||[]; sealedProducts=sealed.data||[];
    renderFeaturedSets(); renderSealed(); renderSets(); updateAdminUI();
  }catch(e){
    $('featuredSets').innerHTML=`<div class="empty">${safe(e.message)}</div>`;
  }
}
function setCardHtml(s){
  return `<article class="setCard">
    <div class="setLogoWrap">${s.localImages?.logo?`<img src="${safe(s.localImages.logo)}" alt="">`:`<span class="setInitial">${safe((s.name||'?').slice(0,2))}</span>`}</div>
    <div class="setBody"><div class="setName">${safe(s.name)}</div><div class="meta">${safe(s.series||'')} • ${safe(s.releaseDate||'')}</div>
    <div class="meta">${s.total??s.printedTotal??'?'} cartas</div>
    <button class="btn primary" style="margin-top:10px" onclick="openSet('${safe(s.id)}')">Ver coleção</button></div>
  </article>`;
}
function renderFeaturedSets(){
  const recent=[...sets].sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||''))).slice(0,4);
  $('featuredSets').innerHTML=recent.map(setCardHtml).join('')||'<div class="empty">Nenhuma coleção disponível.</div>';
}
function renderSets(){
  mode='sets'; $('backBtn').style.display='none'; $('title').textContent='Coleções'; $('subtitle').textContent='';
  const q=$('search').value.trim().toLowerCase(),sort=$('sort').value;
  let list=sets.filter(s=>!q||String(s.name||'').toLowerCase().includes(q)||String(s.series||'').toLowerCase().includes(q));
  if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if(sort==='nameDesc')list.sort((a,b)=>b.name.localeCompare(a.name,'pt-BR'));
  if(sort==='dateDesc')list.sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||'')));
  $('status').textContent=`${sets.length} coleções disponíveis.`;
  $('catalog').innerHTML=`<div class="setGrid">${list.map(setCardHtml).join('')||'<div class="empty">Nenhuma coleção encontrada.</div>'}</div>`;
}
async function openSet(id){
  showView('catalog');
  try{
    $('status').textContent='Carregando coleção…';
    const r=await fetchJson(`/api/catalog/sets/${encodeURIComponent(id)}`);
    currentSet=r.data; cards=currentSet.cards||[]; mode='cards';
    $('backBtn').style.display='inline-block'; $('title').textContent=currentSet.name; $('subtitle').textContent=`${cards.length} cartas`;
    $('status').textContent=`${currentSet.name} carregada.`;
    renderCards();
  }catch(e){$('catalog').innerHTML=`<div class="empty">${safe(e.message)}</div>`}
}
function renderCards(){
  const q=$('search').value.trim().toLowerCase(), only=$('availability').value==='available';
  const list=cards.filter(c=>{
    const inv=inventory[c.id]||{price:0,stock:0,enabled:false};
    const match=!q||String(c.name||'').toLowerCase().includes(q)||String(c.number||'').toLowerCase().includes(q);
    return match&&(!only||(inv.enabled&&inv.stock>0));
  });
  $('catalog').innerHTML=`<div class="cardGrid">${list.map(c=>{
    const inv=inventory[c.id]||{price:0,stock:0,condition:'Near Mint',enabled:false};
    const available=inv.enabled&&Number(inv.stock)>0&&Number(inv.price)>0;
    return `<article class="card">
      <div class="art">${c.localImage?`<img loading="lazy" src="${safe(c.localImage)}" alt="${safe(c.name)}">`:`<div class="artFallback">${safe(c.name)}</div>`}</div>
      <div class="cardBody"><div class="cardName">${safe(c.name)}</div>
      <div><span class="badge">#${safe(c.number||'—')}</span> <span class="badge">${safe(c.rarity||'—')}</span></div>
      <div class="meta">${safe(inv.condition||'Near Mint')}</div><div class="price">${available?brl(inv.price):'Não cadastrado'}</div>
      <div class="stock ${available?'ok':'no'}">${available?`${inv.stock} em estoque`:'Indisponível'}</div>
      <div class="cardActions"><button class="btn primary" ${available?'':'disabled'} onclick='addToCart(${JSON.stringify(c.id)},${JSON.stringify(c.name)},${Number(inv.price)},${Number(inv.stock)})'>Adicionar</button>
      ${adminMode?`<button class="btn secondary" onclick='editProduct(${JSON.stringify(c.id)},${JSON.stringify(c.name)},${Number(inv.price)},${Number(inv.stock)},${JSON.stringify(inv.condition||"Near Mint")},${Boolean(inv.enabled)})'>Editar</button>`:''}
      </div></div></article>`;
  }).join('')||'<div class="empty">Nenhuma carta encontrada.</div>'}</div>`;
}
function renderSealed(){
  $('sealedCatalog').innerHTML=sealedProducts.length?sealedProducts.map(p=>`<article class="sealedCard">
    <div class="sealedImage">${p.image?`<img src="${safe(p.image)}" alt="${safe(p.name)}">`:'<span>CV</span>'}</div>
    <div class="setBody"><div class="setName">${safe(p.name)}</div><div class="meta">${safe(p.type||'Produto selado')}</div>
    <div class="price">${p.price?brl(p.price):'Em breve'}</div></div></article>`).join(''):
    '<div class="empty"><strong>Produtos selados em preparação.</strong><br>Esta aba já está pronta para receber boosters, boxes, ETBs e coleções especiais.</div>';
}
function addToCart(id,name,price,stock){
  const cur=cart[id]?.qty||0;if(cur>=stock)return alert('Quantidade máxima em estoque atingida.');
  cart[id]={id,name,price,stock,qty:cur+1};saveCart();renderCart();
}
function changeQty(id,d){if(!cart[id])return;cart[id].qty+=d;if(cart[id].qty<=0)delete cart[id];else cart[id].qty=Math.min(cart[id].qty,cart[id].stock);saveCart();renderCart()}
function saveCart(){localStorage.setItem('cv-full-cart',JSON.stringify(cart));$('cartCount').textContent=Object.values(cart).reduce((s,i)=>s+i.qty,0)}
function totals(){const items=Object.values(cart),sub=items.reduce((s,i)=>s+i.price*i.qty,0),ship=sub===0?0:(sub>=250?0:18.9);return{sub,ship,total:sub+ship}}
function renderCart(){
  const items=Object.values(cart);
  $('cartItems').innerHTML=items.length?items.map(i=>`<div class="cartItem"><strong>${safe(i.name)}</strong><div>${brl(i.price*i.qty)}</div><div class="qty"><button onclick='changeQty(${JSON.stringify(i.id)},-1)'>−</button><strong>${i.qty}</strong><button onclick='changeQty(${JSON.stringify(i.id)},1)'>+</button></div></div>`).join(''):'<div class="empty">Carrinho vazio.</div>';
  const t=totals();$('subtotal').textContent=brl(t.sub);$('shipping').textContent=t.ship===0&&t.sub>0?'Grátis':brl(t.ship);$('total').textContent=brl(t.total);saveCart();
}
function openCart(){$('cartDrawer').classList.add('open');$('overlay').classList.add('show')}
function closeAll(){['checkout','adminModal','adminLoginModal'].forEach(x=>$(x).classList.remove('show'));$('cartDrawer').classList.remove('open');$('overlay').classList.remove('show')}
async function openCheckout(){
  if(!Object.keys(cart).length)return alert('Carrinho vazio.');
  $('cartDrawer').classList.remove('open');$('checkout').classList.add('show');$('overlay').classList.add('show');
  if(!paypalReady)await setupPayPal();
}
function editProduct(id,name,price,stock,condition,enabled){
  if(!adminMode)return;
  selectedAdmin={id,name};$('adminCurrent').textContent=`Editando: ${name}`;$('adminPrice').value=price||'';$('adminStock').value=stock||0;$('adminCondition').value=condition||'Near Mint';$('adminEnabled').checked=Boolean(enabled);
  $('adminModal').classList.add('show');$('overlay').classList.add('show');
}
async function saveAdmin(){
  if(!selectedAdmin)return alert('Selecione uma carta.');
  try{
    await fetchJson(`/api/store/product/${encodeURIComponent(selectedAdmin.id)}`,{method:'PUT',headers:adminHeaders({'Content-Type':'application/json'}),body:JSON.stringify({price:Number($('adminPrice').value||0),stock:Number($('adminStock').value||0),condition:$('adminCondition').value,enabled:$('adminEnabled').checked})});
    await loadInventory();closeAll();renderCards();
  }catch(e){
    if(/autorizado/i.test(e.message)){adminToken='';sessionStorage.removeItem('cv-admin-token');updateAdminUI();}
    alert(e.message);
  }
}
function openAdminLogin(){$('adminPassword').value='';$('adminLoginStatus').textContent='';$('adminLoginModal').classList.add('show');$('overlay').classList.add('show');setTimeout(()=>$('adminPassword').focus(),100)}
async function loginAdmin(){
  try{
    $('adminLoginStatus').textContent='Entrando…';
    const r=await fetchJson('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});
    adminToken=r.token;sessionStorage.setItem('cv-admin-token',adminToken);closeAll();updateAdminUI();showView('catalog');renderSets();
  }catch(e){$('adminLoginStatus').textContent=e.message}
}
function logoutAdmin(){adminToken='';sessionStorage.removeItem('cv-admin-token');updateAdminUI();}

async function setupPayPal(){
  try{
    const config=await fetchJson('/api/paypal/config');
    if(!config.configured){$('paypalStatus').textContent='PayPal Sandbox ainda não configurado.';return}
    let tries=0;while(!window.paypal&&tries<50){await new Promise(r=>setTimeout(r,100));tries++}
    if(!window.paypal)throw new Error('SDK do PayPal não carregou.');
    const tokenData=await fetchJson('/paypal-api/auth/browser-safe-client-token');
    const sdk=await window.paypal.createInstance({clientToken:tokenData.accessToken,components:['paypal-payments'],pageType:'checkout',locale:'pt-BR'});
    const methods=await sdk.findEligibleMethods({currencyCode:'BRL'});
    if(!methods.isEligible('paypal')){$('paypalStatus').textContent='PayPal não está elegível neste ambiente Sandbox.';return}
    const session=sdk.createPayPalOneTimePaymentSession({
      onApprove:async({orderId})=>{try{$('paypalStatus').textContent='Capturando pagamento Sandbox…';const result=await fetchJson(`/paypal-api/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST'});if(result.status==='COMPLETED'){alert('Pagamento Sandbox concluído.');cart={};saveCart();renderCart();await loadInventory();closeAll();if(mode==='cards')renderCards()}else $('paypalStatus').textContent=`PayPal retornou: ${result.status||'status desconhecido'}`}catch(e){$('paypalStatus').textContent='Erro ao capturar: '+e.message}},
      onCancel:()=>{$('paypalStatus').textContent='Pagamento cancelado.'},onError:e=>{$('paypalStatus').textContent='Erro PayPal: '+(e?.message||e)}
    });
    const btn=$('paypalButton');btn.hidden=false;btn.addEventListener('click',async()=>{try{$('paypalStatus').textContent='Abrindo PayPal Sandbox…';const orderPromise=fetch('/paypal-api/checkout/orders/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:Object.values(cart)})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return{orderId:d.id}});await session.start({presentationMode:'auto'},orderPromise)}catch(e){$('paypalStatus').textContent='Erro ao iniciar PayPal: '+e.message}});
    $('paypalStatus').textContent='PayPal Sandbox pronto.';paypalReady=true;
  }catch(e){$('paypalStatus').textContent='PayPal Sandbox: '+e.message}
}

$('homeBtn').onclick=()=>showView('home');$('navHome').onclick=()=>showView('home');
$('navCards').onclick=()=>{showView('catalog');renderSets()};$('shopCardsBtn').onclick=$('navCards').onclick;
$('navSealed').onclick=()=>showView('sealed');$('shopSealedBtn').onclick=$('navSealed').onclick;
$('open30thBtn').onclick=()=>openSet('me6pt5');
$('search').addEventListener('input',()=>mode==='sets'?renderSets():renderCards());$('sort').addEventListener('change',()=>mode==='sets'?renderSets():renderCards());$('availability').addEventListener('change',()=>mode==='cards'&&renderCards());
$('backBtn').onclick=renderSets;$('cartBtn').onclick=openCart;$('closeCart').onclick=closeAll;$('overlay').onclick=closeAll;$('checkoutBtn').onclick=openCheckout;$('cancelCheckout').onclick=closeAll;
$('adminEntry').onclick=openAdminLogin;$('closeAdminLogin').onclick=closeAll;$('adminLoginBtn').onclick=loginAdmin;$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')loginAdmin()});
$('adminLogoutBtn').onclick=logoutAdmin;$('closeAdmin').onclick=closeAll;$('saveAdmin').onclick=saveAdmin;

renderCart();init();
