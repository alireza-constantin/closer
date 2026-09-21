package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/alireza-constantin/closer/apps/api/internal/config"
	"github.com/alireza-constantin/closer/apps/api/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("API server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	router := httpapi.NewRouter(logger)
	server := httpapi.NewServer(cfg.ListenAddress, router)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	listener, err := net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		return err
	}
	defer func() {
		if err := listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			logger.Error("HTTP listener close failed", "error", err)
		}
	}()

	logger.Info("HTTP server starting")
	return httpapi.Serve(ctx, server, listener, cfg.ShutdownTimeout)
}
