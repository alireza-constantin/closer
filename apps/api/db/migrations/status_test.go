package migrations

import (
	"crypto/sha256"
	"encoding/hex"
	"reflect"
	"testing"
)

func TestSummarizeMigrationStates(t *testing.T) {
	loaded := []migration{
		{version: "000001_first", checksum: "sha-first"},
		{version: "000002_second", checksum: "sha-second"},
		{version: "000003_third", checksum: "sha-third"},
	}
	tests := []struct {
		name         string
		known        map[string]string
		state        State
		applied      int
		pending      []string
		unknown      []string
		mismatch     []string
		loadedLegacy bool
	}{
		{name: "empty database", known: map[string]string{}, state: StateBehind, pending: []string{"000001_first", "000002_second", "000003_third"}},
		{name: "partial database", known: map[string]string{"000001_first": "sha-first"}, state: StateBehind, applied: 1, pending: []string{"000002_second", "000003_third"}},
		{name: "current database", known: map[string]string{"000001_first": "sha-first", "000002_second": "sha-second", "000003_third": "sha-third"}, state: StateCurrent, applied: 3},
		{name: "unknown newer migration", known: map[string]string{"000001_first": "sha-first", "000004_newer": "sha-newer"}, state: StateAhead, applied: 2, pending: []string{"000002_second", "000003_third"}, unknown: []string{"000004_newer"}},
		{name: "edited applied migration", known: map[string]string{"000001_first": "changed"}, state: StateMismatch, applied: 1, pending: []string{"000002_second", "000003_third"}, mismatch: []string{"000001_first"}},
		{name: "missing older migration before applied newer", known: map[string]string{"000002_second": "sha-second"}, state: StateAhead, applied: 1, pending: []string{"000001_first", "000003_third"}, unknown: []string{"000002_second"}},
		{name: "rerun", known: map[string]string{"000001_first": "sha-first", "000002_second": "sha-second", "000003_third": "sha-third"}, state: StateCurrent, applied: 3},
		{name: "legacy line-ending checksum", known: map[string]string{"000001_first": "legacy"}, state: StateBehind, applied: 1, pending: []string{"000002_second", "000003_third"}, loadedLegacy: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			current := loaded
			if test.loadedLegacy {
				current = append([]migration(nil), loaded...)
				current[0].legacyChecksums = []string{"legacy"}
			}
			got := summarize(current, test.known)
			if got.State != test.state || got.Applied != test.applied || !reflect.DeepEqual(got.Pending, test.pending) || !reflect.DeepEqual(got.Unknown, test.unknown) || !reflect.DeepEqual(got.Mismatch, test.mismatch) {
				t.Fatalf("summarize() = %#v", got)
			}
		})
	}
}

func TestLoadUsesNewlineCanonicalSHA256(t *testing.T) {
	loaded, err := load()
	if err != nil {
		t.Fatal(err)
	}
	canonical := loaded[0].contents
	sum := sha256.Sum256(canonical)
	if got, want := loaded[0].checksum, hex.EncodeToString(sum[:]); got != want {
		t.Fatalf("canonical checksum = %q, want %q", got, want)
	}
	crlf := make([]byte, 0, len(canonical)+len(canonical)/20)
	for _, b := range canonical {
		if b == '\n' {
			crlf = append(crlf, '\r')
		}
		crlf = append(crlf, b)
	}
	legacySum := sha256.Sum256(crlf)
	if !contains(loaded[0].legacyChecksums, hex.EncodeToString(legacySum[:])) {
		t.Fatal("CRLF checksum is not recognized as a legacy line-ending variant")
	}
}
