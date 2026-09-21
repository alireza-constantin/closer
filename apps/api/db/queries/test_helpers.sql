-- Infrastructure-only query used by the test-database guard and transaction
-- smoke tests. Domain query files belong to their owning tickets.

-- name: CurrentDatabase :one
SELECT current_database()::text;

-- name: SetLocalTestValue :one
SELECT set_config('closer.go02_test_value', sqlc.arg(value)::text, true)::text;

-- name: GetLocalTestValue :one
SELECT COALESCE(current_setting('closer.go02_test_value', true), '')::text;
