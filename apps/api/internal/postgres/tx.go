package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// QueryDB is the minimal query surface used by concrete Postgres adapters to
// construct sqlc.Queries over either a pooled connection or a transaction.
// Domain services and HTTP handlers must depend on consumer-owned ports and
// must not import this type.
type QueryDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

type txQueryDB struct {
	tx pgx.Tx
}

func (db txQueryDB) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return db.tx.Exec(ctx, sql, arguments...)
}

func (db txQueryDB) Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error) {
	return db.tx.Query(ctx, sql, arguments...)
}

func (db txQueryDB) QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row {
	return db.tx.QueryRow(ctx, sql, arguments...)
}
