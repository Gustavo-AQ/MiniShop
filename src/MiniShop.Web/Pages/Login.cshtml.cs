using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.RateLimiting;
namespace MiniShop.Web.Pages;
[EnableRateLimiting("login")]
public class LoginModel(IConfiguration config):PageModel
{
    public string? Error {get;set;}
    public async Task<IActionResult> OnPostAsync(string? password,string? returnUrl=null)
    {
        if(!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(password??"")),SHA256.HashData(Encoding.UTF8.GetBytes(config["AdminPassword"]!)))) { Error="Senha inválida."; return Page(); }
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name,"operador")],CookieAuthenticationDefaults.AuthenticationScheme)));
        return LocalRedirect(!string.IsNullOrWhiteSpace(returnUrl)&&Url.IsLocalUrl(returnUrl)?returnUrl:"/Admin");
    }
}
