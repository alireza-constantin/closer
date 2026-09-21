package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/go-chi/chi/v5"
)

type onboardingRequest struct {
	DisplayName string `json:"displayName"`
}

type onboardingResponse struct {
	ParticipantID string `json:"participantId"`
	DisplayName   string `json:"displayName"`
}

type createPairRequest struct {
	IntendedPersonName string `json:"intendedPersonName"`
	RelationshipType   string `json:"relationshipType"`
	ClientRequestID    string `json:"clientRequestId,omitempty"`
}

type createPairResponse struct {
	PairID             string  `json:"pairId"`
	IntendedPersonName *string `json:"intendedPersonName"`
}

type updatePairRequest struct {
	IntendedPersonName string `json:"intendedPersonName"`
}

type updatePairResponse struct {
	PairID             string  `json:"pairId"`
	IntendedPersonName *string `json:"intendedPersonName"`
}

type spaceProjection struct {
	PairID                      string  `json:"pairId"`
	RelationshipType            string  `json:"relationshipType"`
	State                       string  `json:"state"`
	OtherParticipantDisplayName *string `json:"otherParticipantDisplayName"`
	IntendedPersonName          *string `json:"intendedPersonName"`
}

type pairEntryResponse struct {
	PairID             string             `json:"pairId"`
	State              string             `json:"state"`
	RelationshipType   string             `json:"relationshipType,omitempty"`
	IntendedPersonName *string            `json:"intendedPersonName,omitempty"`
	Members            []memberProjection `json:"members,omitempty"`
}

type memberProjection struct {
	Slot        string `json:"slot"`
	DisplayName string `json:"displayName"`
}

type pairStatusResponse struct {
	State                       string  `json:"state"`
	OtherParticipantDisplayName *string `json:"otherParticipantDisplayName,omitempty"`
}

func registerParticipantPairRoutes(
	router chi.Router,
	authService *auth.Service,
	participantService *participant.Service,
	pairService *pair.Service,
	security SecurityConfig,
) {
	api := router
	api.With(authActorMiddleware(authService)).Post("/onboarding", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredConsumerActor(w, r)
		if !ok {
			return
		}
		var request onboardingRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		created, err := participantService.Onboard(r.Context(), actor, request.DisplayName)
		if err != nil {
			writeParticipantError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, onboardingResponse{ParticipantID: created.ID, DisplayName: created.DisplayName})
	})

	api.With(authActorMiddleware(authService)).Get("/pairs", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		spaces, err := pairService.ListSpaces(r.Context(), participantView.ID)
		if err != nil {
			writePairError(w, r, err)
			return
		}
		projection := make([]spaceProjection, 0, len(spaces))
		for _, space := range spaces {
			projection = append(projection, spaceProjection{
				PairID: space.PairID, RelationshipType: string(space.RelationshipType), State: space.State,
				OtherParticipantDisplayName: space.OtherParticipantDisplayName,
				IntendedPersonName:          space.IntendedPersonName,
			})
		}
		writeJSON(w, http.StatusOK, projection)
	})

	api.With(authActorMiddleware(authService)).Post("/pairs", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request createPairRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		created, err := pairService.Create(r.Context(), pair.CreateInput{
			ParticipantID: participantView.ID, IntendedPersonName: request.IntendedPersonName,
			RelationshipType: request.RelationshipType, ClientRequestID: request.ClientRequestID,
		})
		if err != nil {
			writePairError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, createPairResponse{PairID: created.ID, IntendedPersonName: created.IntendedPersonName})
	})

	api.With(authActorMiddleware(authService)).Get("/pairs/{pairID}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		entry, err := pairService.GetEntry(r.Context(), participantView.ID, chi.URLParam(r, "pairID"))
		if err != nil {
			writePairError(w, r, err)
			return
		}
		response := pairEntryResponse{
			PairID: entry.PairID, State: entry.State,
			RelationshipType: string(entry.RelationshipType), IntendedPersonName: entry.IntendedPersonName,
		}
		for _, member := range entry.Members {
			response.Members = append(response.Members, memberProjection{Slot: string(member.Slot), DisplayName: member.DisplayName})
		}
		writeJSON(w, http.StatusOK, response)
	})

	api.With(authActorMiddleware(authService)).Get("/pairs/{pairID}/status", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		access, err := pairService.GetAccess(r.Context(), participantView.ID, chi.URLParam(r, "pairID"))
		if err != nil {
			writePairError(w, r, err)
			return
		}
		if access.OtherParticipantID == nil {
			writeJSON(w, http.StatusOK, pairStatusResponse{State: "waiting"})
			return
		}
		writeJSON(w, http.StatusOK, pairStatusResponse{
			State: "connected", OtherParticipantDisplayName: access.OtherParticipantDisplayName,
		})
	})

	api.With(authActorMiddleware(authService)).Patch("/pairs/{pairID}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		var request updatePairRequest
		if !decodeDomainJSON(w, r, &request) {
			return
		}
		updated, err := pairService.UpdateIntendedPersonName(
			r.Context(), participantView.ID, chi.URLParam(r, "pairID"), request.IntendedPersonName,
		)
		if err != nil {
			writePairError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, updatePairResponse{PairID: updated.ID, IntendedPersonName: updated.IntendedPersonName})
	})
}

