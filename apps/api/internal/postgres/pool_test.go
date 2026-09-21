package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestParsePoolConfigAppliesConservativeLimits(t *testing.T) {
	config, err := parsePoolConfig("postgres://closer:secret@localhost:5432/closer_dev?sslmode=disable")
	if err != nil {
		t.Fatalf("parsePoolConfig() error = %v", err)
	}
	if config.MaxConns != MaxConnections || config.MinConns != MinConnections {
		t.Fatalf("pool connection limits = %d/%d, want %d/%d", config.MinConns, config.MaxConns, MinConnections, MaxConnections)
	}
	if config.ConnConfig.ConnectTimeout != ConnectTimeout {
		t.Fatalf("connect timeout = %s, want %s", config.ConnConfig.ConnectTimeout, ConnectTimeout)
	}
	if config.ConnConfig.RuntimeParams["statement_timeout"] != CommandTimeout.String() {
		t.Fatalf("statement timeout = %q, want %q", config.ConnConfig.RuntimeParams["statement_timeout"], CommandTimeout.String())
	}
	if AcquireTimeout != 5*time.Second {
		t.Fatalf("acquire timeout = %s, want 5s", AcquireTimeout)
	}
	if CommandTimeout != 10*time.Second {
		t.Fatalf("command timeout = %s, want 10s", CommandTimeout)
	}
}

func TestParsePoolConfigRejectsInvalidURLWithoutEchoingSecret(t *testing.T) {
	_, err := parsePoolConfig("postgres://closer:never-log-this@[invalid")
	if err == nil {
		t.Fatal("parsePoolConfig() succeeded for malformed URL")
	}
	if strings.Contains(err.Error(), "never-log-this") {
		t.Fatalf("parsePoolConfig() leaked URL secret: %v", err)
	}
}

func TestNewPoolRespectsCanceledStartupContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pool, err := NewPool(ctx, "postgres://tester:secret@127.0.0.1:5432/closer_test?sslmode=disable")
	if pool != nil {
		pool.Close()
		t.Fatal("NewPool() returned a pool for a canceled startup context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("NewPool() error = %v, want context.Canceled", err)
	}
}

func TestClassifyErrorRecognizesPostgreSQLConstraintAndConcurrencyCodes(t *testing.T) {
	tests := []struct {
		code string
		want ErrorKind
	}{
		{code: "23505", want: ErrorUniqueViolation},
		{code: "23503", want: ErrorForeignKeyViolation},
		{code: "23514", want: ErrorCheckViolation},
		{code: "40001", want: ErrorSerializationFailure},
		{code: "40P01", want: ErrorDeadlockDetected},
		{code: "57014", want: ErrorUnknown},
	}
	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			got := ClassifyError(&pgconn.PgError{Code: test.code})
			if got != test.want {
				t.Fatalf("ClassifyError() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestClassifyErrorHandlesNonPostgreSQLErrors(t *testing.T) {
	if got := ClassifyError(nil); got != ErrorUnknown {
		t.Fatalf("ClassifyError(nil) = %q, want %q", got, ErrorUnknown)
	}
}
