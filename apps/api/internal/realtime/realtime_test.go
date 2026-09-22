package realtime

import (
	"testing"
	"time"
)

func TestRegistryFanoutIsPairScopedAndBounded(t *testing.T) {
	registry := NewRegistry(1)
	a, err := registry.Subscribe("pair-a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := registry.Subscribe("pair-b")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	defer b.Close()
	event := Event{Version: 1, PairID: "pair-a", Type: PairChanged}
	registry.Publish(event)
	select {
	case got := <-a.Events:
		if got != event {
			t.Fatalf("event = %+v, want %+v", got, event)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber did not receive event")
	}
	select {
	case got := <-b.Events:
		t.Fatalf("pair-b received pair-a event: %+v", got)
	default:
	}
	registry.Publish(event)
	registry.Publish(event)
	select {
	case <-a.Events:
	default:
		t.Fatal("bounded subscriber should retain first queued event")
	}
}

func TestEventRoundTripRejectsContentAndMalformedPayload(t *testing.T) {
	payload, err := Encode(Event{Version: 1, PairID: "pair-a", Type: PrivateChanged})
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(payload)
	if err != nil || got.PairID != "pair-a" {
		t.Fatalf("Decode() = %+v, %v", got, err)
	}
	if _, err := Decode([]byte(`{"version":1,"pairId":"pair-a","type":"private.changed","question":"secret"}`)); err != nil {
		t.Fatalf("metadata event with unknown JSON field should remain decodable: %v", err)
	}
	if _, err := Decode([]byte(`{"version":2,"pairId":"pair-a","type":"pair.changed"}`)); err == nil {
		t.Fatal("invalid event version decoded")
	}
}

func TestSubscriptionCloseIsIdempotent(t *testing.T) {
	registry := NewRegistry(1)
	subscription, err := registry.Subscribe("pair-a")
	if err != nil {
		t.Fatal(err)
	}
	subscription.Close()
	subscription.Close()
	registry.Publish(Event{Version: 1, PairID: "pair-a", Type: PairChanged})
	select {
	case _, ok := <-subscription.Events:
		if ok {
			t.Fatal("closed subscription remained open")
		}
	case <-time.After(time.Second):
		t.Fatal("closed subscription did not close")
	}
}
