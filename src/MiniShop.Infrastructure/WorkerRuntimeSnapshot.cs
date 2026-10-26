using MiniShop.Core;
namespace MiniShop.Infrastructure;

// Snapshot observado pelo processo; não é apenas a seleção feita no navegador.
public sealed record WorkerRuntimeSnapshot(Settings Configuration, int ProcessingThreads, string State,
    int CpuActive, int MaxCpuActive, double? CpuPercentOneCore);
internal sealed record WorkerExecution(Settings Configuration, int ProcessingThreads, string State);
internal readonly record struct ClaimResult(Job? Job, bool MadeProgress);
