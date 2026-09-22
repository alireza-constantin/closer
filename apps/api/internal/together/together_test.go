package together

import (
	"context"
	"errors"
	"testing"
)

type fakeStore struct{ started StartInput }

func (s *fakeStore) Start(_ context.Context, input StartInput) (StartResult, error) {
	s.started = input
	return StartResult{SessionID: "session", QuestionID: "question", QuestionRevisionID: "revision"}, nil
}
func (*fakeStore) Playback(context.Context, PlaybackInput) (Playback, error) { return Playback{}, nil }
func (*fakeStore) Page(context.Context, PageInput) (QuestionPage, error)     { return QuestionPage{}, nil }
func (*fakeStore) Advance(context.Context, AdvanceInput) (AdvanceResult, error) {
	return AdvanceResult{}, nil
}
func (*fakeStore) Like(context.Context, LikeInput) (Playback, error)    { return Playback{}, nil }
func (*fakeStore) End(context.Context, PlaybackInput) (Playback, error) { return Playback{}, nil }

func TestServiceAllowsSharedCategoriesAndRejectsMalformedStartRequest(t *testing.T) {
	store := &fakeStore{}
	service := NewService(store)
	result, err := service.Start(context.Background(), StartInput{ParticipantID: "participant", PairID: "pair", Category: "relationship", ClientRequestID: "not-a-uuid"})
	if !errors.Is(err, ErrInvalidInput) || result != (StartResult{}) {
		t.Fatalf("malformed start = %#v, %v", result, err)
	}
	_, err = service.Start(context.Background(), StartInput{ParticipantID: "participant", PairID: "pair", Category: "fun", ClientRequestID: "123e4567-e89b-12d3-a456-426614174000"})
	if err != nil {
		t.Fatalf("valid start error = %v", err)
	}
	if store.started.Category != "fun" {
		t.Fatalf("store received category %q", store.started.Category)
	}
}

func TestValidCategoryRelationshipSpecificity(t *testing.T) {
	for _, test := range []struct {
		category, relationship string
		want                   bool
	}{
		{"relationship", "partner", true},
		{"relationship", "friend", false},
		{"friendship", "friend", true},
		{"friendship", "partner", false},
		{"memories", "friend", true},
	} {
		if got := validCategory(test.category, test.relationship); got != test.want {
			t.Errorf("validCategory(%q, %q) = %v, want %v", test.category, test.relationship, got, test.want)
		}
	}
}
