// Package realtime provides framework-independent, metadata-only invalidation.
package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
)

const Version = 1

var ErrInvalidPairID = errors.New("pair ID is required")

type EventType string

const (
	PairChanged     EventType = "pair.changed"
	PrivateChanged  EventType = "private.changed"
	TogetherChanged EventType = "together.changed"
	PairTerminated  EventType = "pair.terminated"
)

type Event struct {
	Version int       `json:"version"`
	PairID  string    `json:"pairId"`
	Type    EventType `json:"type"`
}

func (e Event) Valid() bool {
	if e.Version != Version || e.PairID == "" {
		return false
	}
	switch e.Type {
	case PairChanged, PrivateChanged, TogetherChanged, PairTerminated:
		return true
	default:
		return false
	}
}

func Encode(e Event) ([]byte, error) {
	if !e.Valid() {
		return nil, errors.New("invalid realtime event")
	}
	return json.Marshal(e)
}

func Decode(payload []byte) (Event, error) {
	var event Event
	if err := json.Unmarshal(payload, &event); err != nil || !event.Valid() {
		return Event{}, errors.New("invalid realtime event")
	}
	return event, nil
}

// Publisher is the only realtime dependency a domain/application service may see.
type Publisher interface {
	Publish(context.Context, Event) error
}

type Subscription struct {
	Events <-chan Event
	close  func()
}

func (s Subscription) Close() {
	if s.close != nil {
		s.close()
	}
}

type Registry struct {
	mu         sync.RWMutex
	byPair     map[string]map[*subscriber]struct{}
	bufferSize int
}

type subscriber struct{ events chan Event }

func NewRegistry(bufferSize int) *Registry {
	if bufferSize < 1 {
		bufferSize = 16
	}
	return &Registry{byPair: make(map[string]map[*subscriber]struct{}), bufferSize: bufferSize}
}

func (r *Registry) Subscribe(pairID string) (Subscription, error) {
	if pairID == "" {
		return Subscription{}, ErrInvalidPairID
	}
	s := &subscriber{events: make(chan Event, r.bufferSize)}
	r.mu.Lock()
	if r.byPair[pairID] == nil {
		r.byPair[pairID] = make(map[*subscriber]struct{})
	}
	r.byPair[pairID][s] = struct{}{}
	r.mu.Unlock()
	return Subscription{Events: s.events, close: func() { r.remove(pairID, s) }}, nil
}

func (r *Registry) remove(pairID string, s *subscriber) {
	r.mu.Lock()
	defer r.mu.Unlock()
	set := r.byPair[pairID]
	if _, ok := set[s]; !ok {
		return
	}
	delete(set, s)
	close(s.events)
	if len(set) == 0 {
		delete(r.byPair, pairID)
	}
}

// Publish never waits for a client. A full buffer drops an invalidation; callers
// must retain focus/refetch recovery because realtime is not correctness-critical.
func (r *Registry) Publish(event Event) {
	if !event.Valid() {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for s := range r.byPair[event.PairID] {
		select {
		case s.events <- event:
		default:
		}
	}
}

func (r *Registry) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for pairID, set := range r.byPair {
		for s := range set {
			close(s.events)
		}
		delete(r.byPair, pairID)
	}
}
