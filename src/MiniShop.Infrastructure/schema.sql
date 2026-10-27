CREATE TABLE IF NOT EXISTS settings (
 id int PRIMARY KEY CHECK(id=1), mode text NOT NULL CHECK(mode IN ('sequential','parallel','distributed')),
 threads int NOT NULL CHECK(threads IN(1,2,4,8)), workers int NOT NULL CHECK(workers BETWEEN 1 AND 3),
 iterations int NOT NULL CHECK(iterations BETWEEN 1 AND 5000000), delay_ms int NOT NULL CHECK(delay_ms BETWEEN 0 AND 3000),
 queue_limit int NOT NULL CHECK(queue_limit BETWEEN 1 AND 50000));
INSERT INTO settings VALUES(1,'sequential',1,1,50000,0,10000) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS products(id int PRIMARY KEY, name text NOT NULL, price numeric(12,2) NOT NULL CHECK(price>0), stock int NOT NULL CHECK(stock>=0));
INSERT INTO products VALUES(1,'Teclado Orbit',149.90,100),(2,'Fone Pulse',89.90,100) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS runs(id uuid PRIMARY KEY, settings jsonb NOT NULL, count int NOT NULL, seed int NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz, result jsonb);
CREATE TABLE IF NOT EXISTS orders(id uuid PRIMARY KEY, idempotency_key text UNIQUE NOT NULL, request_hash text NOT NULL,
 customer text NOT NULL DEFAULT 'Cliente fictício', status text NOT NULL DEFAULT 'PENDENTE' CHECK(status IN('PENDENTE','PROCESSANDO','APROVADO','RECUSADO')),
 total numeric(14,2) NOT NULL CHECK(total>0), reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz, finished_at timestamptz, token uuid, lease_until timestamptz, worker text,
 reserved bool NOT NULL DEFAULT false, payment_fails bool NOT NULL, seed int NOT NULL, iterations int NOT NULL, delay_ms int NOT NULL,
 attempts int NOT NULL DEFAULT 0, digest text, service_ms double precision, thread_id int,
 run_id uuid REFERENCES runs(id), CHECK(status <> 'APROVADO' OR (NOT payment_fails AND digest IS NOT NULL AND NOT reserved)));
CREATE TABLE IF NOT EXISTS order_items(order_id uuid REFERENCES orders(id), product_id int REFERENCES products(id), quantity int NOT NULL CHECK(quantity>0),
 price numeric(12,2) NOT NULL, PRIMARY KEY(order_id,product_id));
CREATE INDEX IF NOT EXISTS queue_idx ON orders(status,lease_until,created_at) WHERE status IN('PENDENTE','PROCESSANDO');
CREATE TABLE IF NOT EXISTS events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid REFERENCES orders(id),
 at timestamptz NOT NULL DEFAULT clock_timestamp(), kind text NOT NULL, worker text, token uuid, detail text);
CREATE UNIQUE INDEX IF NOT EXISTS one_final_event ON events(order_id) WHERE kind='FINALIZADO';
CREATE TABLE IF NOT EXISTS workers(id text PRIMARY KEY, host text NOT NULL, pid int NOT NULL, seen_at timestamptz NOT NULL,
 active int NOT NULL, max_active int NOT NULL, cpu_seconds double precision NOT NULL, memory_bytes bigint NOT NULL, processors int NOT NULL);

CREATE INDEX IF NOT EXISTS orders_run_idx ON orders(run_id);
CREATE INDEX IF NOT EXISTS orders_recent_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS queue_order_idx ON orders(created_at,id) WHERE status IN('PENDENTE','PROCESSANDO');

-- Migração aditiva: snapshots de workers antigos continuam legíveis durante o deployment.
ALTER TABLE workers ADD COLUMN IF NOT EXISTS execution_mode text;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS execution_state text;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS processing_threads int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS configured_threads int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS configured_workers int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS cpu_active int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS max_cpu_active int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS os_threads int;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS cpu_percent_one_core double precision;
CREATE INDEX IF NOT EXISTS unfinished_run_idx ON orders(run_id) WHERE finished_at IS NULL;

-- Mantém a proteção contra reenvios após apagar o histórico visível.
CREATE TABLE IF NOT EXISTS retired_order_keys(key_hash bytea PRIMARY KEY);
