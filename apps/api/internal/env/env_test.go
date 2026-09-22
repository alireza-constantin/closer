package env

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadLocalPreservesProcessEnvironment(t *testing.T) {
	workingDirectory := t.TempDir()
	apiDirectory := filepath.Join(workingDirectory, "apps", "api")
	if err := os.MkdirAll(apiDirectory, 0o755); err != nil {
		t.Fatal(err)
	}
	localFile := filepath.Join(apiDirectory, localFileName)
	if err := os.WriteFile(localFile, []byte("ENV_TEST_FILE=from-file\nENV_TEST_PRECEDENCE=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("ENV_TEST_PRECEDENCE", "from-process")
	t.Chdir(workingDirectory)
	if err := LoadLocal(); err != nil {
		t.Fatalf("LoadLocal() error = %v", err)
	}
	if got := os.Getenv("ENV_TEST_FILE"); got != "from-file" {
		t.Fatalf("file value = %q, want from-file", got)
	}
	if got := os.Getenv("ENV_TEST_PRECEDENCE"); got != "from-process" {
		t.Fatalf("process value = %q, want from-process", got)
	}
}

func TestLoadLocalMissingFileIsHarmless(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := LoadLocal(); err != nil {
		t.Fatalf("LoadLocal() error for missing file = %v", err)
	}
}

func TestLoadLocalSanitizesParserErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), localFileName)
	if err := os.WriteFile(path, []byte("BROKEN=secret\nUNFINISHED=\"secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := LoadLocalFile(path); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("LoadLocalFile() error = %v, want sanitized parser error", err)
	}
}
