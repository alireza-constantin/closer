package postgres

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

type ErrorKind string

const (
	ErrorUnknown              ErrorKind = "unknown"
	ErrorUniqueViolation      ErrorKind = "unique_violation"
	ErrorForeignKeyViolation  ErrorKind = "foreign_key_violation"
	ErrorCheckViolation       ErrorKind = "check_violation"
	ErrorSerializationFailure ErrorKind = "serialization_failure"
	ErrorDeadlockDetected     ErrorKind = "deadlock_detected"
)

// ClassifyError maps PostgreSQL constraint and concurrency SQLSTATE values to
// stable infrastructure categories without changing the original error.
func ClassifyError(err error) ErrorKind {
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) {
		return ErrorUnknown
	}

	switch pgError.Code {
	case "23505":
		return ErrorUniqueViolation
	case "23503":
		return ErrorForeignKeyViolation
	case "23514":
		return ErrorCheckViolation
	case "40001":
		return ErrorSerializationFailure
	case "40P01":
		return ErrorDeadlockDetected
	default:
		return ErrorUnknown
	}
}
