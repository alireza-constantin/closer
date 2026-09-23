package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNoStoreAdminReadSetsPrivateCachePolicy(t *testing.T) {
	called := false
	handler := noStoreAdminRead(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusUnauthorized)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/admin/questions", nil))
	if !called {
		t.Fatal("admin read handler was not called")
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
}
