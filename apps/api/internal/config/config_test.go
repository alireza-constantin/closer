package config

import (
	"testing"
	"time"
)

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

func TestParseRejectsInvalidShutdownTimeout(t *testing.T) {
	for _, timeout := range []string{"not-a-duration", "0s", "-1s"} {
		t.Run(timeout, func(t *testing.T) {
			_, err := Parse(func(key string) (string, bool) {
				switch key {
				case listenAddressEnv:
					return "127.0.0.1:8080", true
				case shutdownTimeoutEnv:
					return timeout, true
				default:
					t.Fatalf("unexpected environment lookup for %q", key)
					return "", false
				}
			})
			if err == nil {
				t.Fatal("Parse() succeeded for invalid shutdown timeout")
			}
		})
	}
}
