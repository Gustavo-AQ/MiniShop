// Execute somente no ambiente LOCAL de demonstração: cria benchmarks e repõe estoque.
// Requer Playwright e Chromium; não instala dependências no produto.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'results/interface');
  fs.mkdirSync(dir, {recursive: true});
  const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n').filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}}), page = await context.newPage();
  const errors = [], checks = []; page.on('pageerror', error => errors.push(error.message));
  const api = async (url, data, method = 'GET') => {
    const response = await context.request.fetch('http://127.0.0.1:5081' + url, {method, headers: {'X-Service-Key': env.SERVICE_KEY, 'X-Admin-Key': env.ADMIN_KEY}, data});
    if (!response.ok()) throw Error(await response.text());
    return response.json();
  };
  const original = (await api('/api/admin/metrics')).settings;
  const finish = async id => {
    for (let i = 0; i < 180; i++) {
      const metrics = await api('/api/admin/metrics'), run = metrics.runs.find(run => run.id === id);
      if (run?.finished_at) return run;
      await page.waitForTimeout(500);
    }
    throw Error('O benchmark não terminou no tempo esperado');
  };
  try {
    await page.goto('http://127.0.0.1:8080/Admin'); await page.waitForURL('**/Login**');
    await page.locator('input[name=Password]').fill(env.ADMIN_PASSWORD); await page.locator('button').click(); await page.waitForURL('**/Admin');
    await page.waitForFunction(() => document.querySelector('#message').textContent.includes('API conectada'));
    assert.equal(await page.locator('.metric-card').count(), 4);
    assert.equal(await page.locator('.lab-nav a').count(), 7);
    assert.equal(await page.locator('.experiment-grid form').count(), 3);
    checks.push('Painel autenticado com quatro indicadores, sete seções e três controles de experimento');
    // Real CPU runs on the local PostgreSQL/worker stack, not fabricated chart values.
    const runs = [];
    for (const [mode, threads, workers, iterations] of [['sequential', 1, 1, 10000], ['parallel', 2, 1, 10000], ['distributed', 1, 3, 10000], ['sequential', 1, 1, 12000]]) {
      const started = await api('/api/admin/tests/start', {count: 100, settings: {mode, threads, workers, iterations, delayMs: 0, queueLimit: 10000}, seed: 42}, 'POST');
      runs.push(await finish(started.id));
    }
    await page.waitForFunction(id => document.querySelector('#progress-description').textContent.includes(id.slice(0, 8)) && document.querySelector('#run-progress').getAttribute('aria-valuenow') === '100', runs.at(-1).id);
    assert.equal(await page.locator('#run-progress').getAttribute('aria-valuenow'), '100');
    checks.push('Quatro benchmarks reais concluídos: sequencial, paralelo, distribuído e outra carga; progresso confirma 100%');
    const cohort = JSON.stringify([100, 10000, 42, 0]);
    await page.locator('#chart-filter').selectOption(cohort);
    assert.equal(await page.locator('#chart .chart-row').count(), 3);
    const metrics = await api('/api/admin/metrics');
    const matching = metrics.runs.filter(run => run.finished_at && run.count === 100 && (typeof run.settings === 'string' ? JSON.parse(run.settings) : run.settings).Iterations === 10000 && run.seed === 42);
    const seq = matching.filter(run => (typeof run.settings === 'string' ? JSON.parse(run.settings) : run.settings).Mode === 'sequential');
    const mean = seq.reduce((sum, run) => sum + Number((typeof run.result === 'string' ? JSON.parse(run.result) : run.result).elapsed_ms), 0) / seq.length;
    assert((await page.locator('#chart .chart-row').first().innerText()).includes((mean / 1000).toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})));
    await page.waitForTimeout(2400); assert.equal(await page.locator('#chart-filter').inputValue(), cohort);
    checks.push('Gráfico mostra três cenários de condições iguais, calcula a média registrada e preserva o filtro na atualização');
    const snapshot = await api('/api/admin/metrics');
    const total = snapshot.counts.reduce((sum, item) => sum + Number(item.count), 0);
    assert.equal((await page.locator('#total-orders').innerText()).replace(/\D/g, ''), String(total));
    assert((await page.locator('#order-donut').getAttribute('aria-label')).includes(total.toLocaleString('pt-BR')));
    checks.push('Gráfico de distribuição e total correspondem aos dados reais da API, com alternativa textual');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise;
    const tempFile = path.join(dir, 'download-check.json'); await download.saveAs(tempFile);
    assert(JSON.parse(fs.readFileSync(tempFile, 'utf8')).some(run => run.id === runs[0].id)); fs.unlinkSync(tempFile);
    await page.locator('#run-limit').selectOption('25');
    assert.equal(await page.locator('#run-table tbody tr').count(), Math.min(25, metrics.runs.length));
    await page.locator('#run-limit').selectOption('10');
    checks.push('Histórico limita as linhas conforme a seleção; exportação JSON contém o histórico real dos benchmarks');
    await page.locator('#workers-section .diagnostic-details summary').click();
    assert(await page.locator('#worker-table table').isVisible());
    await page.locator('#workers-section .diagnostic-details summary').click();
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path: path.join(dir, 'painel-desktop.png')});
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#results').getBoundingClientRect().top + window.scrollY - 24)); await page.screenshot({path: path.join(dir, 'painel-resultados.png')});
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Overflow em ' + width);
    }
    await page.setViewportSize({width: 390, height: 844}); await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: path.join(dir, 'painel-mobile.png')});
    checks.push('Detalhes expansíveis e layout em 1440, 1024, 768, 390 e 320 px sem rolagem horizontal na página');
    // Failure is injected only into this browser's metrics request, preserving actual services.
    await page.route('**/Admin?handler=Metrics', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({message: 'Serviço temporariamente indisponível (teste)'})}));
    await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Dados sem atualização'));
    assert(await page.locator('#connection-indicator').evaluate(el => el.classList.contains('disconnected')));
    checks.push('Indisponibilidade simulada no navegador identifica os dados como desatualizados');
    await page.unroute('**/Admin?handler=Metrics');
    // Empty-state rendering uses an explicitly isolated response; screenshots above use live data.
    const emptyData = {...snapshot, counts: [], workers: [], runs: [], orders: [], events: []};
    await page.route('**/Admin?handler=Metrics', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(emptyData)}));
    await page.reload(); await page.waitForFunction(() => document.querySelector('#chart').textContent.includes('Seu primeiro resultado'));
    assert((await page.locator('#worker-cards').innerText()).includes('Nenhum worker conectado'));
    assert.equal(await page.locator('#total-orders').innerText(), '0');
    checks.push('Base vazia mostra orientações claras, zero pedidos e ausência de workers sem dados inventados');
    await page.unroute('**/Admin?handler=Metrics');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(dir, 'validacao.json'), JSON.stringify({date_utc: new Date().toISOString(), checks, real_run_ids: runs.map(run => run.id), javascript_errors: errors, screenshots: ['painel-desktop.png', 'painel-resultados.png', 'painel-mobile.png']}, null, 2));
    console.log('Novo painel: ' + checks.length + ' verificações aprovadas.');
  } finally {
    await api('/api/admin/settings', original, 'PUT');
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
