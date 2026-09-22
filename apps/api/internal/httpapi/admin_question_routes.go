package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/go-chi/chi/v5"
)

type questionFieldsRequest struct{ Text, Category, RelationshipFit, ModeFit, Intensity string }
type questionMutationResponse struct {
	Question question.Question `json:"question"`
}

func registerAdminQuestionRoutes(router chi.Router, authService *auth.Service, service *question.Service, security SecurityConfig) {
	router.Route("/admin/questions", func(admin chi.Router) {
		admin.Get("/", func(w http.ResponseWriter, r *http.Request) {
			if _, ok := requireAdminActor(w, r, authService); !ok {
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
			if limit < 1 || limit > 100 {
				limit = 25
			}
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			if page < 1 {
				page = 1
			}
			items, err := service.List(r.Context(), question.ListFilter{Search: r.URL.Query().Get("search"), Category: r.URL.Query().Get("category"), Intensity: r.URL.Query().Get("intensity"), RelationshipFit: r.URL.Query().Get("relationshipFit"), ModeFit: r.URL.Query().Get("modeFit"), Limit: int32(limit), Offset: int32((page - 1) * limit)})
			if err != nil {
				writeAuthInternalError(w, r)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": limit})
		})
		admin.Post("/", func(w http.ResponseWriter, r *http.Request) {
			actor, ok := requireAdminMutation(w, r, authService, security)
			if !ok {
				return
			}
			var request questionFieldsRequest
			if !decodeDomainJSON(w, r, &request) {
				return
			}
			created, err := service.Create(r.Context(), fieldsFromRequest(request), actor.AuthUserID)
			if err != nil {
				writeQuestionError(w, r, err)
				return
			}
			writeJSON(w, http.StatusCreated, questionMutationResponse{Question: created})
		})
		admin.Get("/{questionID}", func(w http.ResponseWriter, r *http.Request) {
			if _, ok := requireAdminActor(w, r, authService); !ok {
				return
			}
			value, err := service.Get(r.Context(), chi.URLParam(r, "questionID"))
			if err != nil {
				writeQuestionError(w, r, err)
				return
			}
			revisions, err := service.ListRevisions(r.Context(), value.ID)
			if err != nil {
				writeAuthInternalError(w, r)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"question": value, "revisions": revisions})
		})
		admin.Post("/{questionID}/revisions", func(w http.ResponseWriter, r *http.Request) {
			actor, ok := requireAdminMutation(w, r, authService, security)
			if !ok {
				return
			}
			var request struct {
				questionFieldsRequest
				ExpectedCurrentRevisionID string `json:"expectedCurrentRevisionId"`
			}
			if !decodeDomainJSON(w, r, &request) {
				return
			}
			value, err := service.Edit(r.Context(), chi.URLParam(r, "questionID"), fieldsFromRequest(request.questionFieldsRequest), request.ExpectedCurrentRevisionID, actor.AuthUserID)
			if err != nil {
				writeQuestionError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, questionMutationResponse{Question: value})
		})
		admin.Post("/{questionID}/revisions/{revisionID}/restore", func(w http.ResponseWriter, r *http.Request) {
			actor, ok := requireAdminMutation(w, r, authService, security)
			if !ok {
				return
			}
			var request struct {
				ExpectedCurrentRevisionID string `json:"expectedCurrentRevisionId"`
			}
			if !decodeDomainJSON(w, r, &request) {
				return
			}
			value, err := service.Restore(r.Context(), chi.URLParam(r, "questionID"), chi.URLParam(r, "revisionID"), request.ExpectedCurrentRevisionID, actor.AuthUserID)
			if err != nil {
				writeQuestionError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, questionMutationResponse{Question: value})
		})
		for _, action := range []string{"activate", "reactivate", "deactivate"} {
			action := action
			admin.Post("/{questionID}/"+action, func(w http.ResponseWriter, r *http.Request) {
				actor, ok := requireAdminMutation(w, r, authService, security)
				if !ok {
					return
				}
				value, err := service.SetActivity(r.Context(), chi.URLParam(r, "questionID"), action, actor.AuthUserID)
				if err != nil {
					writeQuestionError(w, r, err)
					return
				}
				writeJSON(w, http.StatusOK, questionMutationResponse{Question: value})
			})
		}
		admin.Post("/{questionID}/revisions/{revisionID}/withdraw", func(w http.ResponseWriter, r *http.Request) {
			actor, ok := requireAdminMutation(w, r, authService, security)
			if !ok {
				return
			}
			var request struct {
				Reason string `json:"reason"`
			}
			if !decodeDomainJSON(w, r, &request) {
				return
			}
			value, err := service.Withdraw(r.Context(), chi.URLParam(r, "questionID"), chi.URLParam(r, "revisionID"), request.Reason, actor.AuthUserID)
			if err != nil {
				writeQuestionError(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, value)
		})
	})
}

func fieldsFromRequest(value questionFieldsRequest) question.RevisionFields {
	return question.RevisionFields{Text: value.Text, Category: value.Category, RelationshipFit: value.RelationshipFit, ModeFit: value.ModeFit, Intensity: value.Intensity}
}

func requireAdminActor(w http.ResponseWriter, r *http.Request, service *auth.Service) (auth.Actor, bool) {
	token, present := cookieToken(r)
	if !present {
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
		return auth.Actor{}, false
	}
	actor, err := service.RequireAdminSession(r.Context(), token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
		return auth.Actor{}, false
	}
	return actor, true
}
func requireAdminMutation(w http.ResponseWriter, r *http.Request, service *auth.Service, security SecurityConfig) (auth.Actor, bool) {
	if !trustedOrigin(requestOrigin(r), security.TrustedOrigins) {
		writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Request origin is not allowed.")
		return auth.Actor{}, false
	}
	return requireAdminActor(w, r, service)
}

func writeQuestionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, question.ErrConflict):
		writeAPIError(w, r, http.StatusConflict, "CONFLICT", "This Question changed. Review the latest revision before trying again.")
	case errors.Is(err, question.ErrInvalidInput), errors.Is(err, question.ErrWithdrawalReason):
		writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Question details are invalid.")
	case errors.Is(err, question.ErrCurrentWithdrawn):
		writeAPIError(w, r, http.StatusConflict, "CURRENT_REVISION_WITHDRAWN", "Create or restore a safe revision before activating this Question.")
	case errors.Is(err, question.ErrRevisionNotFound):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Question revision not found.")
	case errors.Is(err, question.ErrNotFound):
		writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Question not found.")
	default:
		writeAuthInternalError(w, r)
	}
}
