#!/usr/bin/env python3
"""Verificação operacional do Compose LOCAL. Não usar em implantação com dados úteis."""
import concurrent.futures, json, os, subprocess, time, urllib.request, urllib.error, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
env=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
BASE='http://127.0.0.1:5081'
REPORT={'date_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'environment':'Docker local amd64; não Oracle/Hyper-V','checks':[]}
def check(name,condition):
 if not condition: raise AssertionError(name)
 REPORT['checks'].append(name);print('OK:',name,flush=True)
def req(path,body=None,method=None,admin=False,key=None,auth=True):
 h={}
 if auth:h['X-Service-Key']=env['SERVICE_KEY']
 if admin:h['X-Admin-Key']=env['ADMIN_KEY']
 if key:h['Idempotency-Key']=key
 data=None if body is None else json.dumps(body).encode()
 if data:h['Content-Type']='application/json'
 r=urllib.request.Request(BASE+path,data=data,headers=h,method=method or ('POST' if data else 'GET'))
 try:
  with urllib.request.urlopen(r,timeout=35) as response:return response.status,json.load(response)
 except urllib.error.HTTPError as e:
  try:d=json.load(e)
  except ValueError:d={}
  return e.code,d

def compose(*args):return subprocess.check_output(['docker','compose','--env-file',str(ROOT/'.env'),'-f',str(ROOT/'deploy/compose.local.yml'),*args],cwd=ROOT,text=True).strip()
def settings(mode='parallel',threads=4,workers=1,delay=0,limit=10000):
 s={'mode':mode,'threads':threads,'workers':workers,'iterations':1000,'delayMs':delay,'queueLimit':limit};code,_=req('/api/admin/settings',s,'PUT',True);check('Configuração '+str(s),code==200)
def reset(n):check('Reposição '+str(n),req('/api/admin/stock/reset',{'stock':n},admin=True)[0]==200)
def submit():return req('/api/orders',{'items':[{'productId':1,'quantity':1}]},key=str(uuid.uuid4()))
def wait(ids,timeout=100):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  orders=[req('/api/orders/'+str(i))[1] for i in ids]
  if all(o['status'] in ['APROVADO','RECUSADO'] for o in orders):return orders
  time.sleep(.25)
 raise TimeoutError('Pedidos não finalizaram no prazo')

if __name__ == '__main__':
 for attempt in range(60):
  try:
   if req('/api/health')[0]==200:break
  except (OSError, urllib.error.URLError):pass
  time.sleep(.5)
 check('API saudável',req('/api/health')[0]==200)
 check('API protegida',req('/api/products',auth=False)[0]==401)
 check('Admin protegido',req('/api/admin/metrics')[0]==401)
 settings();reset(5)
 with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:responses=list(pool.map(lambda _:submit(),range(20)))
 check('20 pedidos aceitos',all(c==202 for c,_ in responses));ids=[d['id'] for _,d in responses]
 orders=wait(ids);approved=sum(o['status']=='APROVADO' for o in orders)
 stock=req('/api/products')[1][0]['stock']
 check('Sem venda excedente e estoque reconciliado',stock>=0 and stock+approved==5 and approved<=5)
 key=str(uuid.uuid4());body={'items':[{'productId':1,'quantity':1}]}
 a=req('/api/orders',body,key=key);b=req('/api/orders',body,key=key)
 check('Idempotência HTTP',a[0]==202 and a[1]['id']==b[1]['id']);wait([a[1]['id']])
 settings(delay=2500,threads=2,limit=3);reset(100)
 with concurrent.futures.ThreadPoolExecutor(max_workers=15) as pool:responses=list(pool.map(lambda _:submit(),range(15)))
 check('Sobrecarga controlada 503',any(c==503 for c,_ in responses));wait([d['id'] for c,d in responses if c==202])
 settings('distributed',workers=3,delay=2500);reset(100)
 responses=[submit() for _ in range(24)];ids=[d['id'] for c,d in responses if c==202];check('Lote para falha admitido',len(ids)==24)
 container=compose('ps','-q','worker-2');hostname=subprocess.check_output(['docker','inspect','--format','{{.Config.Hostname}}',container],text=True).strip()
 until=time.monotonic()+15;abandoned=None
 while time.monotonic()<until:
  for i in ids:
   o=req('/api/orders/'+i)[1]
   if o['status']=='PROCESSANDO' and o['worker'].startswith(hostname):abandoned=i;break
  if abandoned:break
  time.sleep(.1)
 check('Worker a interromper possui pedido reservado',bool(abandoned))
 compose('stop','-t','0','worker-2');print('Worker-2 interrompido abruptamente; aguardando lease e recuperação…',flush=True)
 try:
  orders=wait(ids,100);recovered=next(o for o in orders if o['id']==abandoned)
  check('Pedido abandonado recuperado',recovered['attempts']>=2)
  check('Todos finalizados após falha',len(orders)==24 and all(o['status'] in ['APROVADO','RECUSADO'] for o in orders))
  metrics=req('/api/admin/metrics',admin=True)[1]
  check('Dois processos sobreviventes continuaram',len({o['worker'] for o in orders})>=2)
  # A constraint de evento final é inspecionada no DB para toda a execução.
  sql="SELECT count(*)=count(DISTINCT order_id) FROM events WHERE kind='FINALIZADO';"
  result=compose('exec','-T','db','psql','-U',env['POSTGRES_USER'],'-d',env['POSTGRES_DB'],'-tAc',sql)
  check('Um único evento final por pedido',result=='t')
  REPORT['recovery']={'order_id':abandoned,'attempts':recovered['attempts'],'final_status':recovered['status']}
 finally:compose('start','worker-2')
 # O HTML da loja é servido sem a API; o proxy responde com timeout limitado.
 compose('stop','api')
 try:
  with urllib.request.urlopen('http://127.0.0.1:8080/',timeout=8) as r:check('Loja carrega com API parada',r.status==200)
  start=time.monotonic()
  try:urllib.request.urlopen('http://127.0.0.1:8080/?handler=Products',timeout=8);raise AssertionError('Esperava 503')
  except urllib.error.HTTPError as e:check('Frontend informa indisponibilidade sem espera infinita',e.code==503 and time.monotonic()-start<7)
 finally:compose('start','api')
 Path(ROOT/'results/validation').mkdir(parents=True,exist_ok=True)
 (ROOT/'results/validation/smoke.json').write_text(json.dumps(REPORT,indent=2,ensure_ascii=False)+'\n')
 print('Relatório: results/validation/smoke.json',flush=True)
