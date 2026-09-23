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

type privateAnswerRequest struct {
	Body *string `json:"body"`
}

type privateReactionRequest struct {
	Value *string `json:"value"`
}
type privateReplyRequest struct {
	Body *string `json:"body"`
}
type privateProgressRequest struct {
	ClientRequestID string `json:"clientRequestId"`
	Action          string `json:"action"`
	Category        string `json:"category,omitempty"`
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
	PairID              string                      `json:"pairId"`
	ConversationID      string                      `json:"conversationId"`
	Category            string                      `json:"category"`
	State               string                      `json:"state"`
	AvailableCategories []string                    `json:"availableCategories"`
	CreatorDisplayName  string                      `json:"creatorDisplayName,omitempty"`
	Candidate           *privateCandidateProjection `json:"candidate,omitempty"`
	Round               *privateRoundProjection     `json:"round,omitempty"`
}

type privateRoundProjection struct {
	ID                  string                      `json:"roundId"`
	ConversationID      string                      `json:"conversationId"`
	QuestionID          string                      `json:"questionId"`
	QuestionRevisionID  string                      `json:"questionRevisionId"`
	RoundNumber         int32                       `json:"roundNumber"`
	State               string                      `json:"state"`
	AskedAt             string                      `json:"askedAt"`
	YourAnswer          *string                     `json:"yourAnswer"`
	HasOtherAnswer      bool                        `json:"hasOtherAnswer"`
	RevealViewedAt      string                      `json:"revealViewedAt,omitempty"`
	OtherRevealViewedAt string                      `json:"otherRevealViewedAt,omitempty"`
	OtherRevealViewed   bool                        `json:"otherRevealViewed"`
	CanContinue         bool                        `json:"canContinue"`
	Answers             []privateAnswerProjection   `json:"answers,omitempty"`
	Reactions           []privateReactionProjection `json:"reactions,omitempty"`
	Replies             []privateReplyProjection    `json:"replies,omitempty"`
	Question            struct {
		Text      string `json:"text"`
		Category  string `json:"category"`
		Intensity string `json:"intensity"`
	} `json:"question"`
}

type privateAnswerProjection struct {
	ParticipantID string `json:"participantId"`
	Body          string `json:"body"`
	IsOwner       bool   `json:"isOwner"`
}

