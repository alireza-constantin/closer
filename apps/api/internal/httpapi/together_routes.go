package httpapi

import (
	"errors"
	"net/http"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/alireza-constantin/closer/apps/api/internal/together"
	"github.com/go-chi/chi/v5"
)

type togetherStartRequest struct {
	Category        string `json:"category"`
	ClientRequestID string `json:"clientRequestId,omitempty"`
	SelectionSeed   string `json:"selectionSeed,omitempty"`
}

type togetherAdvanceRequest struct {
	Action                 string `json:"action"`
	ClientRequestID        string `json:"clientRequestId,omitempty"`
	CurrentQuestionID      string `json:"currentQuestionId,omitempty"`
	NextQuestionID         string `json:"nextQuestionId,omitempty"`
	NextQuestionRevisionID string `json:"nextQuestionRevisionId,omitempty"`
}

type togetherLikeRequest struct {
	Liked             bool   `json:"liked"`
	CurrentQuestionID string `json:"currentQuestionId,omitempty"`
}

type togetherQuestionResponse struct {
	QuestionID         string `json:"questionId"`
	QuestionRevisionID string `json:"questionRevisionId"`
	Text               string `json:"text"`
	Intensity          string `json:"intensity,omitempty"`
	Position           int32  `json:"position,omitempty"`
	Liked              bool   `json:"liked,omitempty"`
}

type togetherPageResponse struct {
	Items      []togetherQuestionResponse `json:"items"`
	NextCursor *string                    `json:"nextCursor"`
	HasMore    bool                       `json:"hasMore"`
}

func registerTogetherRoutes(router chi.Router, authService *auth.Service, participantService *participant.Service, service *together.Service, publisher realtime.Publisher, security SecurityConfig) {
	if service == nil {
		return
	}
	api := router.With(authActorMiddleware(authService))
	api.Post("/pairs/{pairID}/together/sessions", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request togetherStartRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Start(r.Context(), together.StartInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), Category: request.Category, ClientRequestID: request.ClientRequestID, SelectionSeed: request.SelectionSeed})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		publishTogetherChanged(r, publisher, chi.URLParam(r, "pairID"))
		writeJSON(w, http.StatusCreated, result)
	})

	api.Get("/pairs/{pairID}/together/sessions/{sessionID}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.Playback(r.Context(), together.PlaybackInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), SessionID: chi.URLParam(r, "sessionID")})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	api.Get("/pairs/{pairID}/together/sessions/{sessionID}/questions", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.Page(r.Context(), together.PageInput{PlaybackInput: together.PlaybackInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), SessionID: chi.URLParam(r, "sessionID")}, Band: r.URL.Query().Get("band"), Cursor: r.URL.Query().Get("cursor")})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toTogetherPageResponse(result))
	})

	api.Post("/pairs/{pairID}/together/sessions/{sessionID}/advance", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request togetherAdvanceRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Advance(r.Context(), together.AdvanceInput{PlaybackInput: together.PlaybackInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), SessionID: chi.URLParam(r, "sessionID")}, Action: request.Action, ClientRequestID: request.ClientRequestID, CurrentQuestionID: request.CurrentQuestionID, NextQuestionID: request.NextQuestionID, NextQuestionRevisionID: request.NextQuestionRevisionID})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	api.Put("/pairs/{pairID}/together/sessions/{sessionID}/like", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request togetherLikeRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Like(r.Context(), together.LikeInput{PlaybackInput: together.PlaybackInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), SessionID: chi.URLParam(r, "sessionID")}, Liked: request.Liked, CurrentQuestionID: request.CurrentQuestionID})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	api.Post("/pairs/{pairID}/together/sessions/{sessionID}/end", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.End(r.Context(), together.PlaybackInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), SessionID: chi.URLParam(r, "sessionID")})
		if err != nil {
			writeTogetherError(w, r, err)
			return
		}
		publishTogetherChanged(r, publisher, chi.URLParam(r, "pairID"))
		writeJSON(w, http.StatusOK, result)
	})
}

func toTogetherPageResponse(page together.QuestionPage) togetherPageResponse {
	items := make([]togetherQuestionResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, togetherQuestionResponse{QuestionID: item.QuestionID, QuestionRevisionID: item.QuestionRevisionID, Text: item.Text, Intensity: item.Intensity, Position: item.Position, Liked: item.Liked})
	}
	return togetherPageResponse{Items: items, NextCursor: page.NextCursor, HasMore: page.HasMore}
}

func publishTogetherChanged(r *http.Request, publisher realtime.Publisher, pairID string) {
	if publisher != nil {
		_ = publisher.Publish(r.Context(), realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.TogetherChanged})
	}
}

func writeTogetherError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, together.ErrInvalidInput), errors.Is(err, together.ErrActionInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Together action is invalid.")
	case errors.Is(err, together.ErrQuestionUnavailable):
		writeAPIError(w, r, http.StatusBadRequest, "QUESTION_UNAVAILABLE", "No Together question is available.")
	case errors.Is(err, together.ErrSessionEnded):
		writeAPIError(w, r, http.StatusConflict, "TOGETHER_SESSION_ENDED", "This Together session has ended.")
	case errors.Is(err, together.ErrSessionExhausted):
		writeAPIError(w, r, http.StatusConflict, "TOGETHER_SESSION_EXHAUSTED", "This Together session is exhausted.")
	case errors.Is(err, together.ErrSessionNotFound), errors.Is(err, together.ErrPairNotFound):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
	default:
		writeAuthInternalError(w, r)
	}
}
