package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	listenAddressEnv    = "HTTP_ADDR"
	shutdownTimeoutEnv  = "HTTP_SHUTDOWN_TIMEOUT"
	defaultShutdownTime = 10 * time.Second
)

// Config contains only process settings needed by the HTTP foundation.
type Config struct {
	ListenAddress   string
	ShutdownTimeout time.Duration
}

// Load reads process environment once and validates the resulting settings.
func Load() (Config, error) {
	return Parse(os.LookupEnv)
}

// Parse loads and validates configuration using lookup, which makes parsing
// independent of the process environment in tests.
func Parse(lookup func(string) (string, bool)) (Config, error) {
	address, ok := lookup(listenAddressEnv)
	if !ok || strings.TrimSpace(address) == "" {
		return Config{}, fmt.Errorf("%s is required", listenAddressEnv)
	}
	if err := validateListenAddress(address); err != nil {
		return Config{}, fmt.Errorf("invalid %s: %w", listenAddressEnv, err)
	}

	shutdownTimeout := defaultShutdownTime
	if value, ok := lookup(shutdownTimeoutEnv); ok {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("%s must be a positive duration", shutdownTimeoutEnv)
		}
		shutdownTimeout = parsed
	}

	return Config{
		ListenAddress:   address,
		ShutdownTimeout: shutdownTimeout,
	}, nil
}

func validateListenAddress(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("must be a host:port address: %w", err)
	}
	if strings.TrimSpace(host) != host {
		return fmt.Errorf("host must not include surrounding whitespace")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fmt.Errorf("port must be an integer from 1 through 65535")
	}
	return nil
}
