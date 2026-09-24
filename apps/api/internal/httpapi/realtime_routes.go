package httpapi

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/go-chi/chi/v5"
)

func registerRealtimeRoutes(router chi.Router, authService *auth.Service, participantService *participant.Service, pairService *pair.Service, registry *realtime.Registry) {
	router.With(authActorMiddleware(authService)).Get("/pairs/{pairID}/events", func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w)
		participantView, ok := requiredActorParticipant(w, r, participantService)
		if !ok {
			return
		}
		pairID := chi.URLParam(r, "pairID")
		if _, err := pairService.GetAccess(r.Context(), participantView.ID, pairID); err != nil {
			if !errors.Is(err, pair.ErrPairNotFound) {
				writeAuthInternalError(w, r)
				return
			}
			if writeTerminatedPairEvent(w, r, pairService, participantView.ID, pairID) {
				return
			}
			writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
			return
		}
		subscription, err := registry.Subscribe(pairID)
		if err != nil {
			writeAPIError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "The Pair ID is invalid.")
			return
		}
		defer subscription.Close()
		// Subscribe before rechecking active access. A termination before the
		// subscription is detected here; a later one is delivered by the registry.
		if _, err := pairService.GetAccess(r.Context(), participantView.ID, pairID); err != nil {
			if !errors.Is(err, pair.ErrPairNotFound) {
				writeAuthInternalError(w, r)
				return
			}
			if writeTerminatedPairEvent(w, r, pairService, participantView.ID, pairID) {
				return
			}
			writeAPIError(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeAuthInternalError(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-store")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()
		writer := bufio.NewWriter(w)
		heartbeat := time.NewTicker(20 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-heartbeat.C:
				_, _ = writer.WriteString(": heartbeat\n\n")
				_ = writer.Flush()
				flusher.Flush()
			case event, open := <-subscription.Events:
				if !open {
					return
				}
				// Membership may end while an SSE connection is open. Recheck
				// current authority before delivering each invalidation so a
				// replaced former member cannot observe later Pair activity.
				if _, err := pairService.GetAccess(r.Context(), participantView.ID, pairID); err != nil {
					if errors.Is(err, pair.ErrPairNotFound) && writeTerminatedPairEvent(w, r, pairService, participantView.ID, pairID) {
						return
					}
					return
				}
				writeRealtimeEvent(writer, event)
				_ = writer.Flush()
				flusher.Flush()
				if event.Type == realtime.PairTerminated {
					return
				}
			}
		}
	})
}

func writeTerminatedPairEvent(w http.ResponseWriter, r *http.Request, pairService *pair.Service, participantID, pairID string) bool {
	entry, err := pairService.GetEntry(r.Context(), participantID, pairID)
	if err != nil || entry.State != "terminated" {
		return false
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAuthInternalError(w, r)
		return true
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	writer := bufio.NewWriter(w)
	writeRealtimeEvent(writer, realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairTerminated})
	_ = writer.Flush()
	flusher.Flush()
	return true
}

func writeRealtimeEvent(writer *bufio.Writer, event realtime.Event) {
	payload, _ := json.Marshal(event)
	_, _ = writer.WriteString("event: ")
	_, _ = writer.WriteString(string(event.Type))
	_, _ = writer.WriteString("\ndata: ")
	_, _ = writer.Write(payload)
	_, _ = writer.WriteString("\n\n")
}
