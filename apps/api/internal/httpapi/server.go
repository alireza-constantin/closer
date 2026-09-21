package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

const (
	ReadHeaderTimeout = 5 * time.Second
	IdleTimeout       = 60 * time.Second
)

// NewServer constructs the HTTP server separately from listener creation so
// settings can be inspected and tested without binding a socket.
func NewServer(address string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: ReadHeaderTimeout,
		IdleTimeout:       IdleTimeout,
	}
}

// Serve runs server on listener until it exits or ctx is canceled. On
// cancellation it drains active requests within shutdownTimeout, then closes
// any remaining connections if the deadline expires.
func Serve(ctx context.Context, server *http.Server, listener net.Listener, shutdownTimeout time.Duration) error {
	if server == nil {
		return errors.New("HTTP server is required")
	}
	if listener == nil {
		return errors.New("HTTP listener is required")
	}
	if shutdownTimeout <= 0 {
		return errors.New("HTTP shutdown timeout must be positive")
	}

	serveErrors := make(chan error, 1)
	go func() {
		serveErrors <- server.Serve(listener)
	}()

	select {
	case err := <-serveErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		<-serveErrors
		return fmt.Errorf("graceful HTTP shutdown: %w", err)
	}

	if err := <-serveErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("HTTP server stopped: %w", err)
	}
	return nil
}
