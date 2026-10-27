using MiniShop.Core;
using MiniShop.Infrastructure;
using Xunit;
[assembly:CollectionBehavior(DisableTestParallelization=true)]
namespace MiniShop.Tests;
public class IntegrityTests : IDisposable
{
    readonly Store db;
    public IntegrityTests()
    {
        var connection=Environment.GetEnvironmentVariable("MINISHOP_TEST_DB")??throw new InvalidOperationException("Defina MINISHOP_TEST_DB apontando para banco DESCARTÁVEL. Os testes apagam suas tabelas.");
        db=new Store(connection);db.Initialize();using var c=db.Source.OpenConnection();Store.Exec(c,"TRUNCATE events,order_items,orders,runs,workers,retired_order_keys RESTART IDENTITY CASCADE; UPDATE products SET stock=100");db.Configure(new Settings(Iterations:100));
    }
    public void Dispose()=>db.Dispose();
    Guid Buy(int q=1,string? key=null)=>db.Submit(new Purchase([new Item(1,q)]),key??Guid.NewGuid().ToString());
    void Payment(Guid id,bool fail){using var c=db.Source.OpenConnection();Store.Exec(c,"UPDATE orders SET payment_fails=@f WHERE id=@id",("f",fail),("id",id));}
    string Status(Guid id)=>(string)db.Read("SELECT status FROM orders WHERE id=@id",("id",id)).Single()["status"]!;
    int Stock()=>(int)db.Read("SELECT stock FROM products WHERE id=1").Single()["stock"]!;
    void Drain(string worker="test") { while(db.Read("SELECT id FROM orders WHERE status IN('PENDENTE','PROCESSANDO')").Count>0){ var j=db.Claim(worker);if(j!=null)new Processor(db,worker).Process(j); }db.RefreshRuns(); }
    [Fact] public void SufficientStock(){var id=Buy(3);Payment(id,false);Drain();Assert.Equal("APROVADO",Status(id));Assert.Equal(97,Stock());}
    [Fact] public void NoStock(){db.ResetStock(0);var id=Buy();Drain();Assert.Equal("RECUSADO",Status(id));Assert.Equal(0,Stock());}
    [Fact] public void PaymentFailureReleasesReservation(){var id=Buy(3);Payment(id,true);var j=db.Claim("a")!;Assert.Equal(97,Stock());new Processor(db,"a").Process(j);Assert.Equal("RECUSADO",Status(id));Assert.Equal(100,Stock());}
    [Fact] public void IdempotencyAndChangedCart(){var key="same";var ids=Enumerable.Range(0,25).AsParallel().Select(_=>Buy(1,key)).ToArray();Assert.Single(ids.Distinct());var e=Assert.Throws<BusinessException>(()=>Buy(2,key));Assert.Equal(409,e.Status);}
    [Fact] public void ConcurrentPurchasesNeverOversell()
    {
        db.Configure(new Settings("parallel",8,Iterations:100));db.ResetStock(5);var ids=Enumerable.Range(0,40).AsParallel().Select(_=>Buy()).ToArray();foreach(var id in ids)Payment(id,false);
        Parallel.For(0,8,_=>Drain(Guid.NewGuid().ToString()));
        Assert.Equal(0,Stock());Assert.Equal(5,db.Read("SELECT id FROM orders WHERE status='APROVADO'").Count);Assert.Equal(35,db.Read("SELECT id FROM orders WHERE status='RECUSADO'").Count);
        Assert.Equal(40,db.Read("SELECT id FROM events WHERE kind='FINALIZADO'").Count);
    }
    [Fact] public void RecoveryFencesStaleWorkerAndDoesNotReserveTwice()
    {
        var id=Buy(4);Payment(id,false);var old=db.Claim("dead",1)!;Assert.Equal(96,Stock());Thread.Sleep(1200);
        var next=db.Claim("replacement")!;Assert.Equal(old.Id,next.Id);Assert.NotEqual(old.Token,next.Token);Assert.Equal(96,Stock());
        Assert.False(db.Complete(old,"STALE",1,1));new Processor(db,"replacement").Process(next);Assert.False(db.Complete(next,"DUPLICATE",1,1));Assert.Equal("APROVADO",Status(id));Assert.Equal(96,Stock());
        Assert.Single(db.Read("SELECT id FROM events WHERE kind='FINALIZADO'"));Assert.Single(db.Read("SELECT id FROM events WHERE kind='RECUPERADO'"));
    }
    [Fact] public void QueueIsBoundedAndResetIsBlocked(){db.Configure(new Settings(Iterations:1,QueueLimit:2));Buy();Buy();Assert.Equal(503,Assert.Throws<BusinessException>(()=>Buy()).Status);Assert.Equal(409,Assert.Throws<BusinessException>(()=>db.ResetStock(10)).Status);}
    [Fact] public void CpuWorkIsDeterministic(){Assert.Equal("B435C6FBADA6A2A3AA6652B5E18EF93713A866EB3AD0D05BDCD50ADBD21D4D03",Workload.Compute(42,100));Assert.NotEqual(Workload.Compute(42,100),Workload.Compute(43,100));Assert.Equal(Workload.Generate(1),Workload.Generate(1));}
    [Theory][InlineData("sequential",1,1)][InlineData("parallel",2,1)][InlineData("parallel",4,1)][InlineData("parallel",8,1)][InlineData("distributed",1,1)][InlineData("distributed",1,2)][InlineData("distributed",1,3)]
    public async Task RealExecutionModesFinishCorrectly(string mode,int threads,int workers)
    {
        var count=60;var run=db.StartRun(count,new Settings(mode,threads,workers,1000));
        using var stop=new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var engines=Enumerable.Range(0,3).Select(i=>Task.Run(()=>new WorkerEngine(db,$"worker-{i}").Run(stop.Token))).ToArray();
        while(!stop.IsCancellationRequested){db.RefreshRuns();if(db.Read("SELECT finished_at FROM runs WHERE id=@id",("id",run)).Single()["finished_at"]!=null)break;Thread.Sleep(100);}
        stop.Cancel();await Task.WhenAll(engines);var finished=db.Read("SELECT * FROM orders WHERE run_id=@id AND finished_at IS NOT NULL",("id",run));Assert.Equal(count,finished.Count);
        Assert.Equal(count,db.Read("SELECT * FROM events WHERE kind='FINALIZADO'").Count);Assert.Empty(db.Read("SELECT id FROM products WHERE stock<0"));
        // Estoque inicial menos somente vendas aprovadas; recusa de pagamento não consome.
        foreach(var p in db.Read("SELECT * FROM products")){var sold=db.Read("SELECT COALESCE(sum(i.quantity),0)::int sold FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='APROVADO' AND i.product_id=@p",("p",p["id"]));Assert.Equal(count*3-(int)sold[0]["sold"]!,(int)p["stock"]!);}
        var peaks=db.Read("SELECT max_active FROM workers").Select(w=>(int)w["max_active"]!).ToArray();Assert.NotEmpty(peaks);
        Assert.All(peaks,p=>Assert.InRange(p,0,mode=="parallel"?threads:1));
    }
    [Fact]
    public async Task ModeChangesReportEffectiveLanesAndResetCpuPeaks()
    {
        using var stop=new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var engines=Enumerable.Range(0,3).Select(i=>Task.Run(()=>new WorkerEngine(db,$"transition-{i}").Run(stop.Token))).ToArray();
        try
        {
            var scenarios=new[] {new Settings("parallel",8,3,50000),new Settings("sequential",8,3,50000),
                new Settings("parallel",2,3,50000),new Settings("distributed",8,2,50000)};
            foreach(var settings in scenarios)
            {
                var id=db.StartRun(32,settings);
                await Until(()=>db.Read("SELECT id FROM orders WHERE run_id=@id AND finished_at IS NULL",("id",id)).Count==0);
                db.RefreshRuns();
                await Until(()=>
                {
                    var rows=db.Read("SELECT * FROM workers WHERE id LIKE 'transition-%'");
                    return rows.Count==3 && rows.All(w=>(string?)w["execution_mode"]==settings.Mode &&
                        (int?)w["configured_threads"]==settings.Threads && (int?)w["configured_workers"]==settings.Workers) &&
                        rows.Sum(w=>(int?)w["processing_threads"]??0)==settings.MaxConcurrentOrders &&
                        rows.Any(w=>(int?)w["max_cpu_active"]>0);
                });
                var workers=db.Read("SELECT * FROM workers WHERE id LIKE 'transition-%'");
                Assert.All(workers,w=>
                {
                    Assert.InRange((int)w["processing_threads"]!,0,settings.ProcessingThreadsPerWorker);
                    Assert.InRange((int)w["max_cpu_active"]!,0,settings.ProcessingThreadsPerWorker);
                    Assert.InRange((int)w["max_active"]!,0,settings.ProcessingThreadsPerWorker);
                });
                // Varrer os intervalos persistidos verifica o teto global, não apenas o pico de cada processo.
                var peak=db.Read("""
                    SELECT max(n) peak FROM (
                        SELECT sum(delta) OVER(ORDER BY at,delta) n FROM (
                            SELECT started_at at,1 delta FROM orders WHERE run_id=@id
                            UNION ALL SELECT finished_at,-1 FROM orders WHERE run_id=@id
                        ) boundaries
                    ) totals
                    """,("id",id));
                Assert.InRange(Convert.ToInt32(peak[0]["peak"]),1,settings.MaxConcurrentOrders);
                Assert.Equal(32,db.Read("SELECT e.id FROM events e JOIN orders o ON e.order_id=o.id WHERE o.run_id=@id AND e.kind='FINALIZADO'",("id",id)).Count);
            }
        }
        finally { stop.Cancel();await Task.WhenAll(engines); }
        Assert.All(db.Read("SELECT execution_state FROM workers"),w=>Assert.Equal("stopped",w["execution_state"]));
    }
    [Fact]
    public void FinalizesRunOnlyAfterEveryOrderAndKeepsHistoricalProgress()
    {
        var id=db.StartRun(3,new Settings(Iterations:100));
        var first=db.Claim("test")!;new Processor(db,"test").Process(first);db.RefreshRuns();
        Assert.Null(db.Read("SELECT finished_at FROM runs WHERE id=@id",("id",id))[0]["finished_at"]);
        Drain();db.ResetStock(100);
        Assert.NotNull(db.Read("SELECT finished_at FROM runs WHERE id=@id",("id",id))[0]["finished_at"]);
        var next=db.StartRun(2,new Settings(Iterations:100));db.RefreshRuns();
        Assert.NotNull(db.Read("SELECT finished_at FROM runs WHERE id=@id",("id",id))[0]["finished_at"]);
        Assert.Null(db.Read("SELECT finished_at FROM runs WHERE id=@id",("id",next))[0]["finished_at"]);
        Drain();
    }
    [Fact]
    public void HistoryClearRequiresConfirmationAndIdleQueue()
    {
        var id=Buy();Payment(id,false);
        Assert.Equal(400,Assert.Throws<BusinessException>(()=>db.ClearHistory("apagar")).Status);
        Assert.Equal(409,Assert.Throws<BusinessException>(()=>db.ClearHistory("APAGAR HISTORICO")).Status);
        Assert.NotNull(db.Order(id));
        var job=db.Claim("test")!;
        Assert.Equal(409,Assert.Throws<BusinessException>(()=>db.ClearHistory("APAGAR HISTORICO")).Status);
        Assert.Equal(99,Stock());
        new Processor(db,"test").Process(job);
        db.StartRun(1,new Settings(Iterations:100));
        var benchmarkJob=db.Claim("test")!;new Processor(db,"test").Process(benchmarkJob);
        // Mesmo sem pedidos pendentes, o fechamento do benchmark deve terminar primeiro.
        Assert.Equal(409,Assert.Throws<BusinessException>(()=>db.ClearHistory("APAGAR HISTORICO")).Status);
        Assert.NotEmpty(db.Read("SELECT * FROM events"));
    }
    [Fact]
    public void HistoryClearPreservesInventoryConfigurationOnlineWorkersAndReplayProtection()
    {
        var settings=new Settings("parallel",2,Iterations:100);db.Configure(settings);
        var key=Guid.NewGuid().ToString();var id=Buy(2,key);Payment(id,false);Drain();
        db.StartRun(3,settings);Drain();
        db.Heartbeat("online",0,0);db.Heartbeat("offline",0,0);
        using(var c=db.Source.OpenConnection()) Store.Exec(c,"UPDATE workers SET seen_at=clock_timestamp()-interval '8 days' WHERE id='offline'");
        var stock=Stock();var eventCount=db.Read("SELECT * FROM events").Count;
        var result=db.ClearHistory("APAGAR HISTORICO");
        Assert.Equal(4,result.Orders);Assert.Equal(1,result.Benchmarks);Assert.Equal(eventCount,result.Events);Assert.Equal(1,result.OfflineWorkers);
        foreach(var table in new[]{"orders","order_items","events","runs"}) Assert.Empty(db.Read($"SELECT * FROM {table}"));
        Assert.Equal(stock,Stock());Assert.Equal(settings,db.GetSettings());Assert.Equal(2,db.Read("SELECT * FROM products").Count);
        Assert.Equal("online",Assert.Single(db.Read("SELECT id FROM workers"))["id"]);Assert.Null(db.Order(id));
        Assert.Equal(409,Assert.Throws<BusinessException>(()=>Buy(2,key)).Status);
        Assert.Equal(409,Assert.Throws<BusinessException>(()=>Buy(1,key)).Status);
        Assert.Equal(stock,Stock());Assert.Empty(db.Read("SELECT * FROM orders"));
        Buy();Assert.Single(db.Read("SELECT * FROM orders"));
    }
    static async Task Until(Func<bool> condition)
    {
        var timeout=DateTime.UtcNow.AddSeconds(15);
        while(!condition())
        {
            if(DateTime.UtcNow>timeout) throw new TimeoutException("Workers não convergiram para os limites esperados.");
            await Task.Delay(50);
        }
    }

}
