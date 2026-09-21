package testdb

import (
	"strings"
	"testing"
)

func TestURLFromEnvRequiresExplicitTestURL(t *testing.T) {
	_, err := URLFromEnv(func(key string) (string, bool) {
		if key != DatabaseURLEnv {
			t.Fatalf("unexpected environment lookup for %q", key)
		}
		return "", false
	})
	if err == nil || !strings.Contains(err.Error(), DatabaseURLEnv) {
		t.Fatalf("URLFromEnv() error = %v, want explicit %s requirement", err, DatabaseURLEnv)
	}
}

func TestValidateTargetRequiresApprovedDatabaseAndLocalHost(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "exact test database", url: "postgres://tester:secret@localhost:5432/closer_test?sslmode=disable", want: true},
		{name: "isolated suffix", url: "postgres://tester:secret@127.0.0.1:5432/closer_test_go02?sslmode=disable", want: true},
		{name: "development database", url: "postgres://tester:secret@localhost:5432/closer_dev?sslmode=disable"},
		{name: "production database", url: "postgres://tester:secret@localhost:5432/closer_prod?sslmode=disable"},
		{name: "test-like but not prefixed", url: "postgres://tester:secret@localhost:5432/not_closer_test?sslmode=disable"},
		{name: "remote host", url: "postgres://tester:secret@db.example.test:5432/closer_test?sslmode=disable"},
		{name: "neon host", url: "postgres://tester:secret@ep.example.neon.tech:5432/closer_test?sslmode=disable"},
		{name: "malformed URL", url: "postgres://tester:secret@[invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateTarget(test.url)
			if test.want && err != nil {
				t.Fatalf("ValidateTarget() error = %v", err)
			}
			if !test.want && err == nil {
				t.Fatal("ValidateTarget() accepted unsafe URL")
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatalf("ValidateTarget() leaked URL credential: %v", err)
			}
		})
	}
}
