using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MiniShop.Core;
namespace MiniShop.Web.Pages;
[EnableRateLimiting("checkout")]
public class IndexModel(IHttpClientFactory f,IConfiguration c):ApiPage(f,c)
{
    public Task<IActionResult> OnGetProductsAsync()=>Forward(HttpMethod.Get,"/api/products");
    public Task<IActionResult> OnPostCheckoutAsync([FromBody]Purchase purchase)=>Forward(HttpMethod.Post,"/api/orders",purchase,key:Request.Headers["Idempotency-Key"].ToString());
    public Task<IActionResult> OnGetOrderAsync(Guid id)=>Forward(HttpMethod.Get,$"/api/orders/{id}");
}
