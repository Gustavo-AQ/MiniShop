// Inicia somente uma Web descartável em 5582, com API propositalmente inacessível.
// Não gera pedidos nem usa PostgreSQL. Requer build Release, Playwright e Chromium.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'results/presentation');
  fs.mkdirSync(dir, {recursive: true});
  const env = {...process.env}, map = {SERVICE_KEY: 'ServiceKey', ADMIN_KEY: 'AdminKey', ADMIN_PASSWORD: 'AdminPassword'};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('='); if (i > 0 && map[line.slice(0, i)]) env[map[line.slice(0, i)]] = line.slice(i + 1);
  }
  Object.assign(env, {ASPNETCORE_URLS: 'http://127.0.0.1:5582', ASPNETCORE_ENVIRONMENT: 'Development', ApiBaseUrl: 'http://127.0.0.1:5999', NO_PROXY: (env.NO_PROXY || '') + ',localhost,127.0.0.1'});
  env.no_proxy = env.NO_PROXY;
  const web = spawn(env.DOTNET_PATH || 'dotnet', [path.join(root, 'src/MiniShop.Web/bin/Release/net10.0/MiniShop.Web.dll')], {cwd: path.join(root, 'src/MiniShop.Web'), env, stdio: 'ignore'});
  let browser; const errors = [], checks = [], origin = 'http://127.0.0.1:5582';
  try {
    await new Promise((resolve, reject) => {
      web.once('error', reject);
      (async () => { for (let i = 0; i < 100; i++) {
        if (web.exitCode !== null) { reject(Error('A Web não iniciou; verifique se a porta 5582 está livre e se o build Release existe.')); return; }
        try { if ((await fetch(origin + '/health')).ok) { resolve(); return; } } catch {}
        await new Promise(r => setTimeout(r, 100));
      } reject(Error('Timeout ao iniciar Web de teste')); })().catch(reject);
    });
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}}), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const responses = []; page.on('request', r => { if (/handler=|\/api\//.test(r.url())) responses.push(r.url()); });
    await page.goto(origin + '/');
    assert.equal(await page.locator('a[href="/Presentation"]').count(), 0);
    await page.goto(origin + '/Presentation'); await page.waitForURL('**/Login**');
    assert.equal(await page.locator('.lesson-slide').count(), 0);
    await page.locator('input[name=Password]').fill(env.AdminPassword); await page.locator('button').click();
    await page.waitForURL('**/Presentation*'); await page.waitForSelector('#slide-counter');
    assert.equal(await page.locator('.lesson-slide').count(), 9);
    assert.equal(await page.locator('.lesson-slide:visible').count(), 1);
    assert.equal(await page.locator('header a[href="/Presentation"]').count(), 1);
    responses.length = 0;
    checks.push('Conteúdo protegido: visitante não vê o link nem os slides; login retorna à apresentação local solicitada');
    await page.locator('[data-intro=parallel]').click(); assert((await page.locator('#intro-explanation').innerText()).includes('2, 4 ou 8'));
    await page.screenshot({path: path.join(dir, 'inicio.png')});
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => document.querySelector('#fullscreen').getAttribute('aria-pressed') === 'true' || document.querySelector('#presentation-status').textContent.length > 0);
    if (await page.locator('#fullscreen').getAttribute('aria-pressed') === 'true') {
      assert.equal(await page.evaluate(() => document.fullscreenElement.id), 'presentation');
      await page.locator('#fullscreen').click();
      await page.waitForFunction(() => !document.fullscreenElement);
    }
    checks.push('Tela cheia funciona ou informa a limitação do navegador sem interromper a aula');
    await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#slide-counter').innerText(), '02 de 09');
    await page.locator('[data-node=database]').click(); assert((await page.locator('#architecture-explanation').innerText()).includes('fonte de verdade'));
    await page.screenshot({path: path.join(dir, 'arquitetura.png')});
    await page.locator('[data-slide="2"]').click();
    for (let i = 0; i < 5; i++) await page.locator('#order-step').click();
    assert.equal(await page.locator('#example-stock').innerText(), '4'); assert.equal(await page.locator('#example-status').innerText(), 'APROVADO');
    await page.locator('#payment-outcome').selectOption('failure');
    for (let i = 0; i < 5; i++) await page.locator('#order-step').click();
    assert.equal(await page.locator('#example-stock').innerText(), '5'); assert.equal(await page.locator('#example-reserved').innerText(), '0');
    assert.equal(await page.locator('#example-status').innerText(), 'RECUSADO');
    checks.push('Ciclo didático avança até aprovação e recusa, com representação correta da reserva e devolução');
    await page.locator('[data-slide="3"]').click(); await page.locator('[data-concept=thread]').click();
    assert((await page.locator('#concept-explanation').innerText()).includes('threads auxiliares'));
    await page.locator('[data-slide="4"]').click();
    assert(await page.locator('#thread-slider').isDisabled());
    for (let i = 0; i < 16; i++) await page.locator('#compute-step').click();
    assert.equal(await page.locator('#compute-count').innerText(), '8 de 8 concluídos');
    await page.locator('#compute-mode').selectOption('parallel');
    await page.locator('#thread-slider').fill('3'); await page.locator('#thread-slider').dispatchEvent('input');
    assert.equal(await page.locator('#thread-label').innerText(), '8');
    // Setas no slider devem mudar seu valor, sem navegar para outro slide.
    await page.locator('#core-slider').focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#core-label').innerText(), '3'); assert.equal(await page.locator('#slide-counter').innerText(), '05 de 09');
    await page.locator('#core-slider').fill('4'); await page.locator('#core-slider').dispatchEvent('input');
    await page.locator('#compute-step').click();
    assert.equal(await page.locator('.compute-lane.running').count(), 4); assert.equal(await page.locator('.compute-lane.waiting').count(), 4);
    assert.equal(await page.locator('.compute-core.running').count(), 4);
    await page.screenshot({path: path.join(dir, 'threads-cpu.png')});
    for (let i = 0; i < 3; i++) await page.locator('#compute-step').click();
    assert.equal(await page.locator('#compute-count').innerText(), '8 de 8 concluídos');
    await page.locator('#compute-reset').click(); await page.locator('#compute-play').click();
    await page.waitForFunction(() => document.querySelector('#compute-step-label').textContent.includes('Instante'));
    await page.locator('[data-slide="5"]').click();
    const stopped = await page.locator('#compute-step-label').innerText(); await page.waitForTimeout(900);
    assert.equal(await page.locator('#compute-step-label').innerText(), stopped);
    checks.push('Sequencial conclui um por vez; 8 threads revezam em 4 vCPU ilustrativas; sliders não mudam slides; reprodução pausa ao sair');
    await page.locator('#distributed-step').click(); await page.locator('[data-worker="0"]').click();
    assert.equal(await page.locator('#distributed-queue .recovery').count(), 1);
    for (let i = 0; i < 16 && !(await page.locator('#distributed-step').isDisabled()); i++) await page.locator('#distributed-step').click();
    assert((await page.locator('#distributed-count').innerText()).includes('6 de 6 concluídos'));
    assert.equal(await page.locator('#distributed-queue .done').count(), 6);
    assert((await page.locator('#distributed-queue .done').first().getAttribute('title')).includes('token ilustrativo 2'));
    await page.screenshot({path: path.join(dir, 'recuperacao.png')});
    await page.locator('#distributed-reset').click();
    for (const worker of [0, 1, 2]) await page.locator(`[data-worker="${worker}"]`).click();
    await page.locator('#distributed-step').click(); assert((await page.locator('#distributed-explanation').innerText()).includes('Todos os workers estão offline'));
    await page.locator('[data-worker="0"]').click();
    for (let i = 0; i < 22 && !(await page.locator('#distributed-step').isDisabled()); i++) await page.locator('#distributed-step').click();
    assert((await page.locator('#distributed-count').innerText()).includes('6 de 6 concluídos'));
    checks.push('Interrupção ilustrativa mantém pedido na fila, recupera com token 2 e conclui sem duplicar; todos offline pausam e reinício retoma');
    await page.locator('[data-slide="6"]').click(); await page.locator('#queue-send').click();
    assert.equal(await page.locator('#overload-result .processing').count(), 3); assert.equal(await page.locator('#overload-result .recovery').count(), 5);
    await page.locator('#api-toggle').click(); assert((await page.locator('#api-explanation').innerText()).includes('Nenhum serviço real foi parado'));
    await page.locator('[data-slide="7"]').click(); assert.equal(await page.locator('#speedup-value').innerText(), '1,50×');
    await page.locator('#comparison-time').fill('24'); await page.locator('#comparison-time').dispatchEvent('input');
    assert.equal(await page.locator('#speedup-value').innerText(), '0,50×'); assert((await page.locator('#speedup-explanation').innerText()).includes('mais lento'));
    checks.push('Sobrecarga mostra 202/503, indisponibilidade é explicitamente ilustrativa e speedup hipotético sinaliza ganho ou piora');
    await page.keyboard.press('End');
    // Um slider ainda focado não deve capturar End como navegação de slides.
    await page.locator('#next-slide').click(); assert.equal(await page.locator('#slide-counter').innerText(), '09 de 09');
    assert(await page.locator('#next-slide').isDisabled());
    await page.locator('.presentation-checklist input').first().check();
    await page.keyboard.press('Home'); // Foco no checkbox é preservado, sem navegar.
    await page.locator('[data-slide="0"]').click();
    await page.keyboard.press('End'); assert.equal(await page.locator('#slide-counter').innerText(), '09 de 09');
    await page.keyboard.press('Home'); assert.equal(await page.locator('#slide-counter').innerText(), '01 de 09');
    await page.goto(origin + '/Presentation#slide-5'); await page.waitForFunction(() => document.querySelector('#slide-counter').textContent === '05 de 09');
    checks.push('Navegação por botões e teclado, limites de início/fim e link direto por capítulo funcionam');
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      for (let slide = 0; slide < 9; slide++) {
        await page.locator(`[data-slide="${slide}"]`).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow ${width}px slide ${slide + 1}`);
      }
    }
    await page.setViewportSize({width: 390, height: 844}); await page.locator('[data-slide="4"]').click();
    await page.screenshot({path: path.join(dir, 'mobile.png'), fullPage: true});
    await page.emulateMedia({reducedMotion: 'reduce'}); await page.locator('#compute-reset').click(); await page.locator('#compute-play').click();
    assert.equal(await page.locator('#compute-play').getAttribute('aria-pressed'), 'false');
    assert((await page.locator('#compute-explanation').innerText()).includes('Movimento reduzido'));
    checks.push('Todos os nove slides sem overflow em cinco larguras; movimento reduzido oferece avanço manual');
    assert.deepEqual(responses, []);
    checks.push('A aula funciona com API inacessível e não envia requisições de pedidos, métricas ou configuração');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(dir, 'validacao.json'), JSON.stringify({date_utc: new Date().toISOString(), api: 'Propositalmente inacessível em 127.0.0.1:5999', checks, javascript_errors: errors}, null, 2));
    console.log('Apresentação: ' + checks.length + ' verificações aprovadas.');
  } finally {
    if (browser) await browser.close(); web.kill('SIGTERM');
    await new Promise(resolve => { if (web.exitCode !== null) resolve(); else { web.once('exit', resolve); setTimeout(() => { web.kill('SIGKILL'); resolve(); }, 5000).unref(); } });
  }
})().catch(error => { console.error(error); process.exit(1); });
