using Microsoft.AspNetCore.Authentication.Cookies;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
if(args.Contains("--healthcheck"))
{
    try { using var c=new HttpClient {Timeout=TimeSpan.FromSeconds(3)}; var response=await c.GetAsync("http://127.0.0.1:8080/health"); return response.IsSuccessStatusCode?0:1; }
    catch { return 1; }
}
var builder=WebApplication.CreateBuilder(args);
foreach(var key in new[]{"ApiBaseUrl","ServiceKey","AdminKey","AdminPassword"})
    if(string.IsNullOrWhiteSpace(builder.Configuration[key])) throw new InvalidOperationException($"Defina {key}.");
if(builder.Configuration["AdminPassword"]!.Length<16) throw new InvalidOperationException("AdminPassword deve ter 16+ caracteres.");
builder.Services.AddRazorPages();
builder.Services.AddAntiforgery(o=>o.HeaderName="X-CSRF-TOKEN");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o=> { o.LoginPath="/Login"; o.ExpireTimeSpan=TimeSpan.FromHours(2); o.Cookie.HttpOnly=true; o.Cookie.SameSite=SameSiteMode.Strict; o.Cookie.SecurePolicy=builder.Environment.IsDevelopment()?CookieSecurePolicy.SameAsRequest:CookieSecurePolicy.Always; });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o=> {
    o.RejectionStatusCode=429;
    o.AddFixedWindowLimiter("login",x=> { x.PermitLimit=10; x.Window=TimeSpan.FromMinutes(1); x.QueueLimit=0; });
    o.AddFixedWindowLimiter("checkout",x=> { x.PermitLimit=300; x.Window=TimeSpan.FromMinutes(1); x.QueueLimit=0; });
});
builder.Services.AddHttpClient("api",c=> { c.BaseAddress=new Uri(builder.Configuration["ApiBaseUrl"]!); c.Timeout=TimeSpan.FromSeconds(30); c.DefaultRequestHeaders.Add("X-Service-Key",builder.Configuration["ServiceKey"]); });
var app=builder.Build();
app.Use(async(c,next)=> { c.Response.Headers["X-Content-Type-Options"]="nosniff"; c.Response.Headers["Content-Security-Policy"]="default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"; await next(); });
app.UseStaticFiles(); app.UseRouting(); app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
app.MapGet("/health",()=>Results.Ok(new {status="ok"}));
app.MapRazorPages(); app.Run();
return 0;
