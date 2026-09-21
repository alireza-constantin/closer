package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

type apiErrorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

type apiErrorBody struct {
	Error apiErrorDetail `json:"error"`
}

type actorProjection struct {
	AuthUserID string        `json:"authUserId"`
	Kind       auth.UserKind `json:"kind"`
}

type meResponse struct {
	Actor *actorProjection `json:"actor"`
}

type authenticatedActorKey struct{}

func registerAuthRoutes(router chi.Router, service *auth.Service, security SecurityConfig) {
	router.Route("/api/v1", func(api chi.Router) {
		api.With(authActorMiddleware(service)).Get("/me", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			actor, ok := actorFromContext(r.Context())
			if !ok {
				writeJSON(w, http.StatusOK, meResponse{Actor: nil})
				return
			}
			writeJSON(w, http.StatusOK, meResponse{Actor: projectActor(actor)})
		})

		api.Post("/auth/anonymous", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			created, err := service.CreateAnonymous(r.Context())
			if err != nil {
				writeAuthInternalError(w, r)
				return
			}
			setSessionCookie(w, created.Token, created.ExpiresAt, isSecureOrigin(origin))
			writeJSON(w, http.StatusCreated, meResponse{Actor: projectActor(created.Actor)})
		})

		api.Post("/auth/logout", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			token, _ := cookieToken(r)
			if err := service.RevokeSession(r.Context(), token); err != nil {
				writeAuthInternalError(w, r)
				return
			}
			clearSessionCookie(w, isSecureOrigin(origin))
			writeJSON(w, http.StatusOK, meResponse{Actor: nil})
		})
	})
}

func authActorMiddleware(service *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, present := cookieToken(r)
			if !present {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authenticatedActorKey{}, (*auth.Actor)(nil))))
				return
			}
			actor, err := service.ResolveSession(r.Context(), token)
			if errors.Is(err, auth.ErrUnauthenticated) {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authenticatedActorKey{}, (*auth.Actor)(nil))))
				return
			}
			if err != nil {
				setPrivateNoStore(w)
				writeAuthInternalError(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authenticatedActorKey{}, &actor)))
		})
	}
}

func actorFromContext(ctx context.Context) (auth.Actor, bool) {
	actor, ok := ctx.Value(authenticatedActorKey{}).(*auth.Actor)
	if !ok || actor == nil {
		return auth.Actor{}, false
	}
	return *actor, true
}

func cookieToken(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err != nil {
		return "", false
	}
	return cookie.Value, true
}

func projectActor(actor auth.Actor) *actorProjection {
	return &actorProjection{AuthUserID: actor.AuthUserID, Kind: actor.Kind}
}

func requestOrigin(r *http.Request) string {
	return r.Header.Get("Origin")
}

func trustedOrigin(origin string, allowlist []string) bool {
	return origin != "" && slices.Contains(allowlist, origin)
}

func isSecureOrigin(origin string) bool {
	return strings.HasPrefix(origin, "https://")
}

func setPrivateNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store")
}

func setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt.UTC(),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func writeAPIError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, apiErrorBody{Error: apiErrorDetail{
		Code:      code,
		Message:   message,
		RequestID: requestIDFromContext(r.Context()),
	}})
}

func writeAuthInternalError(w http.ResponseWriter, r *http.Request) {
	writeAPIError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "The request could not be completed.")
}
