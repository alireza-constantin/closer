package httpapi

import (
	"errors"
	"net/http"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	privatedomain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/go-chi/chi/v5"
)

type privateStartRequest struct {
	Category string `json:"category"`
}

type privateCandidateProjection struct {
	ID       string `json:"id"`
	Question struct {
		ID                 string `json:"id"`
		QuestionRevisionID string `json:"questionRevisionId"`
		Text               string `json:"text"`
		Category           string `json:"category"`
		Intensity          string `json:"intensity"`
	} `json:"question"`
}

type privateConversationProjection struct {
	PairID             string                      `json:"pairId"`
	ConversationID     string                      `json:"conversationId"`
	Category           string                      `json:"category"`
	State              string                      `json:"state"`
	CreatorDisplayName string                      `json:"creatorDisplayName,omitempty"`
	Candidate          *privateCandidateProjection `json:"candidate,omitempty"`
}

func registerPrivateRoutes(router chi.Router, authService *auth.Service, participantService *participant.Service, service *privatedomain.Service, security SecurityConfig) {
	api := router.With(authActorMiddleware(authService))
	api.Post("/pairs/{pairID}/private-conversations", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateStartRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		view, err := service.StartOrResume(r.Context(), privatedomain.StartInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), Category: request.Category})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, projectPrivateView(view))
	})
	api.Get("/pairs/{pairID}/private-conversations/{conversationID}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		view, err := service.Read(r.Context(), privatedomain.ReadInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), ConversationID: chi.URLParam(r, "conversationID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateView(view))
	})
}

func projectPrivateView(view privatedomain.View) privateConversationProjection {
	result := privateConversationProjection{PairID: view.PairID, ConversationID: view.ConversationID, Category: view.Category, State: view.State, CreatorDisplayName: view.CreatorDisplayName}
	if view.Candidate != nil {
		result.Candidate = &privateCandidateProjection{ID: view.Candidate.ID}
		result.Candidate.Question = struct {
			ID                 string `json:"id"`
			QuestionRevisionID string `json:"questionRevisionId"`
			Text               string `json:"text"`
			Category           string `json:"category"`
			Intensity          string `json:"intensity"`
		}{ID: view.Candidate.Question.ID, QuestionRevisionID: view.Candidate.Question.RevisionID, Text: view.Candidate.Question.Text, Category: view.Candidate.Question.Category, Intensity: view.Candidate.Question.Intensity}
	}
	return result
}

func writePrivateError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, privatedomain.ErrCategory):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Private category is invalid for this Pair.")
	case errors.Is(err, privatedomain.ErrNotFound), errors.Is(err, privatedomain.ErrPairNotReady):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
	default:
		writeAuthInternalError(w, r)
	}
}
