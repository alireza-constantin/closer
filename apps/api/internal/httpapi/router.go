package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

const (
	RequestIDHeader          = "X-Request-ID"
	MaxRequestBodyBytes      = 1 << 20
	serverErrorCode          = "internal_server_error"
	requestTooLargeCode      = "request_too_large"
	methodNotAllowedCode     = "method_not_allowed"
	requestIDGenerationError = "request_id_generation_failed"
)

type requestIDContextKey struct{}

type errorResponse struct {
	Error string `json:"error"`
}

type healthResponse struct {
	Status string `json:"status"`
}

// NewRouter constructs the HTTP transport without opening a listening socket.
func NewRouter(logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}

	router := chi.NewRouter()
	router.Use(requestID(logger))
	router.Use(requestLogger(logger))
	router.Use(recoverer(logger))
	router.Use(requestBodyLimit)
	router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		if allowed := allowedMethods(router, r.URL.Path); allowed != "" {
			w.Header().Set("Allow", allowed)
		}
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: methodNotAllowedCode})
	})
	router.NotFound(jsonErrorHandler("not_found", http.StatusNotFound))

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
	})
	router.Get("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusServiceUnavailable, healthResponse{Status: "not_ready"})
	})

	return router
}

func requestID(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, err := generateRequestID()
			if err != nil {
				logger.Error("request ID generation failed", "error", requestIDGenerationError)
				writeJSON(w, http.StatusInternalServerError, errorResponse{Error: serverErrorCode})
				return
			}
			w.Header().Set(RequestIDHeader, id)
			r = r.WithContext(contextWithRequestID(r, id))
			next.ServeHTTP(w, r)
		})
	}
}

func contextWithRequestID(r *http.Request, id string) context.Context {
	return context.WithValue(r.Context(), requestIDContextKey{}, id)
}

func requestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDContextKey{}).(string)
	return id
}

func generateRequestID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(id[:]), nil
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(wrapped, r)

			route := routePattern(r.Context())
			if route == "" {
				route = "unmatched"
			}
			status := wrapped.Status()
			if status == 0 {
				status = http.StatusOK
			}
			logger.Info("http request",
				"request_id", requestIDFromContext(r.Context()),
				"method", r.Method,
				"route", route,
				"status", status,
				"duration_ms", time.Since(started).Milliseconds(),
			)
		})
	}
}

func routePattern(ctx context.Context) string {
	if routeContext := chi.RouteContext(ctx); routeContext != nil {
		return routeContext.RoutePattern()
	}
	return ""
}

func recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("HTTP handler panic recovered",
						"request_id", requestIDFromContext(r.Context()),
						"panic_type", fmt.Sprintf("%T", recovered),
						"stack", string(debug.Stack()),
					)
					if writer, ok := w.(interface{ Status() int }); !ok || writer.Status() == 0 {
						writeJSON(w, http.StatusInternalServerError, errorResponse{Error: serverErrorCode})
					}
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func requestBodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > MaxRequestBodyBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, errorResponse{Error: requestTooLargeCode})
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func jsonErrorHandler(code string, status int) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, status, errorResponse{Error: code})
	}
}

func allowedMethods(router chi.Routes, path string) string {
	var allowed []string
	for _, method := range []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodConnect,
		http.MethodOptions,
		http.MethodTrace,
	} {
		if router.Match(chi.NewRouteContext(), method, path) {
			allowed = append(allowed, method)
		}
	}
	return strings.Join(allowed, ", ")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
