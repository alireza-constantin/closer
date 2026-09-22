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

type privateAskRequest struct {
	ClientRequestID string `json:"clientRequestId,omitempty"`
}

type privateSkipRequest struct {
	ClientRequestID string `json:"clientRequestId"`
}

type privateLikeRequest struct {
	Liked *bool `json:"liked"`
}

type privateCandidateProjection struct {
	ID       string `json:"id"`
	Liked    bool   `json:"liked"`
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
	Round              *privateRoundProjection     `json:"round,omitempty"`
}

type privateRoundProjection struct {
	ID                 string `json:"roundId"`
	ConversationID     string `json:"conversationId"`
	QuestionID         string `json:"questionId"`
	QuestionRevisionID string `json:"questionRevisionId"`
	RoundNumber        int32  `json:"roundNumber"`
	State              string `json:"state"`
	AskedAt            string `json:"askedAt"`
	Question           struct {
		Text      string `json:"text"`
		Category  string `json:"category"`
		Intensity string `json:"intensity"`
	} `json:"question"`
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
	api.Post("/pairs/{pairID}/private-conversations/{conversationID}/candidates/{candidateID}/select", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateAskRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Ask(r.Context(), privatedomain.AskInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), ConversationID: chi.URLParam(r, "conversationID"), CandidateID: chi.URLParam(r, "candidateID"), ClientRequestID: request.ClientRequestID})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, projectPrivateRound(result))
	})
	api.Post("/pairs/{pairID}/private-conversations/{conversationID}/candidates/{candidateID}/skip", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateSkipRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Skip(r.Context(), privatedomain.SkipInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), ConversationID: chi.URLParam(r, "conversationID"), CandidateID: chi.URLParam(r, "candidateID"), ClientRequestID: request.ClientRequestID})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateView(result))
	})
	api.Put("/pairs/{pairID}/private-conversations/{conversationID}/candidates/{candidateID}/like", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateLikeRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		if request.Liked == nil {
			writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Private Like value is invalid.")
			return
		}
		liked, err := service.Like(r.Context(), privatedomain.LikeInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), ConversationID: chi.URLParam(r, "conversationID"), CandidateID: chi.URLParam(r, "candidateID"), Liked: *request.Liked})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"liked": liked})
	})
}

func projectPrivateView(view privatedomain.View) privateConversationProjection {
	result := privateConversationProjection{PairID: view.PairID, ConversationID: view.ConversationID, Category: view.Category, State: view.State, CreatorDisplayName: view.CreatorDisplayName}
	if view.Candidate != nil {
		result.Candidate = &privateCandidateProjection{ID: view.Candidate.ID, Liked: view.Candidate.Liked}
		result.Candidate.Question = struct {
			ID                 string `json:"id"`
			QuestionRevisionID string `json:"questionRevisionId"`
			Text               string `json:"text"`
			Category           string `json:"category"`
			Intensity          string `json:"intensity"`
		}{ID: view.Candidate.Question.ID, QuestionRevisionID: view.Candidate.Question.RevisionID, Text: view.Candidate.Question.Text, Category: view.Candidate.Question.Category, Intensity: view.Candidate.Question.Intensity}
	}
	if view.Round != nil {
		result.Round = projectPrivateRound(*view.Round)
	}
	return result
}

func projectPrivateRound(round privatedomain.Round) *privateRoundProjection {
	result := &privateRoundProjection{ID: round.ID, ConversationID: round.ConversationID, QuestionID: round.QuestionID, QuestionRevisionID: round.QuestionRevisionID, RoundNumber: round.RoundNumber, State: round.State, AskedAt: round.AskedAt}
	result.Question.Text = round.Text
	result.Question.Category = round.Category
	result.Question.Intensity = round.Intensity
	return result
}

func writePrivateError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, privatedomain.ErrCategory):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Private category is invalid for this Pair.")
	case errors.Is(err, privatedomain.ErrNotFound), errors.Is(err, privatedomain.ErrPairNotReady):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
	case errors.Is(err, privatedomain.ErrCandidate):
		writeAPIError(w, r, http.StatusBadRequest, "QUESTION_UNAVAILABLE", "This Private question is no longer available.")
	case errors.Is(err, privatedomain.ErrRoundOpen):
		writeAPIError(w, r, http.StatusConflict, "PRIVATE_ROUND_OPEN", "A Private question is already open.")
	case errors.Is(err, privatedomain.ErrInvalidInput):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Private command is invalid.")
	default:
		writeAuthInternalError(w, r)
	}
}
