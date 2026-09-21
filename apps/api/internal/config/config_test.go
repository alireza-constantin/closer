package config

import (
	"strings"
	"testing"
	"time"
)

const testDatabaseURL = "postgres://closer:secret-for-tests@localhost:5432/closer_dev?sslmode=disable"

func TestParseRequiresValidListenAddress(t *testing.T) {
	tests := []struct {
		name    string
		address string
		present bool
	}{
		{name: "missing"},
		{name: "empty", address: " ", present: true},
		{name: "missing port", address: "127.0.0.1", present: true},
		{name: "invalid port", address: "127.0.0.1:nope", present: true},
		{name: "zero port", address: "127.0.0.1:0", present: true},
		{name: "out of range port", address: "127.0.0.1:65536", present: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := Parse(func(key string) (string, bool) {
				if key != listenAddressEnv {
					t.Fatalf("unexpected environment lookup for %q", key)
				}
				return test.address, test.present
			})
			if err == nil {
				t.Fatal("Parse() succeeded for invalid listen address")
			}
		})
	}
}

func TestParseUsesDefaultsAndConfiguredShutdownTimeout(t *testing.T) {
	values := map[string]string{
		listenAddressEnv:   "127.0.0.1:8080",
		shutdownTimeoutEnv: "3s",
		databaseURLEnv:     testDatabaseURL,
	}
	config, err := Parse(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if config.ListenAddress != "127.0.0.1:8080" {
		t.Fatalf("ListenAddress = %q", config.ListenAddress)
	}
	if config.ShutdownTimeout != 3*time.Second {
		t.Fatalf("ShutdownTimeout = %s, want 3s", config.ShutdownTimeout)
	}
	if config.DatabaseURL != testDatabaseURL || config.RealtimeDatabaseURL != testDatabaseURL {
		t.Fatalf("database URLs were not loaded with the local fallback: %+v", config)
	}

	delete(values, shutdownTimeoutEnv)
	config, err = Parse(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("Parse() with default timeout error = %v", err)
	}
	if config.ShutdownTimeout != defaultShutdownTime {
		t.Fatalf("default ShutdownTimeout = %s, want %s", config.ShutdownTimeout, defaultShutdownTime)
	}
}

func TestParseSelectsRealtimeURLAndTransitionFallback(t *testing.T) {
	tests := []struct {
		name    string
		values  map[string]string
		wantURL string
	}{
		{
			name: "explicit realtime URL",
			values: map[string]string{
				databaseURLEnv:      testDatabaseURL,
				realtimeDatabaseEnv: "postgres://closer:other-secret@localhost:5432/closer_realtime?sslmode=disable",
				databaseUnpooledEnv: "postgres://closer:unused@localhost:5432/unused?sslmode=disable",
			},
			wantURL: "postgres://closer:other-secret@localhost:5432/closer_realtime?sslmode=disable",
		},
		{
			name: "unpooled fallback",
			values: map[string]string{
				databaseURLEnv:      testDatabaseURL,
				databaseUnpooledEnv: "postgres://closer:direct@localhost:5432/closer_direct?sslmode=disable",
			},
			wantURL: "postgres://closer:direct@localhost:5432/closer_direct?sslmode=disable",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := map[string]string{
				listenAddressEnv: "127.0.0.1:8080",
			}
			for key, value := range test.values {
				values[key] = value
			}
			config, err := Parse(func(key string) (string, bool) {
				value, ok := values[key]
				return value, ok
			})
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if config.RealtimeDatabaseURL != test.wantURL {
				t.Fatalf("RealtimeDatabaseURL = %q, want %q", config.RealtimeDatabaseURL, test.wantURL)
			}
		})
	}
}

func TestParseRejectsInvalidDatabaseURLsWithoutEchoingSecrets(t *testing.T) {
	for _, test := range []struct {
		name     string
		variable string
		values   map[string]string
	}{
		{
			name:     "missing normal URL",
			variable: databaseURLEnv,
			values:   map[string]string{},
		},
		{
			name:     "malformed normal URL",
			variable: databaseURLEnv,
			values:   map[string]string{databaseURLEnv: "postgres://closer:do-not-log@[invalid"},
		},
		{
			name:     "malformed realtime URL",
			variable: realtimeDatabaseEnv,
			values: map[string]string{
				databaseURLEnv:      testDatabaseURL,
				realtimeDatabaseEnv: "postgres://closer:do-not-log@[invalid",
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			values := map[string]string{
				listenAddressEnv: "127.0.0.1:8080",
			}
			for key, value := range test.values {
				values[key] = value
			}
			_, err := Parse(func(key string) (string, bool) {
				value, ok := values[key]
				return value, ok
			})
			if err == nil || !strings.Contains(err.Error(), test.variable) {
				t.Fatalf("Parse() error = %v, want error naming %s", err, test.variable)
			}
			if strings.Contains(err.Error(), "do-not-log") {
				t.Fatalf("Parse() leaked the URL secret: %v", err)
			}
		})
	}
}

func TestParseRejectsInvalidShutdownTimeout(t *testing.T) {
	for _, timeout := range []string{"not-a-duration", "0s", "-1s"} {
		t.Run(timeout, func(t *testing.T) {
			_, err := Parse(func(key string) (string, bool) {
				switch key {
				case listenAddressEnv:
					return "127.0.0.1:8080", true
				case shutdownTimeoutEnv:
					return timeout, true
				case databaseURLEnv:
					return testDatabaseURL, true
				default:
					return "", false
				}
			})
			if err == nil {
				t.Fatal("Parse() succeeded for invalid shutdown timeout")
			}
		})
	}
}

func TestParseLoadsExactTrustedOrigins(t *testing.T) {
	values := map[string]string{
		listenAddressEnv:  "127.0.0.1:8080",
		databaseURLEnv:    testDatabaseURL,
		trustedOriginsEnv: "http://localhost:5173, https://closer.example",
	}
	config, err := Parse(func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(config.TrustedOrigins) != 2 || config.TrustedOrigins[0] != "http://localhost:5173" || config.TrustedOrigins[1] != "https://closer.example" {
		t.Fatalf("TrustedOrigins = %#v", config.TrustedOrigins)
	}
}

func TestParseRejectsInvalidTrustedOrigins(t *testing.T) {
	for _, test := range []struct {
		name  string
		key   string
		value string
	}{
		{name: "wildcard origin", key: trustedOriginsEnv, value: "*"},
		{name: "origin path", key: trustedOriginsEnv, value: "https://closer.example/path"},
		{name: "origin slash", key: trustedOriginsEnv, value: "https://closer.example/"},
		{name: "duplicate origin", key: trustedOriginsEnv, value: "https://closer.example,https://closer.example"},
	} {
		t.Run(test.name, func(t *testing.T) {
			values := map[string]string{
				listenAddressEnv: "127.0.0.1:8080",
				databaseURLEnv:   testDatabaseURL,
				test.key:         test.value,
			}
			_, err := Parse(func(key string) (string, bool) {
				value, ok := values[key]
				return value, ok
			})
			if err == nil || !strings.Contains(err.Error(), test.key) {
				t.Fatalf("Parse() error = %v, want invalid %s", err, test.key)
			}
		})
	}
}
