package httpapi

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestNewServerConfiguresTimeoutsWithoutListening(t *testing.T) {
	handler := http.NotFoundHandler()
	server := NewServer("127.0.0.1:8080", handler)

	if server.Addr != "127.0.0.1:8080" || server.Handler == nil {
		t.Fatalf("server address/handler not retained: %+v", server)
	}
	if server.ReadHeaderTimeout != ReadHeaderTimeout || server.ReadHeaderTimeout <= 0 {
		t.Fatalf("ReadHeaderTimeout = %s", server.ReadHeaderTimeout)
	}
	if server.IdleTimeout != IdleTimeout || server.IdleTimeout <= 0 {
		t.Fatalf("IdleTimeout = %s", server.IdleTimeout)
	}
}

func TestServeGracefullyDrainsRequestsOnCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on ephemeral address: %v", err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	server := NewServer(listener.Addr().String(), http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusNoContent)
	}))
	ctx, cancel := context.WithCancel(context.Background())
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- Serve(ctx, server, listener, time.Second)
	}()

	responseDone := make(chan error, 1)
	go func() {
		response, err := http.Get("http://" + listener.Addr().String())
		if err != nil {
			responseDone <- err
			return
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		if response.StatusCode != http.StatusNoContent {
			responseDone <- fmt.Errorf("response status = %d", response.StatusCode)
			return
		}
		responseDone <- nil
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		cancel()
		t.Fatal("request handler did not start")
	}
	cancel()
	close(release)

	select {
	case err := <-responseDone:
		if err != nil {
			t.Fatalf("in-flight request failed during shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("in-flight request did not complete")
	}
	select {
	case err := <-serveDone:
		if err != nil {
			t.Fatalf("Serve() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Serve() did not finish after graceful shutdown")
	}
}
