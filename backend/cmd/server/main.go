package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/handler"
	"demo-site/backend/internal/repository"
	"demo-site/backend/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run(logger *slog.Logger) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	store, err := repository.Open(ctx, c.DatabasePath)
	if err != nil {
		return err
	}
	defer store.DB.Close()
	if err = store.Cleanup(ctx, time.Now()); err != nil {
		return err
	}
	sessions := &service.Sessions{Store: store, Profile: c.Profile}
	server := &http.Server{Addr: c.Address, Handler: handler.New(sessions, c, logger), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	server.BaseContext = func(net.Listener) context.Context { return ctx }
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	logger.Info("server starting", "address", c.Address, "profile", c.Profile)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case err := <-result:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-ticker.C:
			if err := store.Cleanup(ctx, time.Now()); err != nil {
				logger.Error("session cleanup failed", "error", err)
			}
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			return server.Shutdown(shutdown)
		}
	}
}
