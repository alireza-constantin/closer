package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/config"
	"github.com/alireza-constantin/closer/apps/api/internal/httpapi"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
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
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), postgres.ConnectTimeout)
	database, err := postgres.NewPool(startupCtx, cfg.DatabaseURL)
	cancelStartup()
	if err != nil {
		return err
	}
	defer database.Close()

	authStore := postgresauth.NewStore(database)
	authService := auth.NewServiceWithCredentials(authStore, authStore, nil)
	router := httpapi.NewRouterWithAuth(logger, database, authService, httpapi.SecurityConfig{
		TrustedOrigins:    cfg.TrustedOrigins,
		TrustedProxyCIDRs: cfg.TrustedProxyCIDRs,
	})
	server := httpapi.NewServer(cfg.ListenAddress, router)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startAuthSessionCleanup(ctx, logger, authService)

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

func startAuthSessionCleanup(ctx context.Context, logger *slog.Logger, service *auth.Service) {
	go func() {
		ticker := time.NewTicker(auth.SessionCleanupEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanupCtx, cancel := context.WithTimeout(ctx, postgres.CommandTimeout)
				deleted, err := service.CleanupExpiredSessions(cleanupCtx)
				cancel()
				if err != nil {
					logger.Warn("expired auth session cleanup failed")
				} else if deleted > 0 {
					logger.Info("expired auth sessions cleaned", "count", deleted)
				}
				rateLimitCtx, cancelRateLimit := context.WithTimeout(ctx, postgres.CommandTimeout)
				deletedLimits, rateLimitErr := service.CleanupRateLimits(rateLimitCtx)
				cancelRateLimit()
				if rateLimitErr != nil {
					logger.Warn("old auth rate limit cleanup failed")
				} else if deletedLimits > 0 {
					logger.Info("old auth rate limits cleaned", "count", deletedLimits)
				}
			}
		}
	}()
}
