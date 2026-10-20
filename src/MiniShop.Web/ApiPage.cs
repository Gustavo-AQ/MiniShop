using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
namespace MiniShop.Web;
public class ApiPage(IHttpClientFactory factory,IConfiguration config) : PageModel
{
    protected async Task<IActionResult> Forward(HttpMethod method,string path,object? body=null,bool admin=false,string? key=null)
    {
        using var client=factory.CreateClient("api");
        if(!admin) client.Timeout=TimeSpan.FromSeconds(4);
        using var req=new HttpRequestMessage(method,path);
        if(body!=null) req.Content=JsonContent.Create(body);
        if(admin) req.Headers.Add("X-Admin-Key",config["AdminKey"]);
        if(key!=null) req.Headers.Add("Idempotency-Key",key);
        try {
            using var response=await client.SendAsync(req,HttpContext.RequestAborted);
            return new ContentResult { StatusCode=(int)response.StatusCode,ContentType="application/json",Content=await response.Content.ReadAsStringAsync() };
        }
        catch(Exception e) when(e is HttpRequestException or TaskCanceledException) {
            return new JsonResult(new {message="Serviço de pedidos indisponível. A loja continua disponível; tente novamente em instantes."}) {StatusCode=503};
        }
    }
}
