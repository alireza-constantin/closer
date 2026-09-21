package auth

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestNormalizeEmailTrimsAndUnicodeCaseFolds(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"  TEST@Example.COM ", "test@example.com"},
		{"Straße@Example.com", "strasse@example.com"},
	} {
		got, err := NormalizeEmail(test.input)
		if err != nil || got != test.want {
			t.Fatalf("NormalizeEmail(%q) = %q, %v; want %q", test.input, got, err, test.want)
		}
	}
	for _, input := range []string{"", "plain text", "Name <person@example.com>", "person@", "person@example.\ncom"} {
		if _, err := NormalizeEmail(input); err == nil {
			t.Errorf("NormalizeEmail(%q) accepted malformed email", input)
		}
	}
}

func TestArgon2idHashPolicyAndVerification(t *testing.T) {
	hasher := Argon2idHasher{}
	password := "this is a strong password"
	hash, err := hasher.Hash(context.Background(), password)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatalf("hash does not encode the frozen policy: %q", hash)
	}
	if hasher.NeedsRehash(hash) {
		t.Fatal("current-policy hash requested a rehash")
	}
	secondHash, err := hasher.Hash(context.Background(), password)
	if err != nil || secondHash == hash {
		t.Fatalf("repeated password hash did not use a fresh salt: %v", err)
	}
	if valid, err := hasher.Verify(context.Background(), hash, password); err != nil || !valid {
		t.Fatalf("Verify(correct) = %t, %v", valid, err)
	}
	if valid, err := hasher.Verify(context.Background(), hash, "not the password"); err != nil || valid {
		t.Fatalf("Verify(wrong) = %t, %v", valid, err)
	}
	if _, err := hasher.Hash(context.Background(), "short"); err == nil {
		t.Fatal("Hash accepted a password below the minimum length")
	}
	if _, err := hasher.Hash(context.Background(), strings.Repeat("x", MaxPasswordBytes+1)); err == nil {
		t.Fatal("Hash accepted a password above the maximum length")
	}
}

func TestArgon2idParserBoundsMemoryAndRequestsRehashForWeakParameters(t *testing.T) {
	salt := []byte("0123456789abcdef")
	weakKey := argon2.IDKey([]byte("password"), salt, 1, 8*1024, 1, Argon2KeyBytes)
	weak := "$argon2id$v=19$m=8192,t=1,p=1$" +
		base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(weakKey)
	hasher := Argon2idHasher{}
	if !hasher.NeedsRehash(weak) {
		t.Fatal("weaker parameters did not request rehash")
	}
	if valid, err := hasher.Verify(context.Background(), weak, "password"); err != nil || !valid {
		t.Fatalf("Verify(weak hash) = %t, %v", valid, err)
	}
	for _, malicious := range []string{
		"$argon2id$v=19$m=268435456,t=3,p=1$MDEyMzQ1Njc4OWFiY2RlZg$" + base64.RawStdEncoding.EncodeToString(make([]byte, Argon2KeyBytes)),
		"$argon2id$v=19$m=65536,t=999999,p=1$MDEyMzQ1Njc4OWFiY2RlZg$" + base64.RawStdEncoding.EncodeToString(make([]byte, Argon2KeyBytes)),
		"not-a-phc-hash",
	} {
		if valid, err := hasher.Verify(context.Background(), malicious, "password"); err != nil || valid {
			t.Errorf("Verify(malicious hash) = %t, %v", valid, err)
		}
		if !hasher.NeedsRehash(malicious) {
			t.Errorf("NeedsRehash(%q) = false", malicious)
		}
	}
}
