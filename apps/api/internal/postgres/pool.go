package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxConnections            int32 = 10
	MinConnections            int32 = 0
	AcquireTimeout                  = 5 * time.Second
	ConnectTimeout                  = 5 * time.Second
	CommandTimeout                  = 10 * time.Second
	TransactionCleanupTimeout       = 5 * time.Second
)

// Pool owns the application query pool. It deliberately exposes only health,
// transaction, and lifecycle operations. Only concrete postgres adapters
// should consume QueryDB and bind sqlc queries inside their consumer-owned
// ports.
type Pool struct {
	pool *pgxpool.Pool
}

// NewPool validates the connection configuration, creates a bounded pool, and
// verifies database readiness before returning. Connection strings are never
// included in returned errors.
func NewPool(ctx context.Context, databaseURL string) (*Pool, error) {
	poolConfig, err := parsePoolConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	// pgxpool uses this context for pool-lifetime maintenance goroutines. Keep
	// those goroutines independent of the startup context, which is canceled
	// after initialization; Ping below remains bounded by the caller context.
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, errors.New("PostgreSQL pool initialization failed")
	}

	result := &Pool{pool: pool}
	if err := result.Ping(ctx); err != nil {
		pool.Close()
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, errors.New("PostgreSQL is unavailable")
	}
	return result, nil
}

func parsePoolConfig(databaseURL string) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid PostgreSQL configuration")
	}
	config.MaxConns = MaxConnections
	config.MinConns = MinConnections
	config.ConnConfig.ConnectTimeout = ConnectTimeout
	config.ConnConfig.RuntimeParams["statement_timeout"] = CommandTimeout.String()
	return config, nil
}

// Ping reports whether the pool can acquire a connection and execute a
// PostgreSQL round trip. It returns the underlying error to trusted callers;
// the HTTP readiness adapter intentionally discards it.
func (p *Pool) Ping(ctx context.Context) error {
	if p == nil || p.pool == nil {
		return errors.New("PostgreSQL pool is closed")
	}
	acquireCtx, cancel := context.WithTimeout(ctx, AcquireTimeout)
	defer cancel()
	return p.pool.Ping(acquireCtx)
}

// WithConnection checks out one ordinary pool connection for a read/query
// operation. Concrete Postgres adapters bind generated sqlc queries inside
// this callback; the connection is returned to the pool on every exit path.
func (p *Pool) WithConnection(ctx context.Context, callback func(QueryDB) error) error {
	if p == nil || p.pool == nil {
		return errors.New("PostgreSQL pool is closed")
	}
	if callback == nil {
		return errors.New("query callback is required")
	}

	acquireCtx, cancel := context.WithTimeout(ctx, AcquireTimeout)
	connection, err := p.pool.Acquire(acquireCtx)
	cancel()
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		return fmt.Errorf("acquire PostgreSQL connection: %w", err)
	}
	defer connection.Release()
	return callback(connection)
}

// WithinTx runs callback with a transaction-bound SQL executor. Concrete
// postgres adapters should bind generated sqlc queries to it internally; do
// not pass the executor into a feature service or HTTP handler. The transaction
// rolls back on callback failure or cancellation and commits only after
// success.
func (p *Pool) WithinTx(ctx context.Context, callback func(QueryDB) error) error {
	if p == nil || p.pool == nil {
		return errors.New("PostgreSQL pool is closed")
	}
	if callback == nil {
		return errors.New("transaction callback is required")
	}

	beginCtx, cancelBegin := context.WithTimeout(ctx, AcquireTimeout)
	tx, err := p.pool.BeginTx(beginCtx, pgx.TxOptions{})
	cancelBegin()
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		return fmt.Errorf("begin PostgreSQL transaction: %w", err)
	}

	committed := false
	defer func() {
		if committed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), TransactionCleanupTimeout)
		defer cancel()
		_ = tx.Rollback(cleanupCtx)
	}()

	if err := callback(txQueryDB{tx: tx}); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit PostgreSQL transaction: %w", err)
	}
	committed = true
	return nil
}

// Close waits for checked-out connections to return and closes the pool.
func (p *Pool) Close() {
	if p != nil && p.pool != nil {
		p.pool.Close()
	}
}
