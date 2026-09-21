package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func TestReadinessEndpointWithGuardedPostgresDatabase(t *testing.T) {
	if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
		t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL integration checks")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	defer pool.Close()

	response := httptest.NewRecorder()
	NewRouter(nil, pool).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("readiness status = %d, want %d", response.Code, http.StatusOK)
	}
}
