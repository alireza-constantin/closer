package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"slices"
	"strconv"
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

		api.Post("/auth/register", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			if token, present := cookieToken(r); present {
				if _, err := service.ResolveSession(r.Context(), token); err == nil {
					writeAPIError(w, r, http.StatusConflict, "CONFLICT", "An authentication session is already active.")
					return
				} else if !errors.Is(err, auth.ErrUnauthenticated) {
					writeAuthInternalError(w, r)
					return
				}
			}
			var request credentialsRequest
			if !decodeCredentialsRequest(w, r, &request) {
				return
			}
			created, err := service.Register(r.Context(), request.Email, request.Password)
			if err != nil {
				writeCredentialError(w, r, err)
				return
			}
			setSessionCookie(w, created.Token, created.ExpiresAt, isSecureOrigin(origin))
			writeJSON(w, http.StatusCreated, meResponse{Actor: projectActor(created.Actor)})
		})

		api.Post("/auth/upgrade", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			var request credentialsRequest
			if !decodeCredentialsRequest(w, r, &request) {
				return
			}
			token, present := cookieToken(r)
			if !present {
				writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in is required.")
				return
			}
			actor, err := service.Upgrade(r.Context(), token, request.Email, request.Password)
			if err != nil {
				writeCredentialError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, meResponse{Actor: projectActor(actor)})
		})

		api.Post("/auth/login", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			var request credentialsRequest
			if !decodeCredentialsRequest(w, r, &request) {
				return
			}
			currentToken, _ := cookieToken(r)
			created, err := service.Login(r.Context(), request.Email, request.Password, requestClientIP(r, security.TrustedProxyCIDRs), currentToken)
			if err != nil {
				writeCredentialError(w, r, err)
				return
			}
			setSessionCookie(w, created.Token, created.ExpiresAt, isSecureOrigin(origin))
			writeJSON(w, http.StatusOK, meResponse{Actor: projectActor(created.Actor)})
		})

		api.Post("/auth/logout-all", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			token, present := cookieToken(r)
			if !present {
				writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in is required.")
				return
			}
			actor, err := service.ResolveSession(r.Context(), token)
			if err != nil {
				if errors.Is(err, auth.ErrUnauthenticated) {
					writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in is required.")
					return
				}
				writeAuthInternalError(w, r)
				return
			}
			if err := service.RevokeAllSessions(r.Context(), actor); err != nil {
				writeAuthInternalError(w, r)
				return
			}
			clearSessionCookie(w, isSecureOrigin(origin))
			writeJSON(w, http.StatusOK, meResponse{Actor: nil})
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

		api.Post("/admin/login", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			var request credentialsRequest
			if !decodeCredentialsRequest(w, r, &request) {
				return
			}
			currentToken, _ := cookieToken(r)
			created, err := service.AdminLogin(r.Context(), request.Email, request.Password, requestClientIP(r, security.TrustedProxyCIDRs), currentToken)
			if err != nil {
				writeCredentialError(w, r, err)
				return
			}
			setSessionCookie(w, created.Token, created.ExpiresAt, isSecureOrigin(origin))
			writeJSON(w, http.StatusOK, meResponse{Actor: projectActor(created.Actor)})
		})

		api.Post("/admin/logout", func(w http.ResponseWriter, r *http.Request) {
			setPrivateNoStore(w)
			origin := requestOrigin(r)
			if !trustedOrigin(origin, security.TrustedOrigins) {
				writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
				return
			}
			token, present := cookieToken(r)
			if !present {
				writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
				return
			}
			if err := service.LogoutAdmin(r.Context(), token); err != nil {
				if errors.Is(err, auth.ErrUnauthenticated) {
					writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
					return
				}
				writeAuthInternalError(w, r)
				return
			}
			clearSessionCookie(w, isSecureOrigin(origin))
			writeJSON(w, http.StatusOK, meResponse{Actor: nil})
		})
	})
}

type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func decodeCredentialsRequest(w http.ResponseWriter, r *http.Request, value *credentialsRequest) bool {
	if r.Body == nil {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "A JSON request body is required.")
		return false
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The request body is invalid.")
		return false
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The request body is invalid.")
		return false
	}
	if value.Email == "" || value.Password == "" {
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Email and password are required.")
		return false
	}
	return true
}

func writeCredentialError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidInput):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Email or password does not meet the accepted format.")
	case errors.Is(err, auth.ErrEmailInUse):
		writeAPIError(w, r, http.StatusConflict, "EMAIL_IN_USE", "This email is already in use.")
	case errors.Is(err, auth.ErrInvalidCredentials), errors.Is(err, auth.ErrCredentialNotFound):
		writeAPIError(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email or password is incorrect.")
	case errors.Is(err, auth.ErrCannotUpgrade):
		writeAPIError(w, r, http.StatusConflict, "CONFLICT", "This identity cannot be upgraded.")
	case errors.Is(err, auth.ErrUnauthenticated):
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in is required.")
	default:
		var limited auth.RateLimitedError
		if errors.As(err, &limited) {
			seconds := int(math.Ceil(limited.RetryAfter.Seconds()))
			if seconds < 1 {
				seconds = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(seconds))
			writeAPIError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many sign-in attempts. Try again later.")
			return
		}
		writeAuthInternalError(w, r)
	}
}

func requestClientIP(r *http.Request, trustedProxyCIDRs []string) string {
	peerIP := remoteAddressIP(r.RemoteAddr)
	if peerIP == nil {
		return "unknown"
	}
	if !isTrustedProxy(peerIP, trustedProxyCIDRs) {
		return peerIP.String()
	}
	forwardedFor := r.Header.Get("X-Forwarded-For")
	if forwardedFor == "" || len(forwardedFor) > 4096 {
		return peerIP.String()
	}
	forwarded := strings.Split(forwardedFor, ",")
	if len(forwarded) > 16 {
		return peerIP.String()
	}
	for index := len(forwarded) - 1; index >= 0; index-- {
		address := net.ParseIP(strings.TrimSpace(forwarded[index]))
		if address == nil {
			return peerIP.String()
		}
		if !isTrustedProxy(address, trustedProxyCIDRs) {
			return address.String()
		}
	}
	return peerIP.String()
}

func remoteAddressIP(remoteAddress string) net.IP {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err == nil {
		return net.ParseIP(host)
	}
	return net.ParseIP(remoteAddress)
}

func isTrustedProxy(address net.IP, trustedProxyCIDRs []string) bool {
	for _, cidr := range trustedProxyCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil && network.Contains(address) {
			return true
		}
	}
	return false
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
