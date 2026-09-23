package httpapi

import (
	"math"
	"net/http"

	"github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

type rateResponse struct {
	Status      string   `json:"status"`
	Numerator   *int64   `json:"numerator,omitempty"`
	Denominator *int64   `json:"denominator,omitempty"`
	Rate        *float64 `json:"rate,omitempty"`
}

type privateAnalyticsResponse struct {
	Status       string        `json:"status"`
	ValidOffers  *int64        `json:"validOffers,omitempty"`
	Decisions    *int64        `json:"decisions,omitempty"`
	DecisionRate *rateResponse `json:"decisionRate,omitempty"`
	AskRate      *rateResponse `json:"askRate,omitempty"`
	SkipRate     *rateResponse `json:"skipRate,omitempty"`
	LikeRate     *rateResponse `json:"likeRate,omitempty"`
}

type togetherAnalyticsResponse struct {
	Status       string        `json:"status"`
	Shown        *int64        `json:"shown,omitempty"`
	Decisions    *int64        `json:"decisions,omitempty"`
	ContinueRate *rateResponse `json:"continueRate,omitempty"`
	SkipRate     *rateResponse `json:"skipRate,omitempty"`
	LikeRate     *rateResponse `json:"likeRate,omitempty"`
}

type questionAnalyticsResponse struct {
	QuestionID             string                    `json:"questionId"`
	RevisionScope          string                    `json:"revisionScope"`
	SelectedRevisionID     *string                   `json:"selectedRevisionId"`
	SelectedRevisionNumber *int32                    `json:"selectedRevisionNumber"`
	Private                privateAnalyticsResponse  `json:"private"`
	Together               togetherAnalyticsResponse `json:"together"`
}

type coverageResponse struct {
	Items []coverageItem `json:"items"`
}

type coverageItem struct {
	Category         string `json:"category"`
	RelationshipType string `json:"relationshipType"`
	Mode             string `json:"mode"`
	Eligible         int64  `json:"eligible"`
	Health           string `json:"health"`
	Intensity        struct {
		Light  int64 `json:"light"`
		Medium int64 `json:"medium"`
		Deep   int64 `json:"deep"`
	} `json:"intensity"`
}

func registerAdminAnalyticsRoutes(router chi.Router, authService *auth.Service, service *adminanalytics.Service) {
	router.Route("/admin", func(admin chi.Router) {
		admin.Get("/questions/{questionID}/analytics", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "private, no-store")
			if !requireAnalyticsAdmin(w, r, authService) {
				return
			}
			query := r.URL.Query()
			scope := adminanalytics.ScopeCurrent
			if value := query.Get("revisionScope"); value != "" {
				scope = adminanalytics.Scope(value)
			}
			revisionID := query.Get("revisionId")
			if (scope != adminanalytics.ScopeCurrent && scope != adminanalytics.ScopeAll && scope != adminanalytics.ScopeRevision) ||
				(scope == adminanalytics.ScopeRevision && revisionID == "") ||
				(scope != adminanalytics.ScopeRevision && revisionID != "") {
				writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The analytics revision scope is invalid.")
				return
			}
			result, err := service.QuestionAnalytics(r.Context(), chi.URLParam(r, "questionID"), scope, revisionID)
			if err != nil {
				if err == adminanalytics.ErrNotFound {
					writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Question or revision not found.")
				} else {
					writeAuthInternalError(w, r)
				}
				return
			}
			response := questionAnalyticsResponse{QuestionID: result.QuestionID, RevisionScope: string(result.RevisionScope), Private: privateProjection(result.Private), Together: togetherProjection(result.Together)}
			if result.SelectedRevisionID != "" {
				response.SelectedRevisionID = &result.SelectedRevisionID
				number := result.SelectedRevisionNumber
				response.SelectedRevisionNumber = &number
			}
			writeJSON(w, http.StatusOK, response)
		})
		admin.Get("/analytics/coverage", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "private, no-store")
			if !requireAnalyticsAdmin(w, r, authService) {
				return
			}
			lanes, err := service.Coverage(r.Context())
			if err != nil {
				writeAuthInternalError(w, r)
				return
			}
			response := coverageResponse{Items: make([]coverageItem, 0, len(lanes))}
			for _, lane := range lanes {
				item := coverageItem{Category: lane.Category, RelationshipType: lane.RelationshipType, Mode: lane.Mode, Eligible: lane.Eligible, Health: adminanalytics.CoverageHealth(lane.Eligible)}
				item.Intensity.Light, item.Intensity.Medium, item.Intensity.Deep = lane.Light, lane.Medium, lane.Deep
				response.Items = append(response.Items, item)
			}
			writeJSON(w, http.StatusOK, response)
		})
	})
}

func privateProjection(aggregate *adminanalytics.PrivateAggregate) privateAnalyticsResponse {
	if aggregate == nil {
		return privateAnalyticsResponse{Status: "insufficient_data"}
	}
	return privateAnalyticsResponse{
		Status: "available", ValidOffers: int64ptr(aggregate.ValidOffers), Decisions: int64ptr(aggregate.Decisions),
		DecisionRate: ratio(aggregate.Decisions, aggregate.ValidOffers),
		AskRate:      ratio(aggregate.Asked, aggregate.Decisions), SkipRate: ratio(aggregate.Skipped, aggregate.Decisions),
		LikeRate: ratio(aggregate.LikedDecisions, aggregate.Decisions),
	}
}

func togetherProjection(aggregate *adminanalytics.TogetherAggregate) togetherAnalyticsResponse {
	if aggregate == nil {
		return togetherAnalyticsResponse{Status: "insufficient_data"}
	}
	return togetherAnalyticsResponse{
		Status: "available", Shown: int64ptr(aggregate.Shown), Decisions: int64ptr(aggregate.Decisions),
		ContinueRate: ratio(aggregate.Continued, aggregate.Decisions), SkipRate: ratio(aggregate.Skipped, aggregate.Decisions),
		LikeRate: ratio(aggregate.LikedDecisions, aggregate.Decisions),
	}
}

func ratio(numerator, denominator int64) *rateResponse {
	if denominator == 0 {
		return &rateResponse{Status: "unavailable"}
	}
	value := float64(numerator) / float64(denominator)
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return &rateResponse{Status: "unavailable"}
	}
	n, d := numerator, denominator
	return &rateResponse{Status: "available", Numerator: &n, Denominator: &d, Rate: &value}
}

func int64ptr(value int64) *int64 { return &value }

func requireAnalyticsAdmin(w http.ResponseWriter, r *http.Request, service *auth.Service) bool {
	token, present := cookieToken(r)
	if !present {
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
		return false
	}
	actor, err := service.ResolveSession(r.Context(), token)
	if err != nil {
		writeAPIError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Admin sign-in is required.")
		return false
	}
	if actor.Kind != auth.UserKindAdmin {
		writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Admin authorization is required.")
		return false
	}
	if _, err := service.RequireAdminSession(r.Context(), token); err != nil {
		writeAPIError(w, r, http.StatusForbidden, "FORBIDDEN", "Admin authorization is required.")
		return false
	}
	return true
}
