package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCLIConnectionFailureIsActionableAndDoesNotLeakURL(t *testing.T) {
	if os.Getenv("CLOSER_MIGRATE_TEST_CHILD") == "1" {
		os.Args = []string{"migrate", "status"}
		main()
		return
	}
	output, err := runChild(t, "postgres://devuser:pass-secret@127.0.0.1:1/closer_dev?sslpassword=query-secret")
	if err == nil {
		t.Fatal("child unexpectedly succeeded")
	}
	if !strings.Contains(output, "Cannot connect to local PostgreSQL") {
		t.Fatalf("output lacks actionable connection error: %q", output)
	}
	if !strings.Contains(output, "Database: closer_dev") || !strings.Contains(output, "Server:   127.0.0.1:1") {
		t.Fatalf("output does not identify the safe database target: %q", output)
	}
	for _, secret := range []string{"devuser", "pass-secret", "query-secret", "postgres://"} {
		if strings.Contains(output, secret) {
			t.Fatalf("output leaked %q: %q", secret, output)
		}
	}
}

func TestCLIRefusesCloserTestBeforeConnecting(t *testing.T) {
	if os.Getenv("CLOSER_MIGRATE_TEST_CHILD") == "1" {
		os.Args = []string{"migrate", "apply"}
		main()
		return
	}
	output, err := runChild(t, "postgres://devuser:pass-secret@127.0.0.1:1/closer_test?sslpassword=query-secret")
	if err == nil || !strings.Contains(output, "refuse closer_test") {
		t.Fatalf("closer_test was not refused before connection: err=%v output=%q", err, output)
	}
	if strings.Contains(output, "pass-secret") || strings.Contains(output, "query-secret") {
		t.Fatalf("output leaked credentials: %q", output)
	}
}

func runChild(t *testing.T, databaseURL string) (string, error) {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=TestCLIConnectionFailureIsActionableAndDoesNotLeakURL")
	command.Dir = t.TempDir()
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "DATABASE_URL=") && !strings.HasPrefix(entry, "CLOSER_MIGRATE_TEST_CHILD=") {
			command.Env = append(command.Env, entry)
		}
	}
	command.Env = append(command.Env, "DATABASE_URL="+databaseURL, "CLOSER_MIGRATE_TEST_CHILD=1")
	output, err := command.CombinedOutput()
	return string(output), err
}
