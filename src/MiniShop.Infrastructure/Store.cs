using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MiniShop.Core;
using Npgsql;
namespace MiniShop.Infrastructure;
public sealed partial class Store : IDisposable
{
    public NpgsqlDataSource Source { get; }
    public Store(string connection) => Source = NpgsqlDataSource.Create(connection);
    public void Dispose() => Source.Dispose();
    public static Store FromEnvironment() => new(Environment.GetEnvironmentVariable("ConnectionStrings__Shop") ?? throw new InvalidOperationException("Defina ConnectionStrings__Shop."));
    public void Initialize()
    {
        using var c = Source.OpenConnection(); using var tx = c.BeginTransaction();
        Exec(c, "SELECT pg_advisory_xact_lock(7000)");
        using var stream = typeof(Store).Assembly.GetManifestResourceStream("MiniShop.Infrastructure.schema.sql")!;
        Exec(c, new StreamReader(stream).ReadToEnd()); tx.Commit();
    }
    public static NpgsqlCommand Command(NpgsqlConnection c, string sql, params (string, object?)[] args)
    {
        var cmd = new NpgsqlCommand(sql, c) { CommandTimeout = 30 };
        foreach (var (k,v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return cmd;
    }
    public static int Exec(NpgsqlConnection c, string sql, params (string, object?)[] args) { using var cmd=Command(c,sql,args); return cmd.ExecuteNonQuery(); }
    public static T Scalar<T>(NpgsqlConnection c, string sql, params (string, object?)[] args) { using var cmd=Command(c,sql,args); return (T)cmd.ExecuteScalar()!; }
    public static List<Dictionary<string,object?>> Query(NpgsqlConnection c, string sql, params (string, object?)[] args)
    {
        using var cmd=Command(c,sql,args); using var rd=cmd.ExecuteReader(); var rows=new List<Dictionary<string,object?>>();
        while(rd.Read()) { var row=new Dictionary<string,object?>(); for(int i=0;i<rd.FieldCount;i++) row[rd.GetName(i)]=rd.IsDBNull(i)?null:rd.GetValue(i); rows.Add(row); } return rows;
    }
    public List<Dictionary<string,object?>> Read(string sql, params (string,object?)[] args) { using var c=Source.OpenConnection(); return Query(c,sql,args); }
    public Settings GetSettings() { using var c=Source.OpenConnection(); return Config(c); }
    static Settings Config(NpgsqlConnection c)
    {
        using var cmd=Command(c,"SELECT mode,threads,workers,iterations,delay_ms,queue_limit FROM settings WHERE id=1"); using var r=cmd.ExecuteReader(); r.Read();
        return new(r.GetString(0),r.GetInt32(1),r.GetInt32(2),r.GetInt32(3),r.GetInt32(4),r.GetInt32(5));
    }
    static void Admission(NpgsqlConnection c) => Exec(c,"SELECT pg_advisory_xact_lock(7001)");
    static void RequireIdle(NpgsqlConnection c)
    {
        if(Scalar<long>(c,"SELECT count(*) FROM orders WHERE status IN('PENDENTE','PROCESSANDO')")!=0 ||
           Scalar<long>(c,"SELECT count(*) FROM runs WHERE finished_at IS NULL")!=0)
            throw new BusinessException(409,"Aguarde a fila e o benchmark terminarem antes de alterar as condições.");
    }
    static void SaveConfig(NpgsqlConnection c,Settings s) => Exec(c,"UPDATE settings SET mode=@m,threads=@t,workers=@w,iterations=@i,delay_ms=@d,queue_limit=@q WHERE id=1",
        ("m",s.Mode),("t",s.Threads),("w",s.Workers),("i",s.Iterations),("d",s.DelayMs),("q",s.QueueLimit));
    public void Configure(Settings s) { s.Validate(); using var c=Source.OpenConnection(); using var tx=c.BeginTransaction(); Admission(c); RequireIdle(c); SaveConfig(c,s); tx.Commit(); }
    public void ResetStock(int stock)
    {
        if(stock is <0 or >1000000) throw new BusinessException(400,"Estoque deve ficar entre 0 e 1.000.000.");
        using var c=Source.OpenConnection(); using var tx=c.BeginTransaction(); Admission(c); RequireIdle(c); Exec(c,"UPDATE products SET stock=@s",("s",stock)); tx.Commit();
    }
    public Guid Submit(Purchase purchase,string key)
    {
        if(string.IsNullOrWhiteSpace(key)||key.Length>120) throw new BusinessException(400,"Envie Idempotency-Key de até 120 caracteres.");
        var items=Normalize(purchase);
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(items))));
        using var c=Source.OpenConnection(); using var tx=c.BeginTransaction(); Admission(c);
        var old=Query(c,"SELECT id,request_hash FROM orders WHERE idempotency_key=@k",("k",key));
        if(old.Count>0) { if((string)old[0]["request_hash"]! != hash) throw new BusinessException(409,"Chave já usada para outro carrinho."); tx.Commit(); return (Guid)old[0]["id"]!; }
        if(Scalar<long>(c,"SELECT count(*) FROM runs WHERE finished_at IS NULL")>0) throw new BusinessException(503,"Benchmark em execução; tente novamente após a demonstração.");
        var s=Config(c);
        if(Scalar<long>(c,"SELECT count(*) FROM orders WHERE status IN('PENDENTE','PROCESSANDO')")>=s.QueueLimit) throw new BusinessException(503,"Fila cheia. Tente novamente em instantes.");
        var id=Guid.NewGuid(); int seed=BitConverter.ToInt32(id.ToByteArray());
        Insert(c,id,key,hash,items,s,seed,Workload.Hash(seed,11)%20==0,null); tx.Commit(); return id;
    }
    static Item[] Normalize(Purchase p)
    {
        if(p?.Items is null || p.Items.Length is <1 or >2 || p.Items.Any(x=>x.ProductId is <1 or >2 || x.Quantity is <1 or >100) || p.Items.Select(x=>x.ProductId).Distinct().Count()!=p.Items.Length)
            throw new BusinessException(400,"Carrinho inválido: 1–2 produtos distintos, quantidades de 1 a 100.");
        return p.Items.OrderBy(x=>x.ProductId).ToArray();
    }
    static void Insert(NpgsqlConnection c,Guid id,string key,string hash,Item[] items,Settings s,int seed,bool fail,Guid? run)
    {
        decimal total=0; var prices=new Dictionary<int,decimal>();
        foreach(var i in items) { var price=Scalar<decimal>(c,"SELECT price FROM products WHERE id=@id",("id",i.ProductId)); prices[i.ProductId]=price; total+=price*i.Quantity; }
        Exec(c,"""
            INSERT INTO orders(id,idempotency_key,request_hash,total,payment_fails,seed,iterations,delay_ms,run_id)
            VALUES(@id,@key,@hash,@total,@fail,@seed,@iterations,@delay,CAST(@run AS uuid))
            """,("id",id),("key",key),("hash",hash),("total",total),("fail",fail),("seed",seed),("iterations",s.Iterations),("delay",s.DelayMs),("run",run));
        foreach(var i in items) Exec(c,"INSERT INTO order_items VALUES(@id,@p,@q,@price)",("id",id),("p",i.ProductId),("q",i.Quantity),("price",prices[i.ProductId]));
    }
    public object? Order(Guid id)
    {
        var row=Read("SELECT id,customer,status,total,reason,created_at,started_at,finished_at,worker,attempts,digest,service_ms,thread_id FROM orders WHERE id=@id",("id",id)).FirstOrDefault();
        if(row!=null) row["items"]=Read("SELECT product_id,quantity,price FROM order_items WHERE order_id=@id",("id",id)); return row;
    }
    public Job? Claim(string worker,int leaseSeconds=15, Settings? expected=null, int? ownerPid=null, int? ownerLock=null)
    {
        using var c=Source.OpenConnection(); using var tx=c.BeginTransaction();
        Exec(c,"SELECT pg_advisory_xact_lock_shared(7001)");
        var current=Config(c);
        if(expected!=null && current!=expected) { tx.Commit(); return null; }
        if(ownerPid.HasValue && !Scalar<bool>(c,"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=@pid AND objid=CAST(@key AS oid) AND granted)",("pid",ownerPid.Value),("key",ownerLock!.Value))) { tx.Commit(); return null; }
        // Limite global também cobre reconexões/perda da sessão de coordenação.
        Exec(c,"SELECT pg_advisory_xact_lock(7002)");
        int limit=current.Mode=="parallel"?current.Threads:current.Mode=="distributed"?current.Workers:1;
        if(Scalar<long>(c,"SELECT count(*) FROM orders WHERE status='PROCESSANDO' AND lease_until>clock_timestamp()")>=limit) { tx.Commit(); return null; }
        var rows=Query(c,"""
            SELECT id,reserved,seed,payment_fails,iterations,delay_ms,status FROM orders
            WHERE status='PENDENTE' OR (status='PROCESSANDO' AND lease_until<clock_timestamp())
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
            """);
        if(rows.Count==0) { tx.Commit(); return null; }
        var r=rows[0]; var id=(Guid)r["id"]!; var token=Guid.NewGuid();
        bool reserved=(bool)r["reserved"]!;
        if(!reserved)
        {
            var items=Query(c,"SELECT product_id,quantity FROM order_items WHERE order_id=@id ORDER BY product_id",("id",id));
            // Todos os produtos são bloqueados em ordem global; nenhuma reserva parcial é persistida.
            var stocks=Query(c,"SELECT id,stock FROM products WHERE id IN(SELECT product_id FROM order_items WHERE order_id=@id) ORDER BY id FOR UPDATE",("id",id));
            if(items.Any(i => (int)stocks.Single(p=>(int)p["id"]! == (int)i["product_id"]!)["stock"]! < (int)i["quantity"]!))
            {
                Exec(c,"UPDATE orders SET status='RECUSADO',reason='Sem estoque',finished_at=clock_timestamp(),service_ms=0 WHERE id=@id",("id",id));
                Event(c,id,"FINALIZADO",worker,token,"Sem estoque"); tx.Commit(); return null;
            }
            foreach(var i in items) Exec(c,"UPDATE products SET stock=stock-@q WHERE id=@p",("q",i["quantity"]),("p",i["product_id"]));
        }
        Exec(c,"""
            UPDATE orders SET status='PROCESSANDO',reserved=true,token=@token,worker=@w,
            lease_until=clock_timestamp()+make_interval(secs=>@lease),started_at=COALESCE(started_at,clock_timestamp()),attempts=attempts+1 WHERE id=@id
            """,("token",token),("w",worker),("lease",leaseSeconds),("id",id));
        Event(c,id,(string)r["status"]! == "PROCESSANDO"?"RECUPERADO":"RESERVADO",worker,token,null);
        tx.Commit(); return new(id,token,(int)r["seed"]!,(bool)r["payment_fails"]!,(int)r["iterations"]!,(int)r["delay_ms"]!);
    }
    static void Event(NpgsqlConnection c,Guid id,string kind,string worker,Guid token,string? detail) => Exec(c,"INSERT INTO events(order_id,kind,worker,token,detail) VALUES(@id,@kind,@w,@t,CAST(@d AS text))",("id",id),("kind",kind),("w",worker),("t",token),("d",detail));
    public void RecordError(Job job,string worker,string message)
    {
        using var c=Source.OpenConnection(); Event(c,job.Id,"ERRO",worker,job.Token,message[..Math.Min(message.Length,500)]);
    }
    public bool Renew(Job job,int leaseSeconds=15)
    {
        using var c=Source.OpenConnection(); return Exec(c,"UPDATE orders SET lease_until=clock_timestamp()+make_interval(secs=>@s) WHERE id=@id AND token=@t AND status='PROCESSANDO'",("s",leaseSeconds),("id",job.Id),("t",job.Token))==1;
    }
    public bool Complete(Job job,string digest,double ms,int thread)
    {
        using var c=Source.OpenConnection(); using var tx=c.BeginTransaction();
        var rows=Query(c,"SELECT worker,payment_fails FROM orders WHERE id=@id AND token=@t AND status='PROCESSANDO' FOR UPDATE",("id",job.Id),("t",job.Token));
        if(rows.Count==0) { tx.Commit(); return false; }
        bool failed=(bool)rows[0]["payment_fails"]!;
        if(failed) { Query(c,"SELECT id FROM products WHERE id IN(SELECT product_id FROM order_items WHERE order_id=@id) ORDER BY id FOR UPDATE",("id",job.Id)); Exec(c,"""
            UPDATE products p SET stock=p.stock+i.quantity FROM order_items i WHERE i.order_id=@id AND p.id=i.product_id
            """,("id",job.Id)); }
        Exec(c,"""
            UPDATE orders SET status=@status,reason=CAST(@reason AS text),reserved=false,finished_at=clock_timestamp(),lease_until=NULL,
            digest=@digest,service_ms=@ms,thread_id=@thread WHERE id=@id
            """,("status",failed?"RECUSADO":"APROVADO"),("reason",failed?"Pagamento fictício recusado":null),("digest",digest),("ms",ms),("thread",thread),("id",job.Id));
        Event(c,job.Id,"FINALIZADO",(string)rows[0]["worker"]!,job.Token,failed?"Pagamento recusado":"Aprovado"); tx.Commit(); return true;
    }
}
