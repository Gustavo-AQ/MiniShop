// Modelos visuais para ensino. Nenhum fetch, compra, mudança de estoque ou benchmark real.
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const create = (tag, css, text) => { const node = document.createElement(tag); if (css) node.className = css; if (text != null) node.textContent = text; return node; };
  const format = value => value.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const slides = $$('.lesson-slide');
  let currentSlide = 0, computeTimer = null;

  function stopPlayback() {
    if (computeTimer) clearInterval(computeTimer);
    computeTimer = null; $('#compute-play').textContent = 'Reproduzir'; $('#compute-play').setAttribute('aria-pressed', 'false');
  }
  function showSlide(index, focus = true) {
    stopPlayback();
    currentSlide = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, i) => { slide.hidden = i !== currentSlide; });
    $$('#slide-nav button').forEach((button, i) => {
      if (i === currentSlide) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    $('#chapter').textContent = `${String(currentSlide + 1).padStart(2, '0')} / ${slides[currentSlide].dataset.title.toLocaleUpperCase('pt-BR')}`;
    $('#slide-counter').textContent = `${String(currentSlide + 1).padStart(2, '0')} de ${String(slides.length).padStart(2, '0')}`;
    $('#slide-progress-fill').style.width = ((currentSlide + 1) / slides.length * 100) + '%';
    $('#previous-slide').disabled = currentSlide === 0; $('#next-slide').disabled = currentSlide === slides.length - 1;
    const hash = '#slide-' + (currentSlide + 1);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    if (focus) {
      const heading = slides[currentSlide].querySelector('h2');
      heading.focus({preventScroll: true});
      if (heading.getBoundingClientRect().top < 0) $('.slide-meta').scrollIntoView({block: 'start', behavior: 'instant'});
    }
  }
  function fromHash() {
    const match = location.hash.match(/^#slide-(\d+)$/);
    showSlide(match ? Number(match[1]) - 1 : 0, false);
  }
  $$('#slide-nav button').forEach(button => button.addEventListener('click', () => showSlide(Number(button.dataset.slide))));
  $('#previous-slide').onclick = () => showSlide(currentSlide - 1);
  $('#next-slide').onclick = () => showSlide(currentSlide + 1);
  window.addEventListener('hashchange', fromHash);
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, select, textarea, summary, [contenteditable=true]')) return;
    if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      showSlide(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : currentSlide + (['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1));
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  window.addEventListener('pagehide', stopPlayback);
  $('#fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('#presentation').requestFullscreen) await $('#presentation').requestFullscreen();
      else throw Error('Este navegador não oferece tela cheia. Use o modo de apresentação do próprio navegador.');
      $('#presentation-status').textContent = '';
    } catch (error) { $('#presentation-status').textContent = error.message || 'Não foi possível entrar em tela cheia. Use F11 no computador.'; }
  };
  document.addEventListener('fullscreenchange', () => {
    $('#fullscreen').textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
    $('#fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });

  function choose(buttons, selected, attribute = 'aria-pressed') {
    buttons.forEach(button => { button.setAttribute(attribute, String(button === selected)); button.classList.toggle('selected', button === selected); });
  }
  const intro = {
    sequential: 'No sequencial, uma única thread de cálculo atende um pedido por vez. A API continua podendo receber outras compras para a fila.',
    parallel: 'No paralelo, um único worker habilitado usa 1, 2, 4 ou 8 threads de cálculo. O limite é de pedidos em processamento; a capacidade física depende das vCPU disponíveis.',
    distributed: 'No distribuído, processos independentes disputam uma fila no PostgreSQL. Cada worker autorizado processa um pedido por vez; eles podem estar na mesma VM ou em máquinas diferentes.'
  };
  $$('[data-intro]').forEach(button => button.onclick = () => { choose($$('[data-intro]'), button); $('#intro-explanation').textContent = intro[button.dataset.intro]; });
  const architecture = {
    web: 'O navegador acessa a Web pública. A Web chama a API pela rede privada, usando chaves guardadas no servidor; elas não vão para o navegador.',
    api: 'A API C# valida a compra, verifica idempotência e capacidade da fila, persiste o pedido e retorna HTTP 202 com um identificador. A confirmação vem depois, por consulta de status.',
    database: 'O PostgreSQL é a fonte de verdade: estoque, reservas, pedidos, fila, eventos e resultados. Transações e restrições protegem os dados, mesmo com vários workers.',
    workers: 'Os workers C# assumem pedidos, reservam estoque e executam o mesmo cálculo determinístico de CPU. Ao finalizar, confirmam ou recusam o pedido no banco; a Web consulta o resultado pela API.'
  };
  $$('[data-node]').forEach(button => button.onclick = () => { choose($$('[data-node]'), button); $('#architecture-explanation').textContent = architecture[button.dataset.node]; });
  const concepts = {
    process: 'Cada worker é um processo C# independente. Contêineres isolam os processos, mas três contêineres na mesma VM não equivalem a três computadores físicos.',
    thread: 'A thread é um caminho de execução dentro de um processo. O MiniShop usa threads dedicadas para os cálculos, além das threads auxiliares do .NET. Configurar 2 threads de cálculo não limita o processo inteiro a 2 threads.',
    core: 'Um processador lógico executa instruções. Uma VM enxerga vCPU fornecidas pelo hospedeiro. O sistema operacional agenda e reveza threads nelas; a contagem de threads C# não aumenta a quantidade de núcleos físicos.'
  };
  $$('[data-concept]').forEach(button => button.onclick = () => { choose($$('[data-concept]'), button); $('#concept-explanation').textContent = concepts[button.dataset.concept]; });

  // Sequência visual de estados predeterminados, não um mecanismo de pedidos.
  let orderStep = 0;
  function drawOrder() {
    const failed = $('#payment-outcome').value === 'failure';
    const explanations = [
      'A API recebe a solicitação e a chave de idempotência. O pedido fica persistido e pode ser consultado pelo identificador.',
      'A API valida os produtos e quantidades. O worker verifica o estoque de forma definitiva na transação de reserva.',
      'O worker bloqueia os produtos em ordem, verifica o saldo e reserva uma unidade na mesma transação. Disponível: 4; reservado: 1.',
      'O pedido está em processamento. A rotina C# executa SHA-256 determinístico; um atraso visual, quando ativado, é uma etapa separada.',
      failed ? 'O pagamento fictício foi recusado. O pedido ainda não pode ser aprovado; a finalização devolverá a unidade reservada.' : 'O pagamento fictício foi aceito. Ainda falta persistir a confirmação com o token válido do worker.',
      failed ? 'A finalização devolve a reserva e registra RECUSADO na mesma transação. O estoque disponível volta a 5.' : 'A finalização registra APROVADO e consome a reserva. O estoque disponível permanece 4; a unidade foi vendida.'
    ];
    const reserved = orderStep >= 2 && orderStep < 5;
    $('#example-stock').textContent = orderStep < 2 || (orderStep === 5 && failed) ? '5' : '4';
    $('#example-reserved').textContent = reserved ? '1' : '0';
    $('#example-status').textContent = orderStep < 2 ? 'PENDENTE' : orderStep < 5 ? 'PROCESSANDO' : failed ? 'RECUSADO' : 'APROVADO';
    $('#example-payment').textContent = orderStep < 4 ? 'Ainda não finalizado' : failed ? 'Pagamento recusado' : 'Pagamento aceito';
    $('#order-explanation').textContent = explanations[orderStep];
    $$('#order-pipeline li').forEach((item, i) => { item.classList.toggle('current', i === orderStep); item.classList.toggle('complete', i < orderStep); });
    $('#order-step').disabled = orderStep === 5;
  }
  $('#order-step').onclick = () => { orderStep = Math.min(5, orderStep + 1); drawOrder(); };
  $('#order-reset').onclick = () => { orderStep = 0; drawOrder(); };
  $('#payment-outcome').onchange = () => { orderStep = 0; drawOrder(); };

  // Agendador de ilustração: unidades abstratas, sem cronômetro ou amostragem de CPU.
  const threadOptions = [1, 2, 4, 8];
  let compute;
  function computeConfig() { return {threads: $('#compute-mode').value === 'sequential' ? 1 : threadOptions[Number($('#thread-slider').value)], cores: Number($('#core-slider').value)}; }
  function resetCompute() {
    stopPlayback(); const {threads} = computeConfig();
    compute = {tick: 0, next: 0, done: new Set(), lanes: Array.from({length: threads}, () => null), ran: [], rotation: 0};
    $('#thread-slider').disabled = $('#compute-mode').value !== 'parallel';
    $('#thread-label').textContent = threads; $('#core-label').textContent = $('#core-slider').value;
    $('#compute-explanation').textContent = threads === 1 ? 'Um pedido por vez. Cada pedido precisa de duas unidades de trabalho neste modelo.' : `${threads} threads habilitadas no mesmo processo. Cada pedido precisa de duas unidades de trabalho; as vCPU do modelo determinam quem executa em cada instante.`;
    drawCompute();
  }
  function drawCompute() {
    const {cores} = computeConfig();
    $('#compute-queue').replaceChildren();
    for (let i = 0; i < 8; i++) $('#compute-queue').append(create('span', 'order-chip ' + (compute.done.has(i) ? 'done' : compute.lanes.some(job => job?.id === i) ? 'processing' : ''), 'P' + (i + 1)));
    $('#compute-lanes').replaceChildren();
    compute.lanes.forEach((job, i) => {
      const running = compute.ran.includes(i);
      const lane = create('div', 'compute-lane ' + (running ? 'running' : job ? 'waiting' : ''), `Thread ${i + 1}`);
      lane.append(create('strong', '', running ? `Executou em CPU ${compute.ran.indexOf(i) + 1}` : job ? 'Aguardando CPU' : 'Livre'));
      lane.append(create('span', '', job ? `P${job.id + 1} · ${job.remaining}/2 unidades restantes` : running ? 'Pedido concluído neste passo' : 'Sem pedido atribuído'));
      $('#compute-lanes').append(lane);
    });
    $('#compute-cores').replaceChildren();
    for (let i = 0; i < cores; i++) $('#compute-cores').append(create('span', 'compute-core ' + (i < compute.ran.length ? 'running' : ''), `CPU ${i + 1}${i < compute.ran.length ? ' · T' + (compute.ran[i] + 1) : ' · livre'}`));
    $('#compute-count').textContent = `${compute.done.size} de 8 concluídos`;
    $('#compute-step-label').textContent = compute.tick ? `Instante virtual ${compute.tick}` : 'Modelo preparado';
    $('#compute-step').disabled = compute.done.size === 8; $('#compute-play').disabled = compute.done.size === 8;
  }
  function stepCompute() {
    if (compute.done.size === 8) return;
    compute.tick++;
    compute.lanes = compute.lanes.map(job => job || (compute.next < 8 ? {id: compute.next++, remaining: 2} : null));
    const eligible = compute.lanes.map((_, i) => (i + compute.rotation) % compute.lanes.length).filter(i => compute.lanes[i]);
    compute.ran = eligible.slice(0, computeConfig().cores);
    for (const lane of compute.ran) {
      const job = compute.lanes[lane]; job.remaining--;
      if (job.remaining === 0) { compute.done.add(job.id); compute.lanes[lane] = null; }
    }
    compute.rotation = (compute.rotation + compute.ran.length) % compute.lanes.length;
    $('#compute-explanation').textContent = compute.done.size === 8
      ? `Os 8 pedidos terminaram em ${compute.tick} instantes virtuais. Este resultado pertence apenas ao modelo idealizado e não é uma medição do projeto.`
      : `${compute.ran.length} thread(s) executaram neste instante, em até ${computeConfig().cores} vCPU do modelo. Azul indica um pedido atribuído aguardando CPU; verde indica quem acabou de executar. Threads podem revezar entre núcleos.`;
    drawCompute();
    if (compute.done.size === 8) stopPlayback();
  }
  $('#compute-step').onclick = stepCompute;
  $('#compute-reset').onclick = resetCompute;
  $('#compute-mode').onchange = resetCompute; $('#thread-slider').oninput = resetCompute; $('#core-slider').oninput = resetCompute;
  $('#compute-play').onclick = () => {
    if (computeTimer) { stopPlayback(); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $('#compute-explanation').textContent = 'Movimento reduzido ativado. Use “Avançar um instante” para controlar a demonstração manualmente.'; return;
    }
    $('#compute-play').textContent = 'Pausar'; $('#compute-play').setAttribute('aria-pressed', 'true');
    computeTimer = setInterval(stepCompute, 750);
  };

  // Fila visual com expiração em passos, não a lease real do PostgreSQL.
  let distributed;
  function resetDistributed() {
    const count = Number($('#distributed-slider').value); $('#distributed-label').textContent = count;
    distributed = {tick: 0, workers: Array.from({length: count}, (_, i) => ({id: i, online: true, job: null})), jobs: Array.from({length: 6}, (_, i) => ({id: i, state: 'pending', generation: 0, expires: null, remaining: 3}))};
    $('#distributed-explanation').textContent = 'Avance para os workers assumirem pedidos diferentes. Depois interrompa um deles para observar a retomada.'; drawDistributed();
  }
  function drawDistributed() {
    $('#distributed-queue').replaceChildren();
    for (const job of distributed.jobs) {
      const chip = create('span', 'order-chip ' + ({done: 'done', processing: 'processing', abandoned: 'recovery'}[job.state] || ''), 'P' + (job.id + 1));
      chip.title = `${job.state === 'done' ? 'Concluído' : job.state === 'abandoned' ? 'Aguardando expiração da lease ilustrativa' : job.state === 'processing' ? 'Processando' : 'Pendente'} · token ilustrativo ${job.generation}`;
      $('#distributed-queue').append(chip);
    }
    const done = distributed.jobs.filter(job => job.state === 'done').length;
    $('#distributed-count').textContent = `${done} de 6 concluídos · instante virtual ${distributed.tick}`;
    $('#distributed-workers').replaceChildren();
    for (const worker of distributed.workers) {
      const card = create('article', 'distributed-worker ' + (worker.online ? '' : 'offline'));
      const job = worker.job === null ? null : distributed.jobs[worker.job];
      card.append(create('strong', '', `Worker ${worker.id + 1} · ${worker.online ? 'online' : 'offline'}`), create('p', '', job ? `Pedido P${job.id + 1} · ${job.remaining} unidade(s) restante(s)` : worker.online ? 'Livre para assumir um pedido' : 'Processo interrompido no modelo'), create('small', '', job ? `Token ilustrativo: ${job.generation} · 1 thread` : 'Um processo · uma thread de cálculo'));
      const button = create('button', '', worker.online ? 'Interromper' : 'Reiniciar worker'); button.dataset.worker = worker.id;
      button.onclick = () => {
        worker.online = !worker.online;
        if (!worker.online && worker.job !== null) {
          const abandoned = distributed.jobs[worker.job]; abandoned.state = 'abandoned'; abandoned.expires = distributed.tick + 2; worker.job = null;
          $('#distributed-explanation').textContent = `Worker ${worker.id + 1} parou. P${abandoned.id + 1} continua na fila persistida, aguardando duas etapas de lease ilustrativa. Outro worker poderá reassumi-lo com novo token.`;
        } else $('#distributed-explanation').textContent = worker.online ? `Worker ${worker.id + 1} voltou e poderá assumir trabalho no próximo passo.` : `Worker ${worker.id + 1} foi interrompido enquanto estava livre.`;
        drawDistributed();
      };
      card.append(button); $('#distributed-workers').append(card);
    }
    $('#distributed-step').disabled = done === 6;
  }
  function stepDistributed() {
    if (distributed.jobs.every(job => job.state === 'done')) return;
    distributed.tick++; const recovered = [];
    for (const job of distributed.jobs) if (job.state === 'abandoned' && job.expires <= distributed.tick) {
      job.state = 'pending'; job.remaining = 3; job.expires = null; recovered.push('P' + (job.id + 1));
    }
    for (const worker of distributed.workers.filter(w => w.online)) {
      if (worker.job === null) {
        const job = distributed.jobs.find(job => job.state === 'pending');
        if (job) { job.state = 'processing'; job.generation++; worker.job = job.id; }
      }
      if (worker.job !== null) {
        const job = distributed.jobs[worker.job]; job.remaining--;
        if (!job.remaining) { job.state = 'done'; worker.job = null; }
      }
    }
    const done = distributed.jobs.filter(job => job.state === 'done').length;
    $('#distributed-explanation').textContent = done === 6 ? 'Os seis pedidos foram concluídos uma vez no modelo, inclusive os reassumidos. No sistema real, o token impede uma finalização antiga e o estoque não é reservado novamente na retomada.'
      : recovered.length ? `${recovered.join(', ')}: a lease ilustrativa expirou. O trabalho volta a ser elegível e pode receber novo token. Quem está online continua atendendo.`
        : distributed.workers.every(w => !w.online) ? 'Todos os workers estão offline. Os pedidos permanecem na fila. Reinicie um worker para continuar.' : 'Cada worker online atende no máximo um pedido. Os demais permanecem na fila; pedidos abandonados aguardam a expiração antes da retomada.';
    drawDistributed();
  }
  $('#distributed-step').onclick = stepDistributed; $('#distributed-reset').onclick = resetDistributed; $('#distributed-slider').oninput = resetDistributed;

  $('#queue-capacity').oninput = () => {
    $('#queue-capacity-label').textContent = $('#queue-capacity').value;
    $('#overload-result').textContent = 'Capacidade alterada. Envie novamente para visualizar o novo cenário a partir de uma fila vazia.';
  };
  $('#queue-send').onclick = () => {
    const capacity = Number($('#queue-capacity').value);
    $('#overload-result').replaceChildren();
    const chips = create('div', 'order-chips');
    for (let i = 0; i < 8; i++) chips.append(create('span', 'order-chip ' + (i < capacity ? 'processing' : 'recovery'), i < capacity ? '202' : '503'));
    $('#overload-result').append(chips, create('p', '', `${capacity} pedido(s) aceito(s) na fila (HTTP 202) · ${8 - capacity} recusado(s) por capacidade (HTTP 503). A aprovação ainda depende de estoque e pagamento.`));
  };
  let unavailable = false;
  $('#api-toggle').onclick = () => {
    unavailable = !unavailable;
    $('#api-toggle').setAttribute('aria-pressed', String(unavailable)); $('#api-toggle').textContent = unavailable ? 'Restaurar API no exemplo' : 'Simular API indisponível';
    $('#api-example').classList.toggle('unavailable', unavailable); $('#api-wire').classList.toggle('unavailable', unavailable);
    $('#api-example strong').textContent = unavailable ? 'Indisponível' : 'Disponível';
    $('#api-wire').textContent = unavailable ? '×' : '→';
    $('#api-explanation').textContent = unavailable ? 'A Web na Oracle continua carregando. Novas compras recebem uma mensagem de indisponibilidade com tempo de espera limitado; métricas antigas são identificadas como desatualizadas. Nenhum serviço real foi parado.' : 'A Web pode solicitar compras à API. Esta ilustração não consulta nem interrompe nenhum serviço real.';
  };
  function drawSpeedup() {
    const baseline = Number($('#baseline-time').value), comparison = Number($('#comparison-time').value), max = Math.max(baseline, comparison);
    $('#baseline-label').textContent = $('#baseline-value').textContent = baseline + ' s'; $('#comparison-label').textContent = $('#comparison-value').textContent = comparison + ' s';
    $('#baseline-bar').style.width = baseline / max * 100 + '%'; $('#comparison-bar').style.width = comparison / max * 100 + '%';
    $('#speedup-value').textContent = format(baseline / comparison) + '×';
    $('#speedup-explanation').textContent = baseline > comparison ? 'Neste exemplo hipotético, o cenário comparado tem ganho de velocidade.' : baseline < comparison ? 'Neste exemplo hipotético, o cenário comparado é mais lento. Speedup abaixo de 1× indica piora.' : 'Neste exemplo hipotético, os tempos são iguais: não há ganho de velocidade.';
  }
  $('#baseline-time').oninput = drawSpeedup; $('#comparison-time').oninput = drawSpeedup;
  drawOrder(); resetCompute(); resetDistributed(); drawSpeedup(); fromHash();
})();
