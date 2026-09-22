package postgres

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
)

const RealtimeChannel = "closer_realtime"

type RealtimePublisher struct{ pool *Pool }

func NewRealtimePublisher(pool *Pool) *RealtimePublisher { return &RealtimePublisher{pool: pool} }

// Publish executes NOTIFY in its own transaction, so delivery occurs only once
// that transaction commits. Domain commands that need atomic publication should
// use the same transaction-bound adapter in their application port.
func (p *RealtimePublisher) Publish(ctx context.Context, event realtime.Event) error {
	payload, err := realtime.Encode(event)
	if err != nil {
		return err
	}
	return p.pool.WithinTx(ctx, func(db QueryDB) error {
		_, err := db.Exec(ctx, "SELECT pg_notify($1, $2)", RealtimeChannel, string(payload))
		return err
	})
}

// TransactionalRealtimePublisher binds publication to a caller-owned
// PostgreSQL transaction. NOTIFY is delivered only when that transaction
// commits, and is rolled back with the business mutation otherwise.
type TransactionalRealtimePublisher struct{ db QueryDB }

func NewTransactionalRealtimePublisher(db QueryDB) *TransactionalRealtimePublisher {
	return &TransactionalRealtimePublisher{db: db}
}

func (p *TransactionalRealtimePublisher) Publish(ctx context.Context, event realtime.Event) error {
	payload, err := realtime.Encode(event)
	if err != nil {
		return err
	}
	_, err = p.db.Exec(ctx, "SELECT pg_notify($1, $2)", RealtimeChannel, string(payload))
	return err
}

type RealtimeListener struct {
	databaseURL string
	registry    *realtime.Registry
	logger      *slog.Logger
}

func NewRealtimeListener(databaseURL string, registry *realtime.Registry, logger *slog.Logger) *RealtimeListener {
	if registry == nil {
		registry = realtime.NewRegistry(16)
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &RealtimeListener{databaseURL: databaseURL, registry: registry, logger: logger}
}

func (l *RealtimeListener) Run(ctx context.Context) error {
	if l == nil || l.databaseURL == "" {
		return errors.New("realtime listener configuration is missing")
	}
	backoff := time.Second
	for {
		err := l.listenOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		l.logger.Warn("realtime listener reconnecting", "error", err, "backoff", backoff)
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (l *RealtimeListener) listenOnce(ctx context.Context) error {
	config, err := pgx.ParseConfig(l.databaseURL)
	if err != nil {
		return errors.New("invalid PostgreSQL listener configuration")
	}
	config.ConnectTimeout = ConnectTimeout
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return errors.New("PostgreSQL realtime listener connection failed")
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "LISTEN "+RealtimeChannel); err != nil {
		return err
	}
	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if notification.Channel != RealtimeChannel {
			continue
		}
		event, err := realtime.Decode([]byte(notification.Payload))
		if err == nil {
			l.registry.Publish(event)
		}
	}
}
