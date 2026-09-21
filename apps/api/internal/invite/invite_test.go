package invite

import (
	"encoding/base64"
	"testing"
)

func TestNewTokenUsesIndependentHighEntropyValues(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("independent credentials unexpectedly matched")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(first)
	if err != nil {
		t.Fatalf("token is not URL-safe base64: %v", err)
	}
	if len(decoded) != 32 {
		t.Fatalf("credential bytes=%d, want 32", len(decoded))
	}
}