func requiredConsumerActor(w http.ResponseWriter, r *http.Request) (auth.Actor, bool) {
	actor, ok := actorFromContext(r.Context())
	if !ok {
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in is required.")
		return auth.Actor{}, false
	}
	if actor.Kind == auth.UserKindAdmin {
		writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Admin identities cannot onboard as Participants.")
		return auth.Actor{}, false
	}
	return actor, true
}

func requiredActorParticipant(w http.ResponseWriter, r *http.Request, service *participant.Service) (participant.Participant, bool) {
	actor, ok := requiredConsumerActor(w, r)
	if !ok {
		return participant.Participant{}, false
	}
	resolved, err := service.Resolve(r.Context(), actor)
	if err != nil {
		writeParticipantError(w, r, err)
		return participant.Participant{}, false
	}
	if resolved == nil {
		writeAPIError(w, r, http.StatusConflict, "PARTICIPANT_REQUIRED", "Complete onboarding first.")
		return participant.Participant{}, false
	}
	return *resolved, true
}

func requireTrustedMutationOrigin(w http.ResponseWriter, r *http.Request, security SecurityConfig) bool {
	if trustedOrigin(requestOrigin(r), security.TrustedOrigins) {
		return true
	}
	writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
	return false
}

func decodeDomainJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The request body is invalid.")
		return false
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The request body is invalid.")
		return false
	}
	return true
}

func writeParticipantError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, participant.ErrDisplayNameInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Display name must be 1 to 40 characters.")
	case errors.Is(err, participant.ErrAdminNotAllowed):
		writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Admin identities cannot have a Participant.")
	default:
		writeAuthInternalError(w, r)
	}
}

func writePairError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, pair.ErrParticipantRequired):
		writeAPIError(w, r, http.StatusConflict, "PARTICIPANT_REQUIRED", "Complete onboarding first.")
	case errors.Is(err, pair.ErrParticipantNotFound):
		writeAPIError(w, r, http.StatusConflict, "PARTICIPANT_REQUIRED", "Complete onboarding first.")
	case errors.Is(err, pair.ErrIntendedPersonNameInvalid), errors.Is(err, pair.ErrRelationshipTypeInvalid), errors.Is(err, pair.ErrCreationRequestInvalid):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Pair details are invalid.")
	case errors.Is(err, pair.ErrPairNotFound):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
	case errors.Is(err, pair.ErrPairAlreadyClaimed):
		writeAPIError(w, r, http.StatusConflict, "PAIR_ALREADY_CLAIMED", "The second slot is already connected.")
	case errors.Is(err, pair.ErrCreationRequestConflict):
		writeAPIError(w, r, http.StatusConflict, "CONFLICT", "The Pair creation request cannot be replayed by this Participant.")
	default:
		writeAuthInternalError(w, r)
	}
}
