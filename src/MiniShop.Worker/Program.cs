using MiniShop.Infrastructure;
using MiniShop.Core;
using var store=Store.FromEnvironment();
if(args.Contains("--healthcheck"))
{
    var rows=store.Read("SELECT id FROM workers WHERE host=@h AND seen_at>clock_timestamp()-interval '5 seconds'",("h",Environment.MachineName));
    Environment.Exit(rows.Count>0?0:1); return;
}
if(Environment.GetEnvironmentVariable("SKIP_SCHEMA_INIT")!="true") store.Initialize();
if(args.Contains("--configure"))
{
    var mode=Environment.GetEnvironmentVariable("Processing__Mode")??"sequential";
    var threads=int.Parse(Environment.GetEnvironmentVariable("Processing__Threads")??"1");
    store.Configure(new Settings(Mode:mode,Threads:threads));
    return;
}
using var stop=new CancellationTokenSource();
Console.CancelKeyPress+=(_,e)=> { e.Cancel=true; stop.Cancel(); };
using var sigterm=System.Runtime.InteropServices.PosixSignalRegistration.Create(System.Runtime.InteropServices.PosixSignal.SIGTERM,ctx=> { ctx.Cancel=true; stop.Cancel(); });
string id=$"{Environment.MachineName}-{Environment.ProcessId}-{Guid.NewGuid():N}";
new WorkerEngine(store,id).Run(stop.Token);
