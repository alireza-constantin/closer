package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	listenAddressEnv    = "HTTP_ADDR"
	shutdownTimeoutEnv  = "HTTP_SHUTDOWN_TIMEOUT"
	databaseURLEnv      = "DATABASE_URL"
	databaseUnpooledEnv = "DATABASE_URL_UNPOOLED"
	realtimeDatabaseEnv = "REALTIME_DATABASE_URL"
	trustedOriginsEnv   = "CLOSER_TRUSTED_ORIGINS"
	trustedProxiesEnv   = "CLOSER_TRUSTED_PROXY_CIDRS"
	defaultShutdownTime = 10 * time.Second
)

// Config contains validated process settings. Database URLs are kept out of
// logs and error messages because they may contain credentials.
type Config struct {
	ListenAddress       string
	ShutdownTimeout     time.Duration
	DatabaseURL         string
	RealtimeDatabaseURL string
	TrustedOrigins      []string
	TrustedProxyCIDRs   []string
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

	databaseURL, ok := lookup(databaseURLEnv)
	if !ok || strings.TrimSpace(databaseURL) == "" {
		return Config{}, fmt.Errorf("%s is required", databaseURLEnv)
	}
	databaseURL = strings.TrimSpace(databaseURL)
	if err := validateDatabaseURL(databaseURL); err != nil {
		return Config{}, fmt.Errorf("%s is invalid", databaseURLEnv)
	}

	realtimeDatabaseURL, realtimeSet := lookup(realtimeDatabaseEnv)
	if realtimeSet && strings.TrimSpace(realtimeDatabaseURL) != "" {
		realtimeDatabaseURL = strings.TrimSpace(realtimeDatabaseURL)
	} else {
		realtimeDatabaseURL, _ = lookup(databaseUnpooledEnv)
		realtimeDatabaseURL = strings.TrimSpace(realtimeDatabaseURL)
		if realtimeDatabaseURL == "" {
			realtimeDatabaseURL = databaseURL
		}
	}
	if err := validateDatabaseURL(realtimeDatabaseURL); err != nil {
		return Config{}, fmt.Errorf("%s is invalid", realtimeDatabaseEnv)
	}

	trustedOrigins, err := parseTrustedOrigins(lookupString(lookup, trustedOriginsEnv))
	if err != nil {
		return Config{}, fmt.Errorf("invalid %s", trustedOriginsEnv)
	}
	trustedProxyCIDRs, err := parseTrustedProxyCIDRs(lookupString(lookup, trustedProxiesEnv))
	if err != nil {
		return Config{}, fmt.Errorf("invalid %s", trustedProxiesEnv)
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
		ListenAddress:       address,
		ShutdownTimeout:     shutdownTimeout,
		DatabaseURL:         databaseURL,
		RealtimeDatabaseURL: realtimeDatabaseURL,
		TrustedOrigins:      trustedOrigins,
		TrustedProxyCIDRs:   trustedProxyCIDRs,
	}, nil
}

func parseTrustedProxyCIDRs(value string) ([]string, error) {
	if value == "" {
		return nil, nil
	}
	var cidrs []string
	seen := make(map[string]struct{})
	for _, value := range strings.Split(value, ",") {
		value = strings.TrimSpace(value)
		_, network, err := net.ParseCIDR(value)
		if err != nil {
			return nil, fmt.Errorf("proxy value must be an IP CIDR")
		}
		canonical := network.String()
		if _, ok := seen[canonical]; ok {
			return nil, fmt.Errorf("duplicate proxy CIDR")
		}
		seen[canonical] = struct{}{}
		cidrs = append(cidrs, canonical)
	}
	return cidrs, nil
}

func lookupString(lookup func(string) (string, bool), name string) string {
	value, _ := lookup(name)
	return strings.TrimSpace(value)
}

func parseTrustedOrigins(value string) ([]string, error) {
	if value == "" {
		return nil, nil
	}
	var origins []string
	seen := make(map[string]struct{})
	for _, origin := range strings.Split(value, ",") {
		origin = strings.TrimSpace(origin)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Host == "" || parsed.User != nil || parsed.Path != "" ||
			parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
			return nil, fmt.Errorf("origin must be an exact http(s) origin")
		}
		if _, ok := seen[origin]; ok {
			return nil, fmt.Errorf("duplicate origin")
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins, nil
}

func validateDatabaseURL(databaseURL string) error {
	if strings.TrimSpace(databaseURL) == "" {
		return fmt.Errorf("URL is empty")
	}
	if _, err := pgxpool.ParseConfig(databaseURL); err != nil {
		// Driver parse errors can include fragments of the supplied URL.
		return fmt.Errorf("invalid PostgreSQL URL")
	}
	return nil
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
