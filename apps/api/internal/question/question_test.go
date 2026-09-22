package question

import (
	"context"
	"testing"
)

type recordingRepository struct{ fields RevisionFields }

func (r *recordingRepository) Create(_ context.Context, fields RevisionFields, _ string) (Question, error) {
	r.fields = fields
	return Question{}, nil
}
func (*recordingRepository) Edit(context.Context, string, RevisionFields, string, string) (Question, error) {
	return Question{}, nil
}
func (*recordingRepository) Restore(context.Context, string, string, string, string) (Question, error) {
	return Question{}, nil
}
func (*recordingRepository) SetActivity(context.Context, string, string, string) (Question, error) {
	return Question{}, nil
}
func (*recordingRepository) Withdraw(context.Context, string, string, string, string) (Revision, error) {
	return Revision{}, nil
}
func (*recordingRepository) Get(context.Context, string) (Question, error)        { return Question{}, nil }
func (*recordingRepository) List(context.Context, ListFilter) ([]Question, error) { return nil, nil }
func (*recordingRepository) ListRevisions(context.Context, string) ([]Revision, error) {
	return nil, nil
}

func TestCreateNormalizesWordingAndKeepsDeepIntensityDistinct(t *testing.T) {
	repository := &recordingRepository{}
	service := NewService(repository)
	_, err := service.Create(context.Background(), RevisionFields{Text: "  A   deep   question ", Category: "fun", RelationshipFit: "both", ModeFit: "both", Intensity: "deep"}, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if repository.fields.Text != "A deep question" || repository.fields.Intensity != "deep" {
		t.Fatalf("recorded fields = %+v", repository.fields)
	}
}

func TestRelationshipCategoryRequiresMatchingFit(t *testing.T) {
	service := NewService(&recordingRepository{})
	_, err := service.Create(context.Background(), RevisionFields{Text: "Question", Category: "relationship", RelationshipFit: "friend", ModeFit: "both", Intensity: "light"}, "admin")
	if err != ErrInvalidInput {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}
