package adminanalytics

import "testing"

func TestCoverageHealthThresholds(t *testing.T) {
	for _, test := range []struct {
		count int64
		want  string
	}{
		{0, "critical"}, {5, "critical"}, {6, "low"}, {11, "low"}, {12, "healthy"},
	} {
		if got := CoverageHealth(test.count); got != test.want {
			t.Errorf("CoverageHealth(%d) = %q, want %q", test.count, got, test.want)
		}
	}
}
