package httpapi

import (
	"bufio"
	"bytes"
	"testing"

	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

func TestWriteRealtimeEventUsesNamedMetadataOnlySSE(t *testing.T) {
	var output bytes.Buffer
	writer := bufio.NewWriter(&output)
	writeRealtimeEvent(writer, realtime.Event{
		Version: realtime.Version, PairID: "pair-id", Type: realtime.PairTerminated,
	})
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	want := "event: pair.terminated\ndata: {\"version\":1,\"pairId\":\"pair-id\",\"type\":\"pair.terminated\"}\n\n"
	if output.String() != want {
		t.Fatalf("SSE event = %q, want %q", output.String(), want)
	}
}
