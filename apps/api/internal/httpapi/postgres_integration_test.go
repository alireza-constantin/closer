package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresanalytics "github.com/alireza-constantin/closer/apps/api/internal/postgres/adminanalytics"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func TestReadinessEndpointWithGuardedPostgresDatabase(t *testing.T) {
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL integration checks")
		}
		t.Fatalf("load guarded PostgreSQL test URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	defer pool.Close()

	response := httptest.NewRecorder()
	NewRouter(nil, pool).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("readiness status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestAdminAnalyticsHTTPWithGuardedPostgresDatabase(t *testing.T) {
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local closer_test database")
		}
		t.Fatalf("load guarded PostgreSQL test URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	t.Cleanup(pool.Close)

	newID := func() string {
		t.Helper()
		id, err := auth.NewID()
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	adminID, anonID := newID(), newID()
	adminToken, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	anonToken, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	questionID, revisionID := newID(), newID()
	var participantIDs, pairIDs, conversationIDs []string
	var coverageQuestionIDs []string
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		now := time.Now().UTC()
		if _, err := db.Exec(ctx, "INSERT INTO auth_user(id, kind, created_at) VALUES ($1, 'admin', $2), ($3, 'anonymous', $2)", adminID, now, anonID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO admin_user(auth_user_id, created_at) VALUES ($1, $2)", adminID, now); err != nil {
			return err
		}
		for _, item := range []struct{ userID, token string }{{adminID, adminToken}, {anonID, anonToken}} {
			hash := auth.HashSessionToken(item.token)
			if _, err := db.Exec(ctx, "INSERT INTO auth_session(id, auth_user_id, token_hash, created_at, expires_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $4)", newID(), item.userID, hash[:], now, now.Add(time.Hour)); err != nil {
				return err
			}
		}
		for i := 0; i < 3; i++ {
			userID := newID()
			var participantID string
			if _, err := db.Exec(ctx, "INSERT INTO auth_user(id, kind, created_at) VALUES ($1, 'anonymous', $2)", userID, now); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'Analytics fixture') RETURNING id::text", userID).Scan(&participantID); err != nil {
				return err
			}
			participantIDs = append(participantIDs, participantID)
		}
		if _, err := db.Exec(ctx, "INSERT INTO question(id, is_active) VALUES ($1, true)", questionID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO question_revision(id, question_id, text, category, relationship_fit, mode_fit, intensity, revision_number) VALUES ($1, $2, 'Private aggregate fixture', 'fun', 'both', 'both', 'light', 1)", revisionID, questionID); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "UPDATE question SET current_revision_id = $2 WHERE id = $1", questionID, revisionID)
		return err
	}); err != nil {
		t.Fatalf("seed guarded HTTP analytics identity: %v", err)
	}
	t.Cleanup(func() {
		_ = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			for _, conversationID := range conversationIDs {
				if _, err := db.Exec(context.Background(), "DELETE FROM private_question_candidate WHERE conversation_id = $1", conversationID); err != nil {
					t.Errorf("delete analytics fixture candidates: %v", err)
				}
				if _, err := db.Exec(context.Background(), "DELETE FROM private_conversation WHERE id = $1", conversationID); err != nil {
					t.Errorf("delete analytics fixture conversations: %v", err)
				}
			}
			for _, pairID := range pairIDs {
				if _, err := db.Exec(context.Background(), "DELETE FROM pair WHERE id = $1", pairID); err != nil {
					t.Errorf("delete analytics fixture Pairs: %v", err)
				}
			}
			if _, err := db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", questionID); err != nil {
				t.Errorf("clear analytics Question current revision: %v", err)
			}
			if _, err := db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", questionID); err != nil {
				t.Errorf("delete analytics Question revisions: %v", err)
			}
			if _, err := db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", questionID); err != nil {
				t.Errorf("delete analytics Question: %v", err)
			}
			for _, id := range coverageQuestionIDs {
				if _, err := db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", id); err != nil {
					t.Errorf("clear coverage Question current revision: %v", err)
				}
				if _, err := db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", id); err != nil {
					t.Errorf("delete coverage Question revisions: %v", err)
				}
				if _, err := db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", id); err != nil {
					t.Errorf("delete coverage Question: %v", err)
				}
			}
			for _, participantID := range participantIDs {
				var userID string
				_ = db.QueryRow(context.Background(), "DELETE FROM participant WHERE id = $1 RETURNING auth_user_id::text", participantID).Scan(&userID)
				_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id = $1", userID)
			}
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_session WHERE auth_user_id IN ($1, $2)", adminID, anonID)
			_, _ = db.Exec(context.Background(), "DELETE FROM admin_user WHERE auth_user_id = $1", adminID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id IN ($1, $2)", adminID, anonID)
			return nil
		})
	})

	adminStore := postgresauth.NewStore(pool)
	authService := auth.NewServiceWithCredentials(adminStore, adminStore, nil)
	router := NewRouterWithPrivateAndTogetherRealtime(nil, nil, authService, nil, nil, nil, nil, nil, nil, nil, nil, SecurityConfig{}, adminanalytics.NewService(postgresanalytics.NewStore(pool)))
	path := "/api/v1/admin/questions/" + questionID + "/analytics"
	call := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	if got := call("").Code; got != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", got)
	}
	if got := call(anonToken).Code; got != http.StatusForbidden {
		t.Fatalf("consumer status = %d, want 403", got)
	}
	for i := 0; i < 4; i++ {
		pairID, conversationID, firstMembership, secondMembership, eraID := newID(), newID(), newID(), newID(), newID()
		if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			if _, err := db.Exec(ctx, "INSERT INTO pair(id, relationship_type) VALUES ($1, 'partner')", pairID); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "INSERT INTO pair_membership(id, pair_id, participant_id, slot) VALUES ($1, $3, $4, 'first'), ($2, $3, $5, 'second')", firstMembership, secondMembership, pairID, participantIDs[0], participantIDs[1]); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "INSERT INTO pair_membership_era(id, pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3, $4)", eraID, pairID, firstMembership, secondMembership); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "INSERT INTO private_conversation(id, pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1, $2, 'fun', $3, $4)", conversationID, pairID, participantIDs[0], eraID); err != nil {
				return err
			}
			_, err := db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id, state) VALUES ($1, $2, $3, 'unresolved')", conversationID, questionID, revisionID)
			return err
		}); err != nil {
			t.Fatalf("seed Pair fixture: %v", err)
		}
		pairIDs, conversationIDs = append(pairIDs, pairID), append(conversationIDs, conversationID)
	}
	response := call(adminToken)
	if response.Code != http.StatusOK {
		t.Fatalf("Admin analytics status=%d body=%s", response.Code, response.Body.String())
	}
	var serialized map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &serialized); err != nil {
		t.Fatal(err)
	}
	body := strings.ToLower(response.Body.String())
	if !strings.Contains(body, `"status":"insufficient_data"`) {
		t.Fatalf("four-Pair HTTP JSON not suppressed: %s", body)
	}
	for _, hidden := range []string{"numerator", "denominator", "rate", "validoffers", "decisions", "participantid", "membershipid", "pairid", "answer", "reply", "displayname"} {
		if strings.Contains(body, hidden) {
			t.Errorf("HTTP JSON contains forbidden %q: %s", hidden, body)
		}
	}
	_ = serialized
	var before, after int
	_ = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT count(*) FROM participant").Scan(&before)
	})
	_ = call(adminToken)
	_ = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT count(*) FROM participant").Scan(&after)
	})
	if before != after {
		t.Fatalf("Admin analytics created a Participant: before=%d after=%d", before, after)
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var pairID, firstMembership, oldEra string
		if err := db.QueryRow(ctx, "SELECT p.id::text, pm.id::text, e.id::text FROM pair p JOIN pair_membership pm ON pm.pair_id=p.id AND pm.slot='first' JOIN pair_membership_era e ON e.pair_id=p.id WHERE p.id=$1", pairIDs[0]).Scan(&pairID, &firstMembership, &oldEra); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership SET ended_at=now() WHERE pair_id=$1 AND slot='second'", pairID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership_era SET ended_at=now() WHERE id=$1", oldEra); err != nil {
			return err
		}
		var membership, era, conversation string
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1,$2,'second') RETURNING id::text", pairID, participantIDs[2]).Scan(&membership); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1,$2,$3) RETURNING id::text", pairID, firstMembership, membership).Scan(&era); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1,'fun',$2,$3) RETURNING id::text", pairID, participantIDs[0], era).Scan(&conversation); err != nil {
			return err
		}
		conversationIDs = append(conversationIDs, conversation)
		_, err := db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id, state) VALUES ($1,$2,$3,'unresolved')", conversation, questionID, revisionID)
		return err
	}); err != nil {
		t.Fatalf("seed replacement membership era: %v", err)
	}
	if response = call(adminToken); !strings.Contains(strings.ToLower(response.Body.String()), `"status":"insufficient_data"`) {
		t.Fatalf("same-Pair replacement exposed four-Pair bucket: %s", response.Body.String())
	}
	pairID, conversationID, firstMembership, secondMembership, eraID := newID(), newID(), newID(), newID(), newID()
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		if _, err := db.Exec(ctx, "INSERT INTO pair(id, relationship_type) VALUES ($1, 'partner')", pairID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO pair_membership(id, pair_id, participant_id, slot) VALUES ($1, $3, $4, 'first'), ($2, $3, $5, 'second')", firstMembership, secondMembership, pairID, participantIDs[0], participantIDs[1]); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO pair_membership_era(id,pair_id,first_membership_id,second_membership_id) VALUES ($1,$2,$3,$4)", eraID, pairID, firstMembership, secondMembership); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO private_conversation(id,pair_id,category,created_by_participant_id,membership_era_id) VALUES ($1,$2,'fun',$3,$4)", conversationID, pairID, participantIDs[0], eraID); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id,question_id,question_revision_id,state) VALUES ($1,$2,$3,'unresolved')", conversationID, questionID, revisionID)
		return err
	}); err != nil {
		t.Fatalf("seed fifth Pair: %v", err)
	}
	pairIDs, conversationIDs = append(pairIDs, pairID), append(conversationIDs, conversationID)
	response = call(adminToken)
	body = strings.ToLower(response.Body.String())
	if response.Code != http.StatusOK || !strings.Contains(body, `"status":"available"`) || !strings.Contains(body, `"status":"unavailable"`) || strings.Contains(body, "nan") || strings.Contains(body, "infinity") {
		t.Fatalf("five-Pair actual Admin JSON lacks available metric and unavailable zero-denominator rate: %s", body)
	}

	// Exercise the SQL-backed coverage lane at each threshold. The fixture uses a
	// separate lane and includes inactive and withdrawn current revisions that
	// must stay out of its eligible count.
	for i := 0; i < 14; i++ {
		id, revision := newID(), newID()
		active := i == 13 // Active but withdrawn: never eligible.
		if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			if _, err := db.Exec(ctx, "INSERT INTO question(id, is_active) VALUES ($1, $2)", id, active); err != nil {
				return err
			}
			withdrawn := i == 13
			if _, err := db.Exec(ctx, "INSERT INTO question_revision(id, question_id, text, category, relationship_fit, mode_fit, intensity, revision_number, withdrawn_at, withdrawn_reason) VALUES ($1,$2,'Coverage fixture','friendship','friend','private','medium',1,CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN $3 THEN 'test fixture' ELSE NULL END)", revision, id, withdrawn); err != nil {
				return err
			}
			_, err := db.Exec(ctx, "UPDATE question SET current_revision_id=$2 WHERE id=$1", id, revision)
			return err
		}); err != nil {
			t.Fatalf("seed coverage fixture: %v", err)
		}
		coverageQuestionIDs = append(coverageQuestionIDs, id)
	}
	for _, boundary := range []struct {
		count  int
		health string
	}{{0, "critical"}, {5, "critical"}, {6, "low"}, {11, "low"}, {12, "healthy"}} {
		if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			for index, id := range coverageQuestionIDs {
				if _, err := db.Exec(ctx, "UPDATE question SET is_active=$2 WHERE id=$1", id, index < boundary.count); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			t.Fatalf("set coverage threshold %d: %v", boundary.count, err)
		}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics/coverage", nil)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: adminToken})
		coverageResponse := httptest.NewRecorder()
		router.ServeHTTP(coverageResponse, request)
		if coverageResponse.Code != http.StatusOK {
			t.Fatalf("coverage status=%d body=%s", coverageResponse.Code, coverageResponse.Body.String())
		}
		var payload struct {
			Items []struct {
				Category, RelationshipType, Mode string
				Eligible                         int64
				Health                           string
			} `json:"items"`
		}
		if err := json.Unmarshal(coverageResponse.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Items) != 20 {
			t.Fatalf("coverage lanes=%d, want 20", len(payload.Items))
		}
		found := false
		for _, item := range payload.Items {
			if item.Category == "friendship" && item.RelationshipType == "friend" && item.Mode == "private" {
				found = true
				if item.Eligible != int64(boundary.count) || item.Health != boundary.health {
					t.Fatalf("coverage at %d = eligible:%d health:%s", boundary.count, item.Eligible, item.Health)
				}
			}
		}
		if !found {
			t.Fatal("coverage response omitted friendship/friend/private lane")
		}
	}
}
