using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace MiniShop.Web.Pages;

[Authorize]
public sealed class PresentationModel : PageModel
{
    // A aula funciona sem consultar a API; todos os experimentos desta página são didáticos.
    public void OnGet() { }
}
