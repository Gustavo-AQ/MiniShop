#!/usr/bin/env python3
"""Opera somente o Compose local descartável. Testa persistência durante reinício."""
from smoke import ROOT, req, compose, check, REPORT, submit, wait, settings, reset
import json,time
settings('distributed',workers=3,delay=0);reset(100)
compose('stop','-t','0','worker-1','worker-2','worker-3')
try:
 responses=[submit() for _ in range(5)];ids=[d['id'] for c,d in responses if c==202]
 check('Cinco pedidos persistidos antes do reinício',len(ids)==5)
 compose('restart','db','api')
 for _ in range(60):
  try:
   if req('/api/health')[0]==200:break
  except OSError:pass
  time.sleep(.5)
 check('Pedidos preservados após reiniciar API e banco',all(req('/api/orders/'+i)[1]['status']=='PENDENTE' for i in ids))
finally:compose('start','worker-1','worker-2','worker-3')
orders=wait(ids)
check('Todos concluídos após reinício',len(orders)==5)
(ROOT/'results/validation/durability.json').write_text(json.dumps(REPORT,indent=2,ensure_ascii=False)+'\n')
