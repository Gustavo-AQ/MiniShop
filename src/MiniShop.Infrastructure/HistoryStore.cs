namespace MiniShop.Infrastructure;

public sealed record HistoryClearResult(int Orders, int Benchmarks, int Events, int OfflineWorkers);

public sealed partial class Store
{
    public HistoryClearResult ClearHistory(string? confirmation)
    {
        if (confirmation != "APAGAR HISTORICO")
            throw new MiniShop.Core.BusinessException(400, "Digite APAGAR HISTORICO para confirmar a exclusão definitiva.");

        using var c = Source.OpenConnection();
        using var tx = c.BeginTransaction();
        // Mesmo bloqueio de admissão usado por compras, configuração e benchmarks.
        // Uma nova compra não pode entrar entre a verificação da fila e a exclusão.
        Admission(c);
        RequireIdle(c);
        // Mesma ordem do agregador de benchmarks: runs antes de orders.
        // Evita varrer as FKs para cada pedido ao limpar lotes grandes.
        Exec(c, "LOCK TABLE runs, orders, order_items, events IN ACCESS EXCLUSIVE MODE");
        var orders = Scalar<int>(c, "SELECT count(*)::int FROM orders");
        var runs = Scalar<int>(c, "SELECT count(*)::int FROM runs");
        var events = Scalar<int>(c, "SELECT count(*)::int FROM events");
        // Retém somente hashes das chaves de compras públicas, sem os dados dos pedidos.
        // sha256(bytea) é nativo no PostgreSQL, sem necessidade de extensões.
        Exec(c, """
            INSERT INTO retired_order_keys(key_hash)
            SELECT sha256(convert_to(idempotency_key,'UTF8')) FROM orders WHERE run_id IS NULL
            ON CONFLICT DO NOTHING
            """);
        Exec(c, "TRUNCATE events, order_items, orders, runs");
        var workers = Exec(c, """
            DELETE FROM workers WHERE seen_at<=clock_timestamp()-interval '5 seconds'
            OR execution_state='stopped'
            """);
        tx.Commit();
        return new(orders, runs, events, workers);
    }
}
