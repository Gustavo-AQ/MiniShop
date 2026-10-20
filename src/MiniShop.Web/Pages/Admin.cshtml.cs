using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using MiniShop.Core;
namespace MiniShop.Web.Pages;
[Authorize]
public class AdminModel(IHttpClientFactory f,IConfiguration c):ApiPage(f,c)
{
    public Task<IActionResult> OnGetMetricsAsync()=>Forward(HttpMethod.Get,"/api/admin/metrics",admin:true);
    public Task<IActionResult> OnPostSettingsAsync([FromBody]Settings s)=>Forward(HttpMethod.Put,"/api/admin/settings",s,true);
    public Task<IActionResult> OnPostStockAsync([FromBody]StockRequest s)=>Forward(HttpMethod.Post,"/api/admin/stock/reset",s,true);
    public Task<IActionResult> OnPostTestAsync([FromBody]Test t)=>Forward(HttpMethod.Post,"/api/admin/tests/start",t,true);
    public async Task<IActionResult> OnPostLogoutAsync(){await HttpContext.SignOutAsync();return LocalRedirect("/");}
    public record StockRequest(int Stock);
    public record Test(int Count,Settings Settings,int Seed=42);
}
