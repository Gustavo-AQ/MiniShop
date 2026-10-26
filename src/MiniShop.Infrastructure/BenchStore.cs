using System.Text.Json;
using MiniShop.Core;
namespace MiniShop.Infrastructure;
public sealed partial class Store
{
    public Guid StartRun(int count,Settings settings,int seed=42)
    {
        settings.Validate();
        if(count is <1 or >5000 || settings.DelayMs!=0) throw new BusinessException(400,"Benchmark: 1–5.000 pedidos e atraso artificial desligado.");
        using var c=Source.OpenConnection(); using var tx=c.BeginTransaction(); Admission(c); RequireIdle(c);
        SaveConfig(c,settings); Exec(c,"UPDATE products SET stock=@s",("s",count*3));
        var id=Guid.NewGuid();
        Exec(c,"INSERT INTO runs(id,settings,count,seed) VALUES(@id,CAST(@s AS jsonb),@n,@seed)",("id",id),("s",JsonSerializer.Serialize(settings)),("n",count),("seed",seed));
        for(int i=0;i<count;i++)
            Insert(c,Guid.NewGuid(),$"run:{id}:{i}",$"dataset-v1:{seed}:{i}",Workload.Generate(i,seed),settings,i,Workload.Hash(i,seed+2)%20==0,id);
        // Cronômetro do lote exclui geração/inserção. PostgreSQL publica toda a fila no commit.
        Exec(c,"UPDATE runs SET started_at=clock_timestamp() WHERE id=@id",("id",id));
        Exec(c,"UPDATE orders SET created_at=(SELECT started_at FROM runs WHERE id=@id) WHERE run_id=@id",("id",id));
        tx.Commit(); return id;
    }
    public void RefreshRuns()
    {
        using var c=Source.OpenConnection();
        Exec(c,"""
            UPDATE runs r SET finished_at=x.last_finish,result=jsonb_build_object(
              'total',r.count,'approved',x.approved,'rejected',x.rejected,
              'errors',(SELECT count(*) FROM events e JOIN orders o ON o.id=e.order_id WHERE o.run_id=r.id AND e.kind='ERRO'),
              'actual_workers',(SELECT count(DISTINCT worker) FROM orders WHERE run_id=r.id),
              'thread_ids',(SELECT jsonb_agg(DISTINCT thread_id) FROM orders WHERE run_id=r.id),
              'elapsed_ms',EXTRACT(EPOCH FROM (x.last_finish-r.started_at))*1000,
              'throughput',r.count/NULLIF(EXTRACT(EPOCH FROM (x.last_finish-r.started_at)),0),
              'mean_service_ms',x.mean_service,'min_service_ms',x.min_service,'max_service_ms',x.max_service,
              'mean_latency_ms',x.mean_latency,'p95_latency_ms',x.p95,'attempts',x.attempts,
              'final_stock',(SELECT jsonb_agg(jsonb_build_object('id',id,'stock',stock) ORDER BY id) FROM products),
              'environment',(SELECT COALESCE(jsonb_agg(to_jsonb(w)),'[]') FROM workers w WHERE seen_at>clock_timestamp()-interval '10 seconds'))
            FROM (SELECT run_id,count(*) FILTER(WHERE status='APROVADO') approved,
              count(*) FILTER(WHERE status='RECUSADO') rejected,count(*) FILTER(WHERE finished_at IS NULL) pending,
              max(finished_at) last_finish,avg(service_ms) mean_service,min(service_ms) min_service,max(service_ms) max_service,
              avg(EXTRACT(EPOCH FROM (finished_at-created_at))*1000) mean_latency,
              percentile_cont(0.95) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(finished_at-created_at))*1000) p95,
              sum(attempts) attempts FROM orders WHERE run_id IN(
                SELECT r.id FROM runs r WHERE r.finished_at IS NULL
                AND NOT EXISTS(SELECT 1 FROM orders pending WHERE pending.run_id=r.id AND pending.finished_at IS NULL)
              ) GROUP BY run_id) x
            WHERE r.id=x.run_id AND r.finished_at IS NULL AND x.pending=0 AND x.approved+x.rejected=r.count
            """);
    }
    public object Metrics()
    {
        RefreshRuns();
        return new {
            settings=GetSettings(),
            counts=Read("SELECT status,count(*) count FROM orders GROUP BY status"),
            queue=Read("SELECT count(*) pending FROM orders WHERE status='PENDENTE'"),
            workers=Read("SELECT *,seen_at>clock_timestamp()-interval '5 seconds' AND execution_state IS DISTINCT FROM 'stopped' alive FROM workers ORDER BY id"),
            products=Read("SELECT * FROM products ORDER BY id"),
            orders=Read("SELECT id,status,total,reason,worker,attempts,created_at FROM orders ORDER BY created_at DESC LIMIT 60"),
            events=Read("SELECT * FROM events ORDER BY id DESC LIMIT 40"),
            runs=Read("SELECT r.*, CASE WHEN r.finished_at IS NOT NULL THEN r.count ELSE (SELECT count(*) FROM orders o WHERE o.run_id=r.id AND o.finished_at IS NOT NULL) END completed FROM runs r ORDER BY started_at DESC LIMIT 1000")
        };
    }
    public void Heartbeat(string id,int active,int maxActive,WorkerRuntimeSnapshot? runtime=null)
    {
        using var p=System.Diagnostics.Process.GetCurrentProcess(); using var c=Source.OpenConnection();
        Exec(c,"""
            INSERT INTO workers(id,host,pid,seen_at,active,max_active,cpu_seconds,memory_bytes,processors,
                execution_mode,execution_state,processing_threads,configured_threads,configured_workers,
                cpu_active,max_cpu_active,os_threads,cpu_percent_one_core)
            VALUES(@id,@host,@pid,clock_timestamp(),@a,@max,@cpu,@mem,@cores,
                CAST(@mode AS text),CAST(@state AS text),CAST(@lanes AS int),CAST(@threads AS int),CAST(@workers AS int),
                CAST(@cpu_active AS int),CAST(@cpu_peak AS int),@os_threads,CAST(@cpu_percent AS double precision))
            ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at,active=excluded.active,max_active=excluded.max_active,
                cpu_seconds=excluded.cpu_seconds,memory_bytes=excluded.memory_bytes,
                execution_mode=excluded.execution_mode,execution_state=excluded.execution_state,
                processing_threads=excluded.processing_threads,configured_threads=excluded.configured_threads,
                configured_workers=excluded.configured_workers,cpu_active=excluded.cpu_active,
                max_cpu_active=excluded.max_cpu_active,os_threads=excluded.os_threads,cpu_percent_one_core=excluded.cpu_percent_one_core
            """,("id",id),("host",Environment.MachineName),("pid",Environment.ProcessId),("a",active),("max",maxActive),
            ("cpu",p.TotalProcessorTime.TotalSeconds),("mem",p.WorkingSet64),("cores",Environment.ProcessorCount),
            ("mode",runtime?.Configuration.Mode),("state",runtime?.State),("lanes",runtime?.ProcessingThreads),
            ("threads",runtime?.Configuration.Threads),("workers",runtime?.Configuration.Workers),
            ("cpu_active",runtime?.CpuActive),("cpu_peak",runtime?.MaxCpuActive),("os_threads",p.Threads.Count),
            ("cpu_percent",runtime?.CpuPercentOneCore));
    }
}
