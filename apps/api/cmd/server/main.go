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

	"github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/config"
	"github.com/alireza-constantin/closer/apps/api/internal/httpapi"
	"github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresanalytics "github.com/alireza-constantin/closer/apps/api/internal/postgres/adminanalytics"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
	postgresinvite "github.com/alireza-constantin/closer/apps/api/internal/postgres/invite"
	postgrespair "github.com/alireza-constantin/closer/apps/api/internal/postgres/pair"
	postgresparticipant "github.com/alireza-constantin/closer/apps/api/internal/postgres/participant"
	postgresprivate "github.com/alireza-constantin/closer/apps/api/internal/postgres/private"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	postgrestogether "github.com/alireza-constantin/closer/apps/api/internal/postgres/together"
	"github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/alireza-constantin/closer/apps/api/internal/together"
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
	participantService := participant.NewService(postgresparticipant.NewStore(database))
	pairService := pair.NewService(postgrespair.NewStore(database))
	privateStore := postgresprivate.NewStore(database)
	privateService := private.NewService(privateStore)
	realtimePublisher := postgres.NewRealtimePublisher(database)
	inviteService := invite.NewServiceWithPublisher(postgresinvite.NewStore(database), realtimePublisher)
	questionService := question.NewService(postgresquestion.NewStore(database, privateStore))
	togetherService := together.NewService(postgrestogether.NewStore(database))
	analyticsService := adminanalytics.NewService(postgresanalytics.NewStore(database))
	realtimeRegistry := realtime.NewRegistry(32)
	router := httpapi.NewRouterWithPrivateAndTogetherRealtime(logger, database, authService, participantService, pairService, inviteService, questionService, privateService, togetherService, realtimeRegistry, realtimePublisher, httpapi.SecurityConfig{
		TrustedOrigins:    cfg.TrustedOrigins,
		TrustedProxyCIDRs: cfg.TrustedProxyCIDRs,
	}, analyticsService)
	server := httpapi.NewServer(cfg.ListenAddress, router)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	realtimeListener := postgres.NewRealtimeListener(cfg.DatabaseURL, realtimeRegistry, logger)
	go func() {
		if err := realtimeListener.Run(ctx); err != nil && ctx.Err() == nil {
			logger.Warn("realtime listener stopped", "error", err)
		}
	}()
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
