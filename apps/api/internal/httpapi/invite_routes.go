package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/go-chi/chi/v5"
)

type inviteLandingResponse struct {
	InviterDisplayName string  `json:"inviterDisplayName"`
	RelationshipType   string  `json:"relationshipType"`
	IntendedPersonName *string `json:"intendedPersonName"`
	ClaimantDisplayName *string `json:"claimantDisplayName,omitempty"`
}
type inviteStateResponse struct {
	State     string     `json:"state"`
	Token     string     `json:"token,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}
type inviteClaimResponse struct {
	PairID          string `json:"pairId"`
	MembershipEraID string `json:"membershipEraId"`
}

func registerInviteRoutes(router chi.Router, authService *auth.Service, participantService *participant.Service, service *invite.Service, security SecurityConfig) {
	router.With(authActorMiddleware(authService)).Get("/invites/{token}", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		landing, err := service.Preview(r.Context(), chi.URLParam(r, "token"))
		if err != nil {
			writeInviteError(w, r, err)
			return
		}
		if landing == nil {
			writeAPIError(w, r, http.StatusNotFound, "INVITE_INVALID", "This invitation is unavailable.")
			return
		}
		var claimantName *string
		if actor, authenticated := actorFromContext(r.Context()); authenticated && actor.Kind != auth.UserKindAdmin {
			claimant, resolveErr := participantService.Resolve(r.Context(), actor)
			if resolveErr != nil { writeParticipantError(w,r,resolveErr); return }
			if claimant != nil { claimantName = &claimant.DisplayName }
		}
		writeJSON(w, http.StatusOK, inviteLandingResponse{InviterDisplayName: landing.InviterDisplayName, RelationshipType: landing.RelationshipType, IntendedPersonName: landing.IntendedPersonName, ClaimantDisplayName: claimantName})
	})
	router.With(authActorMiddleware(authService)).Post("/invites/{token}/redeem", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredConsumerActor(w, r)
		if !ok {
			return
		}
		claimant, err := participantService.Resolve(r.Context(), actor)
		if err != nil {
			writeParticipantError(w, r, err)
			return
		}
		if claimant == nil {
			var request onboardingRequest
			if !decodeDomainJSON(w, r, &request) {
				return
			}
			// Canonical onboarding happens only at the explicit Join POST. Like
			// the TypeScript oracle, onboarding is its own idempotent command and
			// is not distributed into the subsequent claim transaction.
			onboarded, onboardErr := participantService.Onboard(r.Context(), actor, request.DisplayName)
			err = onboardErr
			if err != nil {
				writeParticipantError(w, r, err)
				return
			}
			claimant = &onboarded
		}
		claimed, err := service.Claim(r.Context(), chi.URLParam(r, "token"), claimant.ID)
		if err != nil {
			writeInviteError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, inviteClaimResponse{PairID: claimed.PairID, MembershipEraID: claimed.MembershipEraID})
	})
	router.With(authActorMiddleware(authService)).Get("/pairs/{pairID}/invite", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		pairID := chi.URLParam(r, "pairID")
		expires, err := service.Status(r.Context(), actor.ID, pairID)
		if err != nil {
			writeInviteError(w, r, err)
			return
		}
		if expires == nil {
			writeJSON(w, http.StatusOK, inviteStateResponse{State: "none"})
			return
		}
		if cookie, err := r.Cookie(initialInviteCookieName(pairID)); err == nil {
			landing, previewErr := service.Preview(r.Context(), cookie.Value)
			if previewErr == nil && landing != nil && landing.PairID == pairID {
				writeJSON(w, http.StatusOK, inviteStateResponse{State: "local", Token: cookie.Value, ExpiresAt: expires})
				return
			}
		}
		writeJSON(w, http.StatusOK, inviteStateResponse{State: "active", ExpiresAt: expires})
	})
	router.With(authActorMiddleware(authService)).Post("/pairs/{pairID}/invite", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		pairID := chi.URLParam(r, "pairID")
		issued, err := service.Issue(r.Context(), actor.ID, pairID)
		if err != nil {
			writeInviteError(w, r, err)
			return
		}
		if issued.Token == "" {
			writeJSON(w, http.StatusOK, inviteStateResponse{State: issued.State, ExpiresAt: &issued.ExpiresAt})
			return
		}
		setInitialInviteCookie(w, r, pairID, issued.Token, issued.ExpiresAt, security)
		writeJSON(w, http.StatusCreated, inviteStateResponse{State: "issued", Token: issued.Token, ExpiresAt: &issued.ExpiresAt})
	})
	router.With(authActorMiddleware(authService)).Put("/pairs/{pairID}/invite", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		pairID := chi.URLParam(r, "pairID")
		issued, err := service.Replace(r.Context(), actor.ID, pairID)
		if err != nil {
			writeInviteError(w, r, err)
			return
		}
		setInitialInviteCookie(w, r, pairID, issued.Token, issued.ExpiresAt, security)
		writeJSON(w, http.StatusCreated, inviteStateResponse{State: "issued", Token: issued.Token, ExpiresAt: &issued.ExpiresAt})
	})
	router.With(authActorMiddleware(authService)).Delete("/pairs/{pairID}/invite", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		if !requireTrustedMutationOrigin(w, r, security) {
			return
		}
		actor, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		pairID := chi.URLParam(r, "pairID")
		if err := service.Revoke(r.Context(), actor.ID, pairID); err != nil {
			writeInviteError(w, r, err)
			return
		}
		clearInitialInviteCookie(w, r, pairID, security)
		w.WriteHeader(http.StatusNoContent)
	})
}

func initialInviteCookieName(pairID string) string { return "closer-initial-invite-" + pairID }
func setInitialInviteCookie(w http.ResponseWriter, r *http.Request, pairID, token string, expires time.Time, security SecurityConfig) {
	http.SetCookie(w, &http.Cookie{Name: initialInviteCookieName(pairID), Value: token, Path: "/", HttpOnly: true, Secure: requestIsSecure(r, security), SameSite: http.SameSiteLaxMode, Expires: expires})
}
func clearInitialInviteCookie(w http.ResponseWriter, r *http.Request, pairID string, security SecurityConfig) {
	http.SetCookie(w, &http.Cookie{Name: initialInviteCookieName(pairID), Value: "", Path: "/", HttpOnly: true, Secure: requestIsSecure(r, security), SameSite: http.SameSiteLaxMode, MaxAge: -1})
}
func requestIsSecure(r *http.Request, security SecurityConfig) bool {
	if r.TLS != nil { return true }
	peer := remoteAddressIP(r.RemoteAddr)
	return peer != nil && isTrustedProxy(peer, security.TrustedProxyCIDRs) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func writeInviteError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, invite.ErrForbidden):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
	case errors.Is(err, invite.ErrParticipantRequired):
		writeAPIError(w, r, http.StatusConflict, "PARTICIPANT_REQUIRED", "Complete onboarding first.")
	case errors.Is(err, invite.ErrPairClaimed):
		writeAPIError(w, r, http.StatusConflict, "PAIR_ALREADY_CLAIMED", "The second slot is already connected.")
	case errors.Is(err, invite.ErrSelfClaim), errors.Is(err, invite.ErrUnavailable):
		writeAPIError(w, r, http.StatusConflict, "INVITE_INVALID", "This invitation is unavailable.")
	case errors.Is(err, invite.ErrDuplicatePair):
		writeAPIError(w, r, http.StatusConflict, "DUPLICATE_ACTIVE_PAIR", "These Participants already share an active Pair.")
	default:
		writeAuthInternalError(w, r)
	}
}
