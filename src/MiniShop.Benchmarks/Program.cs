using System.Globalization;
using System.Text.Json;
using MiniShop.Core;
using MiniShop.Infrastructure;
using var store=Store.FromEnvironment(); store.Initialize();
var count=args.Length>0?int.Parse(args[0]):5000;
var repeats=args.Length>1?int.Parse(args[1]):3;
var output=args.Length>2?args[2]:"results";
if(repeats is <1 or >10) throw new ArgumentException("Repetições: 1–10.");
int iterations=int.Parse(Environment.GetEnvironmentVariable("BENCH_ITERATIONS")??"50000");
Directory.CreateDirectory(output);
var scenarios=new[]{new Settings(Iterations:iterations),new Settings("parallel",2,Iterations:iterations),new Settings("parallel",4,Iterations:iterations),new Settings("parallel",8,Iterations:iterations),new Settings("distributed",Workers:1,Iterations:iterations),new Settings("distributed",Workers:2,Iterations:iterations),new Settings("distributed",Workers:3,Iterations:iterations)};
var all=new List<object>();var aggregates=new List<(string name,double mean)>();
var csv=new List<string>{"mode,threads,workers,repetition,count,approved,rejected,errors,elapsed_ms,throughput,mean_service_ms,min_service_ms,max_service_ms,mean_latency_ms,p95_latency_ms,run_id,date_utc"};
foreach(var s in scenarios)
{
    var times=new List<double>();
    for(int repetition=1;repetition<=repeats;repetition++)
    {
        var id=store.StartRun(count,s);Console.WriteLine($"{s.Mode} threads={s.Threads} workers={s.Workers} repetição={repetition} lote={id}");
        var timeout=DateTime.UtcNow.AddMinutes(30);Dictionary<string,object?> run;
        while(true) {
            store.RefreshRuns();run=store.Read("SELECT * FROM runs WHERE id=@id",("id",id)).Single();
            if(run["finished_at"]!=null)break;
            if(DateTime.UtcNow>timeout)throw new TimeoutException("Lote preservado no banco. Verifique workers, conexão e capacidade.");
            Thread.Sleep(250);
        }
        var json=(string)run["result"]!;var x=JsonDocument.Parse(json).RootElement;times.Add(x.GetProperty("elapsed_ms").GetDouble());all.Add(run);
        var fields=new[]{s.Mode,s.Threads.ToString(),s.Workers.ToString(),repetition.ToString(),count.ToString(),x.GetProperty("approved").ToString(),x.GetProperty("rejected").ToString(),x.GetProperty("errors").ToString()}
            .Concat(new[]{"elapsed_ms","throughput","mean_service_ms","min_service_ms","max_service_ms","mean_latency_ms","p95_latency_ms"}.Select(k=>x.GetProperty(k).ToString())).Concat([id.ToString(),((DateTime)run["started_at"]!).ToString("O")]);
        csv.Add(string.Join(",",fields));
        File.WriteAllText(Path.Combine(output,$"{id}.orders.json"),JsonSerializer.Serialize(store.Read("SELECT o.*, (SELECT jsonb_agg(to_jsonb(i)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE run_id=@id ORDER BY seed",("id",id)),new JsonSerializerOptions{WriteIndented=true}));
        File.WriteAllLines(Path.Combine(output,"runs.csv"),csv);File.WriteAllText(Path.Combine(output,"runs.json"),JsonSerializer.Serialize(all,new JsonSerializerOptions{WriteIndented=true}));
        Console.WriteLine(json);
    }
    aggregates.Add(($"{s.Mode}-{(s.Mode=="distributed"?s.Workers:s.Threads)}",times.Average()));
}
var baseline=aggregates[0].mean;
File.WriteAllLines(Path.Combine(output,"averages.csv"),new[]{"scenario,mean_ms,speedup"}.Concat(aggregates.Select(a=>$"{a.name},{a.mean.ToString(CultureInfo.InvariantCulture)},{(baseline/a.mean).ToString(CultureInfo.InvariantCulture)}")));
Console.WriteLine($"Resultados gravados em {Path.GetFullPath(output)}");
