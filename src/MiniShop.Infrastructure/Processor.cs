using System.Diagnostics;
using MiniShop.Core;
namespace MiniShop.Infrastructure;
// O mesmo método é usado em todos os modos, incluindo os testes.
public sealed class Processor(Store store,string identity)
{
    int active,peak;
    public int Active => Volatile.Read(ref active);
    public int Peak => Volatile.Read(ref peak);
    public void Process(Job job,CancellationToken cancellation=default)
    {
        var n=Interlocked.Increment(ref active);
        int old; do { old=Volatile.Read(ref peak); } while(n>old && Interlocked.CompareExchange(ref peak,n,old)!=old);
        var watch=Stopwatch.StartNew();
        // Timer independente renova a posse durante CPU/atraso. Token protege efeitos após retomada.
        using var timer=new Timer(_=> { try { store.Renew(job); } catch(Exception e) { Console.Error.WriteLine($"Renovação: {e.Message}"); } },null,2000,2000);
        try
        {
            int thread=Environment.CurrentManagedThreadId;
            Console.WriteLine($"INICIO worker={identity} order={job.Id} thread={thread} active={n}");
            var digest=Workload.Compute(job.Seed,job.Iterations);
            if(job.DelayMs>0 && cancellation.WaitHandle.WaitOne(job.DelayMs)) return;
            cancellation.ThrowIfCancellationRequested();
            bool committed=store.Complete(job,digest,watch.Elapsed.TotalMilliseconds,thread);
            Console.WriteLine($"FIM worker={identity} order={job.Id} thread={thread} committed={committed}");
        }
        catch(OperationCanceledException) { throw; }
        catch(Exception e) { try { store.RecordError(job,identity,e.Message); } catch { /* Falha de conexão já aparece no log do worker. */ } throw; }
        finally { Interlocked.Decrement(ref active); }
    }
}
public sealed class WorkerEngine(Store store,string identity)
{
    public void Run(CancellationToken stop)
    {
        var processor=new Processor(store,identity);
        store.Heartbeat(identity,0,0);
        using var pulse=new Timer(_=> { try { store.Heartbeat(identity,processor.Active,processor.Peak); store.RefreshRuns(); } catch(Exception e) { Console.Error.WriteLine(e.Message); } },null,1000,1000);
        while(!stop.IsCancellationRequested)
        {
            try
            {
                var config=store.GetSettings();
                using var owner=store.Source.OpenConnection();
                int slot=-1;
                var keys=config.Mode=="distributed"?Enumerable.Range(7200,config.Workers):[7100];
                foreach(var key in keys)
                    if(Store.Scalar<bool>(owner,"SELECT pg_try_advisory_lock(@k)",("k",key))) { slot=key; break; }
                if(slot<0) { stop.WaitHandle.WaitOne(250); continue; }
                try
                {
                    using var sessionStop=CancellationTokenSource.CreateLinkedTokenSource(stop);
                    var laneStop=sessionStop.Token;
                    int degree=config.Mode=="parallel"?config.Threads:1;
                    var lanes=Enumerable.Range(0,degree).Select(i=>new Thread(()=>
                    {
                        while(!laneStop.IsCancellationRequested)
                        {
                            try
                            {
                                if(store.GetSettings()!=config) break;
                                // Claim valida que a sessão ainda possui o lock de coordenação.
                                var job=store.Claim(identity,15,config,owner.ProcessID,slot);
                                if(job!=null) processor.Process(job,laneStop); else laneStop.WaitHandle.WaitOne(75);
                            }
                            catch(OperationCanceledException) { break; }
                            catch(Exception e) { Console.Error.WriteLine($"lane={i}: {e.Message}"); laneStop.WaitHandle.WaitOne(500); }
                        }
                    }) { IsBackground=true,Name=$"MiniShop-{i}" }).ToArray();
                    foreach(var lane in lanes) lane.Start();
                    try
                    {
                        while(lanes.Any(l=>l.IsAlive))
                        {
                            stop.WaitHandle.WaitOne(500);
                            // Detecta sessão perdida; interrompe tentativas e volta a disputar um slot.
                            Store.Scalar<int>(owner,"SELECT 1");
                        }
                    }
                    finally { sessionStop.Cancel(); foreach(var lane in lanes) lane.Join(); }
                }
                finally { Store.Exec(owner,"SELECT pg_advisory_unlock(@k)",("k",slot)); }
            }
            catch(Exception e) { Console.Error.WriteLine(e.Message); stop.WaitHandle.WaitOne(1000); }
        }
        store.Heartbeat(identity,processor.Active,processor.Peak);
    }
}
