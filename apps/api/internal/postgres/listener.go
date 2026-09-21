package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ListenerConn is the dedicated session-capable connection reserved for the
// future PostgreSQL LISTEN/NOTIFY adapter. GO-02 provides lifecycle and
// connection validation only; it does not register channels or fan out events.
type ListenerConn struct {
	conn *pgx.Conn
}

// ConnectListener opens and validates one dedicated PostgreSQL session.
func ConnectListener(ctx context.Context, databaseURL string) (*ListenerConn, error) {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid PostgreSQL listener configuration")
	}
	config.ConnectTimeout = ConnectTimeout
	config.RuntimeParams["statement_timeout"] = CommandTimeout.String()

	connectCtx, cancel := context.WithTimeout(ctx, ConnectTimeout)
	defer cancel()
	conn, err := pgx.ConnectConfig(connectCtx, config)
	if err != nil {
		return nil, errors.New("PostgreSQL listener connection failed")
	}
	if err := conn.Ping(connectCtx); err != nil {
		_ = conn.Close(context.Background())
		return nil, errors.New("PostgreSQL listener is unavailable")
	}
	return &ListenerConn{conn: conn}, nil
}

// Close releases the dedicated listener connection. The connection does not
// expose pgx types to callers outside this infrastructure package.
func (l *ListenerConn) Close(ctx context.Context) error {
	if l == nil || l.conn == nil {
		return nil
	}
	closeCtx, cancel := context.WithTimeout(ctx, TransactionCleanupTimeout)
	defer cancel()
	return l.conn.Close(closeCtx)
}
