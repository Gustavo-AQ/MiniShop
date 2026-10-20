const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const $=s=>document.querySelector(s);
let products=[],cart=JSON.parse(localStorage.getItem('minishop-cart')||'{}'), pending=JSON.parse(localStorage.getItem('minishop-pending')||'null'), pollTimer;
async function call(url,options={}) { const r=await fetch(url,{...options,signal:AbortSignal.timeout(6000)}); const data=await r.json(); if(!r.ok)throw Error(data.message||'Serviço temporariamente indisponível.'); return data; }
async function load() {
 try { products=await call('/?handler=Products'); $('#availability').textContent='Estoque consultado na API · a disponibilidade final é validada na compra.';
 $('#products').replaceChildren(); for(const p of products) {
 const card=document.createElement('article'); card.className='product';
 card.innerHTML=`<div class="product-art art-${p.id}"><img src="/product-${p.id}.svg" alt=""></div><div class="product-info"><span class="eyebrow">MINISHOP ORIGINAL</span><h3></h3><p class="stock"></p><div class="price"><strong></strong><button>Adicionar +</button></div></div>`;
 card.querySelector('h3').textContent=p.name; card.querySelector('.stock').textContent=`${p.stock} unidades disponíveis`; card.querySelector('strong').textContent=money(p.price);
 card.querySelector('button').onclick=()=>{ if(pending){alert('Conclua a consulta do pedido anterior.');return;} cart[p.id]=Math.min(100,(cart[p.id]||0)+1); render(); }; $('#products').append(card);
 } render(); } catch(e){$('#availability').textContent=e.message||'API indisponível. Tente atualizar em instantes.';}
}
function render() {
 localStorage.setItem('minishop-cart',JSON.stringify(cart)); $('#cart-items').replaceChildren(); let total=0;
 for(const [id,q] of Object.entries(cart)) {const p=products.find(p=>p.id==id); if(!p)continue;total+=p.price*q; const row=document.createElement('div');row.className='cart-row';
 const label=document.createElement('span');label.textContent=p.name;const input=document.createElement('input');input.type='number';input.min=1;input.max=100;input.value=q;input.setAttribute('aria-label','Quantidade de '+p.name);input.disabled=!!pending;
 input.onchange=()=>{cart[id]=Math.max(1,Math.min(100,parseInt(input.value)||1));render();};const del=document.createElement('button');del.className='ghost';del.textContent='Remover';del.disabled=!!pending;del.onclick=()=>{delete cart[id];render();};row.append(label,input,del);$('#cart-items').append(row);}
 $('#total').textContent=Object.keys(cart).length?`Total estimado: ${money(total)}`:'Seu carrinho está vazio.';
 $('#checkout').disabled=!!pending||!Object.keys(cart).length;
}
function savePending(){localStorage.setItem('minishop-pending',JSON.stringify(pending));render();}
async function send() {
 try {const d=await call('/?handler=Checkout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':$('input[name="__RequestVerificationToken"]').value,'Idempotency-Key':pending.key},body:JSON.stringify(pending.body)});
 pending.id=d.id;savePending();$('#order-id').textContent=d.id;$('#order-status').textContent='Pedido recebido. Aguardando processamento…';poll();
 }catch(e){ $('#order-status').textContent=(e.message||'Falha de conexão.')+' Use “Consultar novamente” para reenviar com a mesma chave.';retry(send); }
}
function retry(fn){const b=document.createElement('button');b.textContent='Consultar novamente';b.onclick=fn;$('#order-status').append(' ',b);}
async function poll() {
 if(!pending?.id)return;
 try{const o=await call('/?handler=Order&id='+pending.id);$('#order-id').textContent=o.id;
 $('#order-status').textContent=({PENDENTE:'Pedido recebido. Aguardando na fila…',PROCESSANDO:'Pedido em processamento…',APROVADO:'Compra aprovada ✓',RECUSADO:'Compra recusada: '+o.reason})[o.status];
 if(['APROVADO','RECUSADO'].includes(o.status)){if(o.status==='APROVADO')cart={};pending=null;savePending();load();}else pollTimer=setTimeout(poll,1000);
 }catch(e){$('#order-status').textContent=e.message||'Consulta indisponível. Seu pedido foi preservado.';retry(poll);}
}
$('#checkout').onclick=()=>{pending={key:crypto.randomUUID(),body:{items:Object.entries(cart).map(([id,q])=>({productId:Number(id),quantity:q}))}};savePending();send();};
load();if(pending){$('#order-status').textContent='Retomando consulta do pedido…';pending.id?poll():send();}
