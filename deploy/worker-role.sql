-- Executar como proprietário do schema após a inicialização da API.
-- Crie minishop_worker e configure a senha fora deste arquivo (\password no psql).
CREATE ROLE minishop_worker LOGIN;
GRANT CONNECT ON DATABASE minishop TO minishop_worker;
GRANT USAGE ON SCHEMA public TO minishop_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO minishop_worker;
GRANT UPDATE ON products, orders, runs TO minishop_worker;
GRANT INSERT, UPDATE ON workers TO minishop_worker;
GRANT INSERT ON events TO minishop_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO minishop_worker;
