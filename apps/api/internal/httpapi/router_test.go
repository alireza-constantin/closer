package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	var logOutput bytes.Buffer
	handler := NewRouter(slog.New(slog.NewJSONHandler(&logOutput, nil)))
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set(RequestIDHeader, "untrusted-client-value")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	requestID := response.Header().Get(RequestIDHeader)
	if len(requestID) != 32 || requestID == "untrusted-client-value" {
		t.Fatalf("response request ID = %q, want a generated 32-character ID", requestID)
	}
	var body healthResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("health status = %q, want ok", body.Status)
	}

	var logRecord map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logOutput.Bytes()), &logRecord); err != nil {
		t.Fatalf("decode request log: %v", err)
	}
	if logRecord["request_id"] != requestID {
		t.Fatalf("logged request ID = %v, want %q", logRecord["request_id"], requestID)
	}
	if logRecord["route"] != "/healthz" || logRecord["status"] != float64(http.StatusOK) {
		t.Fatalf("request log route/status = %v/%v", logRecord["route"], logRecord["status"])
	}
}

func TestReadinessIsUnavailableUntilDependenciesExist(t *testing.T) {
	response := httptest.NewRecorder()
	NewRouter(nil).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	var body healthResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	if body.Status != "not_ready" {
		t.Fatalf("readiness status = %q, want not_ready", body.Status)
	}
}

func TestUnsupportedMethodsReturnJSON(t *testing.T) {
	tests := []struct {
		name   string
		method string
	}{
		{name: "route method", method: http.MethodPost},
		{name: "unsupported standard method", method: http.MethodTrace},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			NewRouter(nil).ServeHTTP(response, httptest.NewRequest(test.method, "/healthz", nil))
			if response.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
			}
			if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
				t.Fatalf("Content-Type = %q, want application/json", got)
			}
			var body errorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode method error response: %v", err)
			}
			if body.Error != methodNotAllowedCode {
				t.Fatalf("error = %q, want %q", body.Error, methodNotAllowedCode)
			}
			if got := response.Header().Get("Allow"); !strings.Contains(got, http.MethodGet) {
				t.Fatalf("Allow = %q, want the route's GET method", got)
			}
		})
	}
}

func TestRequestBodyLimitRejectsOversizedDeclaredBody(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	request.ContentLength = MaxRequestBodyBytes + 1
	response := httptest.NewRecorder()
	NewRouter(nil).ServeHTTP(response, request)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
	var body errorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode size error response: %v", err)
	}
	if body.Error != requestTooLargeCode {
		t.Fatalf("error = %q, want %q", body.Error, requestTooLargeCode)
	}
}

func TestRequestBodyLimitCapsUnknownLengthBodies(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("x", MaxRequestBodyBytes+1)))
	request.ContentLength = -1
	var limitReached bool
	handler := requestBodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.Copy(io.Discard, r.Body)
		if _, ok := err.(*http.MaxBytesError); ok {
			limitReached = true
			writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: requestTooLargeCode})
			return
		}
		writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !limitReached || response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("limitReached = %t, status = %d", limitReached, response.Code)
	}
}

func TestRecoveryHidesPanicDetails(t *testing.T) {
	var logOutput bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logOutput, nil))
	panicHandler := recoverer(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("private internal detail")
	}))
	response := httptest.NewRecorder()
	panicHandler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "private internal detail") {
		t.Fatalf("response exposed panic detail: %q", response.Body.String())
	}
	if !strings.Contains(logOutput.String(), "HTTP handler panic recovered") {
		t.Fatalf("panic was not logged: %q", logOutput.String())
	}
}

func TestRequestLogDoesNotIncludeRawURLOrQuery(t *testing.T) {
	var logOutput bytes.Buffer
	request := httptest.NewRequest(http.MethodGet, "/healthz?token=do-not-log", nil)
	NewRouter(slog.New(slog.NewJSONHandler(&logOutput, nil))).ServeHTTP(httptest.NewRecorder(), request)

	if strings.Contains(logOutput.String(), "do-not-log") {
		t.Fatalf("request log exposed query data: %q", logOutput.String())
	}
}
