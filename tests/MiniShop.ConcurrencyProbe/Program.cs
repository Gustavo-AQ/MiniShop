using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using MiniShop.Core;
using MiniShop.Infrastructure;
using Npgsql;

if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Esta auditoria lê /proc e deve ser executada no Linux.");
var connection = Environment.GetEnvironmentVariable("MINISHOP_PROBE_DB")
    ?? throw new InvalidOperationException("Defina MINISHOP_PROBE_DB para um banco DESCARTÁVEL terminado em _test ou _probe.");
var database = new NpgsqlConnectionStringBuilder(connection).Database ?? "";
if (!database.EndsWith("_test", StringComparison.Ordinal) && !database.EndsWith("_probe", StringComparison.Ordinal))
    throw new InvalidOperationException("Proteção: o probe apaga dados e exige banco terminado em _test ou _probe.");
var root = new DirectoryInfo(AppContext.BaseDirectory);
while (root != null && !File.Exists(Path.Combine(root.FullName, "MiniShop.slnx"))) root = root.Parent;
if (root == null) throw new InvalidOperationException("Raiz da solução não localizada.");
var workerDll = Path.Combine(root.FullName, "src/MiniShop.Worker/bin/Release/net10.0/MiniShop.Worker.dll");
var output = Path.GetFullPath(args.FirstOrDefault() ?? "results/concurrency/probe.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
var host = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet";
using var ticksProcess = Process.Start(new ProcessStartInfo("getconf", "CLK_TCK") { RedirectStandardOutput = true })!;
var ticks = double.Parse(ticksProcess.StandardOutput.ReadToEnd(), CultureInfo.InvariantCulture);
ticksProcess.WaitForExit();
using var store = new Store(connection);
store.Initialize();
var results = new List<object>();
var scenarios = new[] {
    new Settings("sequential", 8, 3, 200000),
    new Settings("parallel", 1, 3, 200000),
    new Settings("parallel", 2, 3, 200000),
    new Settings("parallel", 4, 3, 200000),
    new Settings("parallel", 8, 3, 200000),
    new Settings("distributed", 8, 1, 200000),
    new Settings("distributed", 8, 2, 200000),
    new Settings("distributed", 8, 3, 200000)
};
foreach (var settings in scenarios)
{
    using (var c = store.Source.OpenConnection())
        Store.Exec(c, "TRUNCATE events,order_items,orders,runs,workers RESTART IDENTITY CASCADE; UPDATE products SET stock=100");
    store.Configure(settings);
    var children = new List<Process>();
    var logs = new System.Collections.Concurrent.ConcurrentQueue<string>();
    try
    {
        for (var i = 0; i < 3; i++)
        {
            var start = new ProcessStartInfo(host) { RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(workerDll);
            start.Environment["ConnectionStrings__Shop"] = connection;
            start.Environment["SKIP_SCHEMA_INIT"] = "true";
            var child = new Process { StartInfo = start };
            child.OutputDataReceived += (_, e) => { if (e.Data != null) logs.Enqueue(e.Data); };
            child.ErrorDataReceived += (_, e) => { if (e.Data != null) logs.Enqueue(e.Data); };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine(); children.Add(child);
        }
        var readyDeadline = DateTime.UtcNow.AddSeconds(20);
        while (store.Read("SELECT id FROM workers").Count < 3)
        {
            if (DateTime.UtcNow > readyDeadline || children.Any(p => p.HasExited))
                throw new InvalidOperationException("Workers não iniciaram: " + string.Join("\n", logs));
            await Task.Delay(100);
        }
        await Task.Delay(500);
        var idleBefore = children.ToDictionary(p => p.Id, ProcessCpu);
        await Task.Delay(1500);
        var idleCpu = children.Sum(p => ProcessCpu(p) - idleBefore[p.Id]);
        var startThreads = children.SelectMany(p => ReadThreads(p.Id, ticks)).ToDictionary(t => (t.Pid, t.Tid));
        var samples = new Dictionary<(int, int), ThreadSample>(startThreads);
        var cores = new Dictionary<(int, int), HashSet<int>>();
        var beforeCpu = children.ToDictionary(p => p.Id, ProcessCpu);
        var timer = Stopwatch.StartNew();
        var run = store.StartRun(64, settings);
        long peak = 0;
        while (true)
        {
            foreach (var t in children.SelectMany(p => ReadThreads(p.Id, ticks)))
            {
                samples[(t.Pid, t.Tid)] = t;
                if (!cores.TryGetValue((t.Pid, t.Tid), out var seen)) cores[(t.Pid, t.Tid)] = seen = [];
                seen.Add(t.Core);
            }
            peak = Math.Max(peak, (long)store.Read("SELECT count(*) n FROM orders WHERE status='PROCESSANDO'")[0]["n"]!);
            if ((long)store.Read("SELECT count(*) n FROM orders WHERE finished_at IS NULL")[0]["n"]! == 0) break;
            if (timer.Elapsed > TimeSpan.FromSeconds(60)) throw new TimeoutException("Probe excedeu 60 s no cenário.");
            await Task.Delay(40);
        }
        store.RefreshRuns();
        var processCpu = children.Sum(p => ProcessCpu(p) - beforeCpu[p.Id]);
        var laneThreads = samples.Values.Where(t => t.Name.StartsWith("MiniShop-", StringComparison.Ordinal))
            .Select(t => new { pid=t.Pid,tid=t.Tid,name=t.Name,
                cpu_seconds=Math.Max(0,t.CpuSeconds-(startThreads.TryGetValue((t.Pid,t.Tid),out var old)?old.CpuSeconds:0)),
                processors_seen=cores.GetValueOrDefault((t.Pid,t.Tid))?.Order().ToArray() ?? [] }).ToArray();
        int limit = settings.Mode == "parallel" ? settings.Threads : settings.Mode == "distributed" ? settings.Workers : 1;
        int hot = laneThreads.Count(t => t.cpu_seconds >= 0.05);
        var workerCount = store.Read("SELECT DISTINCT worker FROM orders WHERE worker IS NOT NULL").Count;
        var passed = peak <= limit && peak > 0 && hot > 0 && hot <= limit && workerCount == (settings.Mode == "distributed" ? settings.Workers : 1);
        results.Add(new { settings,run_id=run,expected_concurrency=limit,peak_inflight=peak,
            cpu_execution_threads=hot,lane_threads=laneThreads,actual_workers=workerCount,
            idle_workers_cpu_seconds_per_1_5s=idleCpu,workers_cpu_seconds=processCpu,
            observed_wall_seconds=timer.Elapsed.TotalSeconds,
            workers=store.Read("SELECT * FROM workers ORDER BY id"),passed });
        File.WriteAllText(output,JsonSerializer.Serialize(new { date_utc=DateTime.UtcNow,logical_processors=Environment.ProcessorCount,results },new JsonSerializerOptions {WriteIndented=true}));
        Console.WriteLine($"{settings.Mode} t={settings.Threads} w={settings.Workers}: limite={limit}, pico={peak}, threads CPU={hot}, workers={workerCount}, idle CPU={idleCpu:F3}s; PASS={passed}");
        if (!passed) throw new InvalidOperationException("Limite de execução não conferiu. Consulte " + output);
    }
    finally
    {
        foreach (var child in children) { if (!child.HasExited) child.Kill(entireProcessTree:true); await child.WaitForExitAsync(); child.Dispose(); }
    }
}
Console.WriteLine("Auditoria concluída: " + output);

static double ProcessCpu(Process process) { process.Refresh(); return process.TotalProcessorTime.TotalSeconds; }
static IEnumerable<ThreadSample> ReadThreads(int pid, double ticks)
{
    var rows = new List<ThreadSample>();
    foreach (var dir in Directory.EnumerateDirectories($"/proc/{pid}/task"))
    {
        try
        {
            var stat = File.ReadAllText(Path.Combine(dir,"stat"));
            int open=stat.IndexOf('('), close=stat.LastIndexOf(')');
            var parts=stat[(close+2)..].Split(' ',StringSplitOptions.RemoveEmptyEntries);
            rows.Add(new(pid,int.Parse(Path.GetFileName(dir)),stat[(open+1)..close],
                (double.Parse(parts[11],CultureInfo.InvariantCulture)+double.Parse(parts[12],CultureInfo.InvariantCulture))/ticks,
                int.Parse(parts[36],CultureInfo.InvariantCulture)));
        }
        catch (IOException) { /* A thread pode terminar entre enumeração e leitura. */ }
    }
    return rows;
}
record ThreadSample(int Pid,int Tid,string Name,double CpuSeconds,int Core);
