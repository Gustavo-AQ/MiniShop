using System.Diagnostics;
using MiniShop.Core;
namespace MiniShop.Infrastructure;
// O mesmo método é usado em todos os modos, incluindo os testes.
public sealed class Processor(Store store,string identity)
{
    int active,peak,cpuActive,cpuPeak;
    public int Active => Volatile.Read(ref active);
    public int Peak => Volatile.Read(ref peak);
    public int CpuActive => Volatile.Read(ref cpuActive);
    public int CpuPeak => Volatile.Read(ref cpuPeak);
    public void ResetPeaks()
    {
        if (Active != 0) throw new InvalidOperationException("Aguarde as threads anteriores antes de reiniciar métricas.");
        Interlocked.Exchange(ref peak, 0);
        Interlocked.Exchange(ref cpuPeak, 0);
    }
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
            string digest;
            int cpu=Interlocked.Increment(ref cpuActive);
            int previous;
            do { previous=Volatile.Read(ref cpuPeak); }
            while(cpu>previous && Interlocked.CompareExchange(ref cpuPeak,cpu,previous)!=previous);
            try { digest=Workload.Compute(job.Seed,job.Iterations); }
            finally { Interlocked.Decrement(ref cpuActive); }
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
        var applied=store.GetSettings();
        var execution=new WorkerExecution(applied,0,"waiting_slot");
        int pulseBusy=0;
        double? previousCpu=null;
        long previousTimestamp=0;
        void Heartbeat()
        {
            using var process=Process.GetCurrentProcess();
            double cpu=process.TotalProcessorTime.TotalSeconds;
            long timestamp=Stopwatch.GetTimestamp();
            double? percent=previousCpu.HasValue
                ? Math.Max(0,100*(cpu-previousCpu.Value)/Stopwatch.GetElapsedTime(previousTimestamp,timestamp).TotalSeconds)
                : null;
            previousCpu=cpu; previousTimestamp=timestamp;
            var state=Volatile.Read(ref execution);
            store.Heartbeat(identity,processor.Active,processor.Peak,new WorkerRuntimeSnapshot(
                state.Configuration,state.ProcessingThreads,state.State,processor.CpuActive,processor.CpuPeak,percent));
            if(state.ProcessingThreads>0) store.RefreshRuns();
        }
        Heartbeat();
        var pulse=new Timer(_=>
        {
            // Não acumula heartbeats/consultas caso uma chamada ao banco esteja lenta.
            if(Interlocked.CompareExchange(ref pulseBusy,1,0)!=0) return;
            try { Heartbeat(); }
            catch(Exception e) { Console.Error.WriteLine(e.Message); }
            finally { Volatile.Write(ref pulseBusy,0); }
        },null,1000,1000);
        try
        {
            while(!stop.IsCancellationRequested)
            {
                try
                {
                    var config=store.GetSettings();
                    if(config!=applied)
                    {
                        processor.ResetPeaks();
                        applied=config;
                    }
                    Volatile.Write(ref execution,new WorkerExecution(config,0,"waiting_slot"));
                    using var owner=store.Source.OpenConnection();
                    int slot=-1;
                    var keys=config.Mode=="distributed"?Enumerable.Range(7200,config.Workers):[7100];
                    foreach(var key in keys)
                        if(Store.Scalar<bool>(owner,"SELECT pg_try_advisory_lock(@k)",("k",key))) { slot=key; break; }
                    if(slot<0) { stop.WaitHandle.WaitOne(500); continue; }
                    try
                    {
                        using var sessionStop=CancellationTokenSource.CreateLinkedTokenSource(stop);
                        var laneStop=sessionStop.Token;
                        int degree=config.ProcessingThreadsPerWorker;
                        Volatile.Write(ref execution,new WorkerExecution(config,degree,"enabled"));
                        int ownerPid=owner.ProcessID;
                        var lanes=Enumerable.Range(0,degree).Select(i=>new Thread(()=>
                        {
                            int idleDelay=75;
                            while(!laneStop.IsCancellationRequested)
                            {
                                try
                                {
                                    // Claim confere a configuração e o lock na mesma transação da reserva.
                                    var claim=store.ClaimNext(identity,15,config,ownerPid,slot);
                                    if(claim.Job is {} job) processor.Process(job,laneStop);
                                    if(claim.MadeProgress) idleDelay=75;
                                    else
                                    {
                                        laneStop.WaitHandle.WaitOne(idleDelay);
                                        idleDelay=Math.Min(1000,idleDelay*2);
                                    }
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
                                if(stop.WaitHandle.WaitOne(500)) break;
                                // Uma consulta por processo monitora modo e sessão, em vez de uma por pedido/thread.
                                if(store.GetSettings(owner)!=config) break;
                            }
                        }
                        finally
                        {
                            sessionStop.Cancel();
                            foreach(var lane in lanes) lane.Join();
                            Volatile.Write(ref execution,new WorkerExecution(config,0,"waiting_slot"));
                        }
                    }
                    finally { Store.Exec(owner,"SELECT pg_advisory_unlock(@k)",("k",slot)); }
                }
                catch(Exception e) { Console.Error.WriteLine(e.Message); stop.WaitHandle.WaitOne(1000); }
            }
        }
        finally
        {
            // Finaliza callbacks antes do último snapshot e antes de o Store ser descartado.
            pulse.DisposeAsync().AsTask().GetAwaiter().GetResult();
            Volatile.Write(ref execution,new WorkerExecution(applied,0,"stopped"));
            try { Heartbeat(); } catch(Exception e) { Console.Error.WriteLine(e.Message); }
        }
    }
}
