package private

import "testing"

func TestPreferredIntensitiesRamp(t *testing.T) {
	tests := []struct {
		completed int
		want      string
	}{{0, "light"}, {1, "light"}, {2, "medium"}, {3, "medium"}, {4, "deep"}}
	for _, test := range tests {
		if got := PreferredIntensities(test.completed)[0]; got != test.want {
			t.Errorf("completed=%d intensity=%q, want %q", test.completed, got, test.want)
		}
	}
}

func TestRelationshipCategoryIsPairScoped(t *testing.T) {
	if !CategoryAllowed("partner", "relationship") || !CategoryAllowed("friend", "friendship") {
		t.Fatal("expected matching relationship categories to be allowed")
	}
	if CategoryAllowed("partner", "friendship") || CategoryAllowed("friend", "relationship") {
		t.Fatal("expected mismatched relationship categories to be rejected")
	}
	if !CategoryAllowed("partner", "fun") || !CategoryAllowed("friend", "memories") {
		t.Fatal("expected shared categories to be allowed")
	}
}
