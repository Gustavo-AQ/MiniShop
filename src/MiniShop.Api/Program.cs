using System.Security.Cryptography;
using System.Text;
using MiniShop.Core;
using MiniShop.Infrastructure;
if(args.Contains("--healthcheck"))
{
    try { using var c=new HttpClient {Timeout=TimeSpan.FromSeconds(3)}; var response=await c.GetAsync("http://127.0.0.1:8080/api/health"); return response.IsSuccessStatusCode?0:1; }
    catch { return 1; }
}
var builder=WebApplication.CreateBuilder(args);
var admin=builder.Configuration["AdminKey"]??throw new InvalidOperationException("Defina AdminKey (32+ caracteres).");
var service=builder.Configuration["ServiceKey"]??throw new InvalidOperationException("Defina ServiceKey (32+ caracteres).");
if(admin.Length<32||service.Length<32||admin==service) throw new InvalidOperationException("Use duas chaves diferentes de pelo menos 32 caracteres.");
builder.Services.AddSingleton(Store.FromEnvironment()); builder.Services.AddOpenApi();
var app=builder.Build(); app.Services.GetRequiredService<Store>().Initialize();
bool Key(HttpContext c,string header,string expected) => CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(c.Request.Headers[header].ToString())),SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
app.Use(async(c,next)=>
{
    if(c.Request.Path!="/api/health" && !Key(c,"X-Service-Key",service)) { c.Response.StatusCode=401; await c.Response.WriteAsJsonAsync(new {message="Acesso privado: chave de serviço necessária."}); return; }
    if(c.Request.Path.StartsWithSegments("/api/admin") && !Key(c,"X-Admin-Key",admin)) { c.Response.StatusCode=401; await c.Response.WriteAsJsonAsync(new {message="Autenticação administrativa necessária."}); return; }
    try { await next(); }
    catch(BusinessException e) { c.Response.StatusCode=e.Status; if(e.Status==503)c.Response.Headers.RetryAfter="3"; await c.Response.WriteAsJsonAsync(new {message=e.Message}); }
    catch(Exception e) when(e is Npgsql.NpgsqlException or TimeoutException) { app.Logger.LogError(e,"Banco indisponível"); c.Response.StatusCode=503; await c.Response.WriteAsJsonAsync(new {message="Serviço temporariamente indisponível."}); }
});
if(app.Environment.IsDevelopment()) app.MapOpenApi();
app.MapGet("/api/health",(Store db)=> { db.Read("SELECT 1"); return Results.Ok(new {status="ok"}); });
app.MapGet("/api/products",(Store db)=>db.Read("SELECT * FROM products ORDER BY id"));
app.MapPost("/api/orders",(Purchase p,HttpContext c,Store db)=> { var id=db.Submit(p,c.Request.Headers["Idempotency-Key"].ToString()); return Results.Accepted($"/api/orders/{id}",new {id}); });
app.MapGet("/api/orders/{id:guid}",(Guid id,Store db)=>db.Order(id) is {} order?Results.Ok(order):Results.NotFound(new {message="Pedido inexistente."}));
app.MapGet("/api/admin/metrics",(Store db)=>db.Metrics());
app.MapPost("/api/admin/history/clear",(HistoryClear r,Store db)=>Results.Ok(db.ClearHistory(r.Confirmation)));
app.MapPut("/api/admin/settings",(Settings s,Store db)=> { db.Configure(s); return Results.Ok(s); });
app.MapPost("/api/admin/stock/reset",(StockReset r,Store db)=> { db.ResetStock(r.Stock); return Results.Ok(new {message="Estoque atualizado."}); });
app.MapPost("/api/admin/tests/start",(TestStart r,Store db)=> { var id=db.StartRun(r.Count,r.Settings,r.Seed); return Results.Accepted($"/api/admin/tests/{id}",new {id}); });
app.MapGet("/api/admin/tests/{id:guid}",(Guid id,Store db)=> { db.RefreshRuns(); var run=db.Read("SELECT * FROM runs WHERE id=@id",("id",id)).FirstOrDefault(); return run is null?Results.NotFound():Results.Ok(run); });
app.MapGet("/api/admin/tests/{id:guid}/orders",(Guid id,Store db)=>db.Read("SELECT o.*, (SELECT jsonb_agg(to_jsonb(i)) FROM order_items i WHERE i.order_id=o.id) items FROM orders o WHERE run_id=@id ORDER BY seed",("id",id)));
app.Run();
return 0;
record StockReset(int Stock);
record HistoryClear(string? Confirmation);
record TestStart(int Count,Settings Settings,int Seed=42);
