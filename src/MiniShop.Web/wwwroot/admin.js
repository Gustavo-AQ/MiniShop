const $ = selector => document.querySelector(selector);
const modes = {sequential: 'Sequencial', parallel: 'Paralelo', distributed: 'Distribuído'};
const statuses = [
  {key: 'PENDENTE', name: 'Na fila', css: 'pending', color: '#a47b32', note: 'Aguardando processamento'},
  {key: 'PROCESSANDO', name: 'Em processamento', css: 'processing', color: '#6982a3', note: 'Pedidos sendo atendidos'},
  {key: 'APROVADO', name: 'Aprovados', css: 'approved', color: '#4e8467', note: 'Compras confirmadas'},
  {key: 'RECUSADO', name: 'Recusados', css: 'rejected', color: '#bd796c', note: 'Consulte o motivo nos pedidos'}
];
const number = (value, digits = 0) => Number(value).toLocaleString('pt-BR', {minimumFractionDigits: digits, maximumFractionDigits: digits});
const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const shortId = value => value ? String(value).slice(0, 8) : '—';
let history = [], initialized = false, draftChanged = false;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function empty(target, title, description) {
  const box = element('div', 'empty-state');
  box.append(element('strong', '', title), element('span', '', description));
  $(target).replaceChildren(box);
}
async function api(handler, body) {
  const response = await fetch('/Admin?handler=' + handler, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json', 'X-CSRF-TOKEN': $('input[name="__RequestVerificationToken"]').value} : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35000)
  });
  if (response.redirected) { location.href = '/Login'; throw Error('Sua sessão terminou. Entre novamente.'); }
  const data = await response.json();
  if (!response.ok) throw Error(data.message || 'Operação indisponível. Tente novamente.');
  return data;
}
function statusPill(value) {
  const status = statuses.find(s => s.key === value);
  return element('span', 'status-pill ' + (status?.css || ''), status?.name || value);
}
function table(target, rows, columns, noRows = 'Os registros aparecerão aqui quando houver atividade.') {
  if (!rows.length) { empty(target, 'Nenhum registro por enquanto', noRows); return; }
  const t = element('table'), head = t.createTHead().insertRow();
  for (const [, label] of columns) { const th = element('th', '', label); th.scope = 'col'; head.append(th); }
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const [key, , format] of columns) {
      const td = tr.insertCell(), value = row[key];
      const formatted = format ? format(value, row) : value;
      if (formatted instanceof Node) td.append(formatted);
      else td.textContent = formatted == null ? '—' : String(formatted);
      if (value != null) td.title = String(value);
    }
  }
  $(target).replaceChildren(t);
}
function settings() {
  return {mode: $('#mode').value, threads: Number($('#threads').value), workers: Number($('#workers').value),
    iterations: Number($('#iterations').value), delayMs: Number($('#delayMs').value), queueLimit: Number($('#queueLimit').value)};
}
function modeFields() {
  $('#threads').disabled = $('#mode').value !== 'parallel';
  $('#workers').disabled = $('#mode').value !== 'distributed';
}
function fillSettings(s) {
  for (const [key, value] of Object.entries(s)) if ($('#' + key)) $('#' + key).value = value;
  draftChanged = false; initialized = true; modeFields();
  $('#draft-status').textContent = 'Formulário sincronizado com a configuração aplicada.';
}
$('#settings-form').addEventListener('input', () => {
  draftChanged = true; modeFields();
  $('#draft-status').textContent = 'Alterações ainda não aplicadas. Clique em “Aplicar configuração” ou inicie um benchmark com estes valores.';
});
function appliedSummary(data) {
  const s = data.settings, limit = s.maxConcurrentOrders ?? (s.mode === 'parallel' ? s.threads : s.mode === 'distributed' ? s.workers : 1);
  $('#applied-mode').textContent = modes[s.mode] || s.mode;
  $('#applied-settings').textContent = `${modes[s.mode]} · limite global: ${limit} pedido(s) simultâneo(s) · ${s.mode === 'parallel' ? s.threads : 1} thread(s) de cálculo por worker autorizado.`;
  const online = data.workers.filter(w => w.alive);
  const current = online.filter(w => w.execution_mode === s.mode && w.configured_threads === s.threads && w.configured_workers === s.workers);
  const lanes = current.reduce((sum, w) => sum + (w.processing_threads || 0), 0);
  const cpu = current.reduce((sum, w) => sum + (w.cpu_active || 0), 0);
  $('#global-limit').textContent = number(limit);
  $('#online-workers').textContent = number(online.length);
  $('#active-calculations').textContent = number(cpu);
  $('#worker-summary').textContent = `Workers conectados: ${online.length} · threads de cálculo habilitadas reportadas: ${lanes} · cálculos ativos na última amostra: ${cpu}.` +
    (current.length !== online.length ? ' Aguardando confirmação da configuração pelos workers; confira se todos foram atualizados.' : '') +
    (!online.length ? ' Nenhum worker está conectado para atender a fila.' : '');
}
function drawCounts(counts) {
  const total = counts.reduce((sum, item) => sum + Number(item.count), 0);
  $('#counts').replaceChildren(); $('#flow-legend').replaceChildren();
  $('#order-donut').querySelectorAll('.donut-segment').forEach(segment => segment.remove());
  let offset = 0;
  const circumference = 2 * Math.PI * 48;
  for (const status of statuses) {
    const count = Number(counts.find(item => item.status === status.key)?.count || 0);
    const card = element('div', 'metric-card ' + status.css), label = element('div', 'metric-label');
    label.append(element('span', 'metric-dot'), element('span', '', status.name));
    card.append(label, element('strong', 'metric-value', number(count)), element('span', 'metric-note', status.note));
    $('#counts').append(card);
    const legend = element('div', 'legend-item'), dot = element('span', 'legend-dot'); dot.style.background = status.color;
    legend.append(dot, element('span', '', status.name), element('strong', '', number(count))); $('#flow-legend').append(legend);
    if (count && total) {
      const length = count / total * circumference, segment = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({class: 'donut-segment', cx: 60, cy: 60, r: 48, stroke: status.color, 'stroke-dasharray': `${length} ${circumference - length}`, 'stroke-dashoffset': -offset})) segment.setAttribute(key, value);
      $('#order-donut').append(segment); offset += length;
    }
  }
  $('#total-orders').textContent = number(total);
  $('#order-donut').setAttribute('aria-label', 'Distribuição de ' + number(total) + ' pedidos: ' + statuses.map(s => `${s.name}: ${counts.find(c => c.status === s.key)?.count || 0}`).join(', '));
}
function drawStock(products) {
  $('#stock').replaceChildren();
  for (const product of products) {
    const row = element('div', 'stock-row');
    row.append(element('span', '', product.name), element('strong', '', number(product.stock) + ' un.')); $('#stock').append(row);
  }
}
const roles = {enabled: 'Habilitado para processar', waiting_slot: 'Aguardando vaga neste modo', stopped: 'Processo encerrado'};
function drawWorkers(workers) {
  const online = workers.filter(w => w.alive);
  const visible = online.length ? online : [...workers].sort((a, b) => new Date(b.seen_at) - new Date(a.seen_at)).slice(0, 3);
  $('#worker-cards').replaceChildren();
  if (!visible.length) empty('#worker-cards', 'Nenhum worker conectado', 'Inicie os contêineres de workers para processar os pedidos.');
  for (const worker of visible) {
    const card = element('article', 'worker-card'), heading = element('div', 'worker-title');
    heading.append(element('strong', '', worker.host), element('span', 'pill ' + (worker.alive ? '' : 'offline'), worker.alive ? 'Online' : 'Offline'));
    const values = element('div', 'worker-numbers');
    for (const [value, label] of [[worker.processing_threads, 'threads habilitadas'], [worker.active, 'pedidos ativos']]) {
      const item = element('div'); item.append(element('strong', '', worker.alive && value != null ? number(value) : '—'), element('span', '', label)); values.append(item);
    }
    const cpuBox = element('div', 'worker-cpu'), cpuLabel = element('div', 'cpu-label');
    const cpu = worker.alive ? worker.cpu_percent_one_core : null;
    cpuLabel.append(element('span', '', 'CPU · 100% = 1 CPU'), element('strong', '', cpu == null ? '—' : number(cpu, 1) + '%'));
    const track = element('div', 'cpu-track'), fill = element('div');
    fill.style.width = (cpu == null ? 0 : Math.min(100, cpu / (Math.max(1, worker.processors || 1) * 100) * 100)) + '%';
    track.append(fill); track.title = 'Fração da capacidade de ' + (worker.processors || 1) + ' processador(es) lógico(s) informada pelo runtime.';
    cpuBox.append(cpuLabel, track, element('span', 'worker-memory', worker.alive ? `RAM: ${number(worker.memory_bytes / 1048576)} MB · ${modes[worker.execution_mode] || 'Modo não informado'}` : 'Último sinal: ' + date(worker.seen_at)));
    card.append(heading, element('p', 'worker-role', worker.alive ? (roles[worker.execution_state] || 'Versão sem diagnóstico') : 'Sem sinal recente do processo'), values, cpuBox);
    $('#worker-cards').append(card);
  }
  table('#worker-table', workers.map(w => ({...w, alive: w.alive ? 'Online' : 'Offline',
    role: roles[w.execution_state] || 'Versão sem diagnóstico', memory: number(w.memory_bytes / 1048576) + ' MB',
    cpu: number(w.cpu_seconds, 2) + ' s', cpu_now: w.cpu_percent_one_core == null ? '—' : number(w.cpu_percent_one_core, 1) + '%'})),
    [['host', 'Host'], ['pid', 'PID'], ['alive', 'Estado'], ['execution_mode', 'Modo observado', v => modes[v] || v], ['role', 'Papel'],
      ['processing_threads', 'Threads de cálculo habilitadas'], ['cpu_active', 'Cálculos ativos'], ['max_cpu_active', 'Pico de cálculo (configuração)'],
      ['active', 'Pedidos ativos'], ['max_active', 'Pico de pedidos (configuração)'], ['os_threads', 'Threads do SO'],
      ['cpu_now', 'CPU atual (100% = 1 CPU)'], ['cpu', 'CPU processo acumulada'], ['memory', 'RAM']]);
}
function result(run) { return typeof run.result === 'string' ? JSON.parse(run.result) : run.result; }
function config(run) { return typeof run.settings === 'string' ? JSON.parse(run.settings) : run.settings; }
function scenario(s) { return modes[s.Mode] + ' · ' + (s.Mode === 'parallel' ? s.Threads + ' threads' : s.Mode === 'distributed' ? s.Workers + ' workers' : '1 thread'); }
function drawProgress() {
  const run = history.find(r => !r.finished_at) || history[0];
  if (!run) {
    $('#progress-title').textContent = 'Nenhum benchmark iniciado';
    $('#progress-value').textContent = '—'; $('#progress-fill').style.width = '0%';
    $('#run-progress').setAttribute('aria-valuenow', '0');
    $('#progress-description').textContent = 'Inicie um benchmark para acompanhar os pedidos finalizados.';
    return;
  }
  const done = run.finished_at ? run.count : Number(run.completed || 0), percentage = Math.min(100, done / run.count * 100);
  const s = config(run), x = result(run);
  $('#progress-title').textContent = (run.finished_at ? 'Lote concluído' : 'Processando lote') + ' · ' + scenario(s);
  $('#progress-value').textContent = number(percentage, 0) + '%';
  $('#progress-fill').style.width = percentage + '%';
  $('#run-progress').setAttribute('aria-valuenow', String(percentage));
  $('#progress-description').textContent = `${number(done)} de ${number(run.count)} pedidos finalizados · lote ${shortId(run.id)}` +
    (x ? ` · ${number(x.approved)} aprovados e ${number(x.rejected)} recusados · ${number(x.elapsed_ms / 1000, 3)} s no total.` : ' · A fila é persistida no PostgreSQL.');
}
function cohort(run) {
  const s = config(run);
  return JSON.stringify([run.count, s.Iterations, run.seed, s.DelayMs]);
}
function drawChartOptions() {
  const select = $('#chart-filter'), selection = select.value, groups = new Map();
  for (const run of history.filter(r => r.finished_at && result(r))) {
    if (!groups.has(cohort(run))) {
      const s = config(run);
      groups.set(cohort(run), `${number(run.count)} pedidos · ${number(s.Iterations)} it. · semente ${run.seed} · ${s.DelayMs} ms`);
    }
  }
  // Keep the selected option and focus during polling; rebuild only when cohorts change.
  const options = [...groups];
  if (select.dataset.options !== JSON.stringify(options)) {
    select.replaceChildren();
    for (const [key, label] of options) { const option = element('option', '', label); option.value = key; select.append(option); }
    if (!options.length) select.append(element('option', '', 'Aguardando resultados'));
    if (groups.has(selection)) select.value = selection;
    select.dataset.options = JSON.stringify(options);
  }
}
function draw() {
  const groups = new Map(), cohortId = $('#chart-filter').value;
  for (const run of history.filter(r => r.finished_at && result(r) && cohort(r) === cohortId)) {
    const s = config(run), key = JSON.stringify([s.Mode, s.Mode === 'parallel' ? s.Threads : s.Mode === 'distributed' ? s.Workers : 1]);
    if (!groups.has(key)) groups.set(key, {s, times: []});
    groups.get(key).times.push(Number(result(run).elapsed_ms));
  }
  const entries = [...groups.values()].map(g => ({...g, mean: g.times.reduce((a, b) => a + b, 0) / g.times.length}));
  const order = ['sequential', 'parallel', 'distributed'];
  entries.sort((a, b) => order.indexOf(a.s.Mode) - order.indexOf(b.s.Mode) || (a.s.Mode === 'parallel' ? a.s.Threads - b.s.Threads : a.s.Workers - b.s.Workers));
  $('#chart').replaceChildren();
  if (!entries.length) { empty('#chart', 'Seu primeiro resultado começa com um teste', 'Execute um benchmark acima. As barras serão construídas com os tempos reais registrados.'); return; }
  const max = Math.max(1, ...entries.map(e => e.mean)), baseline = entries.find(e => e.s.Mode === 'sequential');
  for (const entry of entries) {
    const row = element('div', 'chart-row'), label = element('div', 'chart-scenario');
    label.append(element('strong', '', modes[entry.s.Mode]), element('small', '', `${entry.s.Mode === 'parallel' ? entry.s.Threads + ' threads' : entry.s.Mode === 'distributed' ? entry.s.Workers + ' workers' : '1 thread'} · n=${entry.times.length}`));
    const track = element('div', 'bar-track'), bar = element('div', 'bar ' + entry.s.Mode + '-color');
    bar.style.width = (entry.mean / max * 100) + '%'; track.append(bar);
    const value = element('div', 'chart-value', number(entry.mean / 1000, 3) + ' s');
    value.append(element('small', '', baseline && entry.mean > 0 ? 'speedup ' + number(baseline.mean / entry.mean, 2) + '×' : 'sem referência seq.'));
    row.append(label, track, value); $('#chart').append(row);
  }
}
$('#chart-filter').addEventListener('change', draw);
function drawRuns() {
  $('#run-count').textContent = history.length ? number(history.length) + ' lote(s) registrado(s)' : 'Nenhum lote registrado';
  const visible = history.slice(0, Number($('#run-limit').value));
  table('#run-table', visible.map(run => {
    const s = config(run), x = result(run);
    return {...run, mode: scenario(s), elapsed: x ? number(x.elapsed_ms / 1000, 3) + ' s' : 'Em execução',
      done: number(x ? x.approved + x.rejected : run.completed) + ' / ' + number(run.count),
      p95: x ? number(x.p95_latency_ms, 1) + ' ms' : '—', rate: x ? number(x.throughput, 2) : '—'};
  }), [['id', 'Lote', shortId], ['started_at', 'Início', date], ['mode', 'Cenário'], ['count', 'Pedidos', v => number(v)],
    ['elapsed', 'Tempo total'], ['done', 'Finalizados'], ['p95', 'p95 · fila incluída'], ['rate', 'Pedidos/s']]);
}
$('#run-limit').addEventListener('change', drawRuns);
async function refresh() {
  try {
    const data = await api('Metrics');
    $('#message').textContent = 'API conectada · atualizado ' + new Date().toLocaleTimeString('pt-BR');
    $('#connection-indicator').className = 'status-dot connected'; $('.connection-strip').classList.remove('is-offline');
    if (!initialized || !draftChanged) fillSettings(data.settings);
    appliedSummary(data); drawCounts(data.counts); drawStock(data.products); drawWorkers(data.workers);
    history = data.runs; drawProgress(); drawRuns(); drawChartOptions(); draw();
    table('#order-table', data.orders, [['id', 'Pedido', shortId], ['created_at', 'Recebido em', date], ['status', 'Estado', statusPill],
      ['reason', 'Resultado'], ['worker', 'Worker'], ['attempts', 'Tentativas']]);
    table('#event-table', data.events, [['at', 'Horário local', date], ['order_id', 'Pedido', shortId], ['kind', 'Evento'], ['worker', 'Worker']]);
  } catch (error) {
    $('#message').textContent = 'Dados sem atualização · ' + (error.message || 'Serviço indisponível') + '. Os valores exibidos são da última consulta.';
    $('#connection-indicator').className = 'status-dot disconnected'; $('.connection-strip').classList.add('is-offline');
  } finally { setTimeout(refresh, 2000); }
}
async function action(form, fn, message = 'Operação aceita.') {
  const button = form.querySelector('button'); button.disabled = true; form.setAttribute('aria-busy', 'true');
  const notice = $('#action-result'); notice.hidden = false; notice.classList.remove('is-error'); notice.textContent = 'Enviando solicitação…';
  let feedback = form.querySelector('.form-feedback');
  if (!feedback) { feedback = element('p', 'form-feedback'); feedback.setAttribute('role', 'status'); form.append(feedback); }
  feedback.classList.remove('is-error'); feedback.textContent = 'Enviando solicitação…';
  try { await fn(); notice.textContent = message; }
  catch (error) { notice.classList.add('is-error'); notice.textContent = error.message; }
  finally {
    feedback.textContent = notice.textContent;
    feedback.classList.toggle('is-error', notice.classList.contains('is-error'));
    button.disabled = false; form.removeAttribute('aria-busy');
  }
}
$('#settings-form').onsubmit = event => {
  event.preventDefault(); action(event.currentTarget, async () => fillSettings(await api('Settings', settings())),
    'Configuração aceita pela API. A confirmação dos workers aparece no resumo em até alguns segundos.');
};
$('#stock-form').onsubmit = event => {
  event.preventDefault(); action(event.currentTarget, () => api('Stock', {stock: Number($('#stock-value').value)}), 'Estoque atualizado. Os saldos aparecem na próxima consulta.');
};
$('#test-form').onsubmit = event => {
  event.preventDefault(); const s = settings();
  action(event.currentTarget, async () => { await api('Test', {count: Number($('#test-count').value), settings: s, seed: 42}); fillSettings(s); },
    'Benchmark recebido. Acompanhe o lote no bloco de progresso. A configuração aplicada aparece no resumo.');
};
$('#load-form').onsubmit = async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  $('#load-result').textContent = 'Enviando compras simultâneas…';
  try {
    const n = Math.max(1, Math.min(200, Number($('#load-count').value)));
    const token = $('input[name="__RequestVerificationToken"]').value;
    const responses = await Promise.allSettled(Array.from({length: n}, () => fetch('/?handler=Checkout', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID()},
      body: JSON.stringify({items: [{productId: 1, quantity: 1}]}), signal: AbortSignal.timeout(8000)
    })));
    const codes = {};
    for (const response of responses) { const code = response.status === 'fulfilled' ? response.value.status : 'rede'; codes[code] = (codes[code] || 0) + 1; }
    const labels = {'202': 'aceitas na fila (HTTP 202)', '503': 'recusadas por indisponibilidade ou capacidade (HTTP 503)', '429': 'limitadas pelo serviço (HTTP 429)', rede: 'sem resposta; consulte os pedidos antes de reenviar'};
    $('#load-result').textContent = Object.entries(codes).map(([code, count]) => `${count} ${labels[code] || '(HTTP ' + code + ')'}`).join(' · ') + '. Aceitação na fila não significa aprovação; acompanhe o resultado nos pedidos.';
  } catch (error) { $('#load-result').textContent = error.message || 'Não foi possível enviar a carga.'; }
  finally { button.disabled = false; }
};
$('#export').onclick = () => {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], {type: 'application/json'}));
  a.href = url; a.download = 'minishop-historico.json'; a.click(); URL.revokeObjectURL(url);
};
if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.lab-nav a')];
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) for (const link of links) {
      const active = link.hash === '#' + entry.target.id;
      link.classList.toggle('is-current', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }, {rootMargin: '-5% 0px -65% 0px', threshold: 0});
  document.querySelectorAll('.lab-section').forEach(section => observer.observe(section));
}
refresh();
