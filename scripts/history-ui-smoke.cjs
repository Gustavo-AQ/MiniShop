// Teste destrutivo EXCLUSIVAMENTE na instância descartável: Web 5580 / API 5581,
// banco minishop_history_ui do contêiner minishop-concurrency-test. Nunca usa a VM real.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'results/history');
  fs.mkdirSync(dir, {recursive: true});
  const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n').filter(s => s && !s.startsWith('#') && s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}}), page = await context.newPage();
  const errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
  const request = (url, data, method = 'GET', headers = {}) => context.request.fetch('http://127.0.0.1:5581' + url, {method, data, headers: {'X-Service-Key': env.SERVICE_KEY, 'X-Admin-Key': env.ADMIN_KEY, ...headers}});
  const api = async (url, data, method = 'GET', headers) => { const r = await request(url, data, method, headers); assert(r.ok(), await r.text()); return r.json(); };
  const cfg = delayMs => ({mode: 'sequential', threads: 1, workers: 1, iterations: 1000, delayMs, queueLimit: 10000});
  try {
    assert.equal((await context.request.post('http://127.0.0.1:5581/api/admin/history/clear', {data: {confirmation: 'APAGAR HISTORICO'}})).status(), 401);
    assert.equal((await request('/api/admin/history/clear', {confirmation: 'APAGAR HISTORICO'}, 'POST', {'X-Admin-Key': ''})).status(), 401);
    assert.equal((await request('/api/admin/history/clear', {confirmation: 'apagar'}, 'POST')).status(), 400);
    // Começa limpo mesmo após reiniciar os processos de teste ou repetir o script.
    await api('/api/admin/history/clear', {confirmation: 'APAGAR HISTORICO'}, 'POST');
    await page.goto('http://127.0.0.1:5580/Admin'); await page.waitForURL('**/Login**');
    await page.locator('input[name=Password]').fill(env.ADMIN_PASSWORD); await page.locator('button').click(); await page.waitForSelector('#message');
    await page.waitForFunction(() => document.querySelector('#message').textContent.includes('API conectada'));
    assert.equal((await context.request.post('http://127.0.0.1:5580/Admin?handler=ClearHistory', {data: {confirmation: 'APAGAR HISTORICO'}})).status(), 400);
    checks.push('API exige chave de serviço e administrativa; confirmação inválida e requisição Web sem antiforgery são bloqueadas');
    await page.waitForFunction(() => document.querySelectorAll('#worker-cards .worker-card').length === 3);
    // Registros sintéticos datados validam apenas os filtros; os três workers online são reais.
    execFileSync('docker', ['exec', 'minishop-concurrency-test', 'psql', '-U', 'minishop', '-d', 'minishop_history_ui', '-v', 'ON_ERROR_STOP=1', '-c', `INSERT INTO workers(id,host,pid,seen_at,active,max_active,cpu_seconds,memory_bytes,processors,execution_state)
      VALUES('filter-1','Offline há 1 dia',1,clock_timestamp()-interval '1 day',0,0,0,0,1,'stopped'),
      ('filter-10','Offline há 10 dias',2,clock_timestamp()-interval '10 days',0,0,0,0,1,'stopped'),
      ('filter-40','Offline há 40 dias',3,clock_timestamp()-interval '40 days',0,0,0,0,1,'stopped')
      ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at`], {stdio: 'pipe'});
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('#worker-filter').inputValue(), 'online');
    assert.equal(await page.locator('#worker-cards .worker-card').count(), 3);
    assert.equal(await page.locator('#worker-table tbody tr').count(), 3);
    await page.locator('#worker-filter').selectOption('7');
    assert.equal(await page.locator('#worker-cards .worker-card').count(), 1);
    assert((await page.locator('#worker-cards').innerText()).includes('Offline há 1 dia'));
    assert.equal(await page.locator('#worker-table tbody tr').count(), 1);
    await page.locator('#worker-filter').selectOption('30');
    assert.equal(await page.locator('#worker-cards .worker-card').count(), 2);
    assert.equal(await page.locator('#worker-table tbody tr').count(), 2);
    assert(!(await page.locator('#worker-cards').innerText()).includes('Offline há 40 dias'));
    assert.equal(await page.locator('#online-workers').innerText(), '3');
    await page.waitForTimeout(2300); assert.equal(await page.locator('#worker-filter').inputValue(), '30');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#workers-section').getBoundingClientRect().top + window.scrollY - 20));
    await page.screenshot({path: path.join(dir, 'filtro-workers.png')});
    checks.push('Online por padrão; filtros de 7 e 30 dias aplicados aos cartões e tabela, preservados após atualização; resumo online independente');
    await api('/api/admin/settings', cfg(2500), 'PUT');
    const key = crypto.randomUUID(), order = await api('/api/orders', {items: [{productId: 1, quantity: 1}]}, 'POST', {'Idempotency-Key': key});
    await page.locator('#maintenance summary').click();
    assert(await page.locator('#clear-history-form button').isDisabled());
    await page.locator('#history-confirmation').fill('apagar'); assert(await page.locator('#clear-history-form button').isDisabled());
    await page.locator('#history-confirmation').fill('APAGAR HISTORICO');
    await page.locator('#clear-history-form button').click();
    await page.waitForFunction(() => document.querySelector('#history-result').textContent.includes('Aguarde a fila'));
    assert.equal((await request('/api/orders/' + order.id)).status(), 200);
    checks.push('Confirmação literal obrigatória; limpeza pela interface recebe 409 enquanto há pedido ativo sem apagá-lo');
    for (let i = 0; i < 80; i++) { const o = await api('/api/orders/' + order.id); if (['APROVADO', 'RECUSADO'].includes(o.status)) break; await page.waitForTimeout(100); }
    const run = await api('/api/admin/tests/start', {count: 100, settings: cfg(0), seed: 42}, 'POST');
    for (let i = 0; i < 100; i++) { const m = await api('/api/admin/metrics'); if (m.runs.find(r => r.id === run.id)?.finished_at) break; await page.waitForTimeout(100); }
    const before = await api('/api/admin/metrics'); assert(before.runs.some(r => r.id === run.id && r.finished_at));
    await page.locator('#clear-history-form button').click();
    await page.waitForFunction(() => document.querySelector('#history-result').textContent.includes('Histórico apagado:'));
    await page.waitForFunction(() => document.querySelector('#total-orders').textContent === '0' && document.querySelector('#chart').textContent.includes('Seu primeiro resultado'));
    const after = await api('/api/admin/metrics');
    for (const field of ['counts', 'runs', 'orders', 'events']) assert.deepEqual(after[field], []);
    assert.deepEqual(after.products, before.products); assert.deepEqual(after.settings, before.settings);
    assert.equal(after.workers.length, 3); assert(after.workers.every(w => w.alive));
    assert.equal(await page.locator('#progress-title').innerText(), 'Nenhum benchmark iniciado');
    assert(await page.locator('#clear-history-form button').isDisabled());
    assert.equal(await page.locator('#history-confirmation').inputValue(), '');
    assert.equal((await request('/api/orders/' + order.id)).status(), 404);
    assert.equal((await request('/api/orders', {items: [{productId: 1, quantity: 1}]}, 'POST', {'Idempotency-Key': key})).status(), 409);
    checks.push('Exclusão real zera pedidos, eventos, benchmarks e gráficos; preserva estoque, configuração e online; pedido antigo retorna 404, reenvio 409 e nova compra 202');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#maintenance').getBoundingClientRect().top + window.scrollY - 20));
    await page.screenshot({path: path.join(dir, 'limpeza-historico.png')});
    for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({width, height: 900}); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Overflow em ' + width); }
    assert.equal((await request('/api/orders', {items: [{productId: 1, quantity: 1}]}, 'POST', {'Idempotency-Key': crypto.randomUUID()})).status(), 202);
    assert.deepEqual(errors, []); checks.push('Controles de filtro e limpeza sem overflow de 320 a 1440 px e sem erros JavaScript');
    fs.writeFileSync(path.join(dir, 'validacao.json'), JSON.stringify({date_utc: new Date().toISOString(), environment: 'Banco local descartável minishop_history_ui', offline_records: 'Fixtures sintéticas de 1, 10 e 40 dias; processos online reais', checks}, null, 2));
    console.log('Histórico e filtros: ' + checks.length + ' verificações aprovadas.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
