using System.Security.Cryptography;
using System.Text;
namespace MiniShop.Core;
public record Item(int ProductId, int Quantity);
public record Purchase(Item[] Items);
public record Settings(string Mode = "sequential", int Threads = 1, int Workers = 1,
    int Iterations = 50000, int DelayMs = 0, int QueueLimit = 10000)
{
    public void Validate()
    {
        if (Mode is not ("sequential" or "parallel" or "distributed") ||
            Threads is not (1 or 2 or 4 or 8) || Workers is < 1 or > 3 ||
            Iterations is < 1 or > 5000000 || DelayMs is < 0 or > 3000 || QueueLimit is < 1 or > 50000)
            throw new BusinessException(400, "Configuração fora dos limites permitidos.");
    }
}
public class BusinessException(int status, string message) : Exception(message) { public int Status => status; }
public record Job(Guid Id, Guid Token, int Seed, bool PaymentFails, int Iterations, int DelayMs);
public static class Workload
{
    // CPU real: uma cadeia SHA-256; o digest final é auditável e independente da arquitetura.
    public static string Compute(int seed, int iterations)
    {
        Span<byte> state = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(seed.ToString(System.Globalization.CultureInfo.InvariantCulture)), state);
        for (var i = 0; i < iterations; i++) SHA256.HashData(state, state);
        return Convert.ToHexString(state);
    }
    public static Item[] Generate(int index, int seed = 42) => [new(1 + (int)(Hash(index, seed) % 2), 1 + (int)(Hash(index, seed + 1) % 3))];
    public static uint Hash(int index, int seed) { unchecked { uint x = (uint)(index + seed * 7919); x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; return x ^ (x >> 16); } }
}
