// Package env contains the small process-environment bootstrap used by local
// development and PostgreSQL test entrypoints.
package env

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

const localFileName = ".env.local"

// LoadLocal loads the repository-local API environment file when it is
// present. godotenv.Load preserves every variable already present in the
// process, so explicit environment variables always win.
//
// The two paths are intentional: repository-root commands use apps/api/.env.local,
// while commands started inside apps/api use .env.local. No parent-directory
// search is performed.
func LoadLocal() error {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return errors.New("unable to determine working directory for local environment")
	}

	paths := []string{
		filepath.Join(workingDirectory, "apps", "api", localFileName),
		filepath.Join(workingDirectory, localFileName),
	}
	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			return LoadLocalFile(path)
		} else if !errors.Is(err, os.ErrNotExist) {
			return errors.New("unable to inspect local environment")
		}
	}
	return nil
}

// LoadLocalFile loads one explicitly selected local environment file. A
// missing file is harmless; parser errors are deliberately sanitized so a
// malformed line cannot echo a secret into command output.
func LoadLocalFile(path string) error {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return errors.New("unable to inspect local environment")
	}
	if err := godotenv.Load(path); err != nil {
		return errors.New("unable to load local environment")
	}
	return nil
}
