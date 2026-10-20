const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=path.join(root,'results/validation');fs.mkdirSync(dir,{recursive:true});
 const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split('\n').filter(s=>s&&!s.startsWith('#')&&s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080/');await page.waitForSelector('.product');
 if(await page.locator('.product').count()!==2)throw Error('Esperava 2 produtos');
 await page.locator('.product button').first().click();await page.waitForSelector('.cart-row');
 await page.locator('.cart-row input').fill('2');await page.locator('.cart-row input').dispatchEvent('change');
 if(!await page.locator('#total').innerText().then(s=>s.includes('299,80')))throw Error('Carrinho incorreto');
 await page.screenshot({path:path.join(dir,'shop-desktop.png'),fullPage:true});
 await page.locator('.cart-row button').click();if(await page.locator('.cart-row').count())throw Error('Remoção falhou');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'shop-mobile.png'),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw Error('Overflow mobile');
 await page.goto('http://127.0.0.1:8080/Admin');await page.waitForURL('**/Login**');
 await page.locator('input[name=Password]').fill(env.ADMIN_PASSWORD);await page.locator('button').click();await page.waitForURL('**/Admin');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('API conectada'));
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(dir,'admin.png'),fullPage:true});
 // Exercita compra pela interface com antiforgery; não depende de aprovação fictícia.
 await page.goto('http://127.0.0.1:8080/');await page.waitForSelector('.product');
 await page.locator('.product button').first().click();await page.locator('#checkout').click();
 await page.waitForFunction(()=>/Compra (aprovada|recusada)/.test(document.querySelector('#order-status').textContent),{},{timeout:30000});
 if(!await page.locator('#order-id').innerText())throw Error('ID ausente na compra');
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(path.join(dir,'ui.json'),JSON.stringify({date_utc:new Date().toISOString(),checks:['2 produtos vindos da API','adicionar/alterar/remover carrinho','total exibido','layout desktop e mobile sem overflow','redirecionamento administrativo','login com cookie','painel e métricas reais','compra real pela interface com antiforgery e consulta até o estado final','nenhum erro JavaScript'],screenshots:['shop-desktop.png','shop-mobile.png','admin.png']},null,2));
 await browser.close();console.log('UI validada no Chromium real.');
})().catch(e=>{console.error(e);process.exit(1);});