type privateReactionProjection struct {
	ParticipantID string `json:"participantId"`
	DisplayName   string `json:"displayName"`
	Value         string `json:"value"`
	IsOwner       bool   `json:"isOwner"`
}
type privateReplyProjection struct {
	ParticipantID string `json:"participantId"`
	DisplayName   string `json:"displayName"`
	Body          string `json:"body"`
	IsOwner       bool   `json:"isOwner"`
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
	api.Get("/pairs/{pairID}/private-rounds/{roundID}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.GetRound(r.Context(), privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Post("/pairs/{pairID}/private-rounds/{roundID}/answer", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateAnswerRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		if request.Body == nil {
			writeAPIError(w, r, http.StatusBadRequest, "ANSWER_INVALID", "The answer is invalid.")
			return
		}
		result, err := service.Answer(r.Context(), privatedomain.AnswerInput{RoundInput: privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")}, Body: *request.Body})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Post("/pairs/{pairID}/private-rounds/{roundID}/retire", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.Decline(r.Context(), privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Post("/pairs/{pairID}/private-rounds/{roundID}/reveal", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.Reveal(r.Context(), privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Put("/pairs/{pairID}/private-rounds/{roundID}/reaction", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateReactionRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		if request.Value == nil {
			writeAPIError(w, r, http.StatusBadRequest, "REACTION_INVALID", "The reaction is invalid.")
			return
		}
		result, err := service.SetReaction(r.Context(), privatedomain.ReactionInput{RoundInput: privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")}, Value: *request.Value})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Delete("/pairs/{pairID}/private-rounds/{roundID}/reaction", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.RemoveReaction(r.Context(), privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Put("/pairs/{pairID}/private-rounds/{roundID}/reply", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateReplyRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		if request.Body == nil {
			writeAPIError(w, r, http.StatusBadRequest, "REPLY_INVALID", "The reply is invalid.")
			return
		}
		result, err := service.SetReply(r.Context(), privatedomain.ReplyInput{RoundInput: privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")}, Body: *request.Body})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Delete("/pairs/{pairID}/private-rounds/{roundID}/reply", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		result, err := service.RemoveReply(r.Context(), privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateRound(result))
	})
	api.Post("/pairs/{pairID}/private-rounds/{roundID}/progress", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request privateProgressRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		result, err := service.Progress(r.Context(), privatedomain.ProgressInput{RoundInput: privatedomain.RoundInput{ParticipantID: actor.ID, PairID: chi.URLParam(r, "pairID"), RoundID: chi.URLParam(r, "roundID")}, ClientRequestID: request.ClientRequestID, Action: request.Action, Category: request.Category})
		if err != nil {
			writePrivateError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, projectPrivateView(result))
	})
}

func projectPrivateView(view privatedomain.View) privateConversationProjection {
	result := privateConversationProjection{PairID: view.PairID, ConversationID: view.ConversationID, Category: view.Category, State: view.State, AvailableCategories: view.AvailableCategories, CreatorDisplayName: view.CreatorDisplayName}
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
	result := &privateRoundProjection{ID: round.ID, ConversationID: round.ConversationID, QuestionID: round.QuestionID, QuestionRevisionID: round.QuestionRevisionID, RoundNumber: round.RoundNumber, State: round.State, AskedAt: round.AskedAt, YourAnswer: round.YourAnswer, HasOtherAnswer: round.HasOtherAnswer, RevealViewedAt: round.RevealViewedAt, OtherRevealViewedAt: round.OtherRevealViewedAt, OtherRevealViewed: round.OtherRevealViewed, CanContinue: round.CanContinue}
	result.Question.Text = round.Text
	result.Question.Category = round.Category
	result.Question.Intensity = round.Intensity
	if round.Answers != nil {
		result.Answers = make([]privateAnswerProjection, 0, len(round.Answers))
		for _, answer := range round.Answers {
			result.Answers = append(result.Answers, privateAnswerProjection{ParticipantID: answer.ParticipantID, Body: answer.Body, IsOwner: answer.IsOwner})
		}
	}
	if round.Reactions != nil {
		result.Reactions = make([]privateReactionProjection, 0, len(round.Reactions))
		for _, reaction := range round.Reactions {
			result.Reactions = append(result.Reactions, privateReactionProjection{ParticipantID: reaction.ParticipantID, DisplayName: reaction.DisplayName, Value: reaction.Value, IsOwner: reaction.IsOwner})
		}
	}
	if round.Replies != nil {
		result.Replies = make([]privateReplyProjection, 0, len(round.Replies))
		for _, reply := range round.Replies {
			result.Replies = append(result.Replies, privateReplyProjection{ParticipantID: reply.ParticipantID, DisplayName: reply.DisplayName, Body: reply.Body, IsOwner: reply.IsOwner})
		}
	}
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
	case errors.Is(err, privatedomain.ErrAnswerInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "ANSWER_INVALID", "The answer is invalid.")
	case errors.Is(err, privatedomain.ErrAnswerImmutable):
		writeAPIError(w, r, http.StatusConflict, "ANSWER_IMMUTABLE", "Your answer cannot be changed.")
	case errors.Is(err, privatedomain.ErrQuestionUnavailable):
		writeAPIError(w, r, http.StatusBadRequest, "QUESTION_UNAVAILABLE", "This Private question is unavailable.")
	case errors.Is(err, privatedomain.ErrRevealNotReady):
		writeAPIError(w, r, http.StatusBadRequest, "REVEAL_NOT_READY", "Reveal is not ready yet.")
	case errors.Is(err, privatedomain.ErrReactionInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "REACTION_INVALID", "The reaction is invalid.")
	case errors.Is(err, privatedomain.ErrReplyInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "REPLY_INVALID", "The reply is invalid.")
	case errors.Is(err, privatedomain.ErrProgressionNotReady):
		writeAPIError(w, r, http.StatusConflict, "PROGRESSION_NOT_READY", "This conversation is not ready to continue.")
	case errors.Is(err, privatedomain.ErrProgressionConflict):
		writeAPIError(w, r, http.StatusConflict, "PROGRESSION_ALREADY_STARTED", "This conversation has already continued.")
	default:
		writeAuthInternalError(w, r)
	}
}
