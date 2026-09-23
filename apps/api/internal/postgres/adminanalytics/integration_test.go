package adminanalytics

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	domain "github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func TestQuestionAnalyticsAggregatesPinnedRevisionsAndDistinctPairs(t *testing.T) {
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

	store := NewStore(pool)
	baselineCoverage, err := store.Coverage(ctx)
	if err != nil {
		t.Fatalf("read baseline Question coverage: %v", err)
	}
	baseline := make(map[string]domain.CoverageLane, len(baselineCoverage))
	for _, lane := range baselineCoverage {
		baseline[lane.Category+"/"+lane.RelationshipType+"/"+lane.Mode] = lane
	}

	var authIDs, participantIDs, pairIDs []string
	var questionID, revisionOne, revisionTwo string
	questionIDs := make([]string, 0, 3)
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		for _, name := range []string{"Analytics A", "Analytics B", "Analytics C"} {
			var authID, participantID string
			if err := db.QueryRow(ctx, "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&authID); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, $2) RETURNING id::text", authID, name).Scan(&participantID); err != nil {
				return err
			}
			authIDs, participantIDs = append(authIDs, authID), append(participantIDs, participantID)
		}
		if err := db.QueryRow(ctx, "INSERT INTO question DEFAULT VALUES RETURNING id::text").Scan(&questionID); err != nil {
			return err
		}
		questionIDs = append(questionIDs, questionID)
		if err := db.QueryRow(ctx, "INSERT INTO question_revision(question_id, text, category, relationship_fit, mode_fit, intensity, revision_number) VALUES ($1, 'Analytics R1', 'fun', 'both', 'both', 'light', 1) RETURNING id::text", questionID).Scan(&revisionOne); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO question_revision(question_id, text, category, relationship_fit, mode_fit, intensity, revision_number) VALUES ($1, 'Analytics R2', 'relationship', 'partner', 'together', 'deep', 2) RETURNING id::text", questionID).Scan(&revisionTwo); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO question_revision(question_id, text, category, relationship_fit, mode_fit, intensity, revision_number, withdrawn_at, withdrawn_reason) VALUES ($1, 'Withdrawn historical revision', 'relationship', 'partner', 'together', 'light', 3, now(), 'test fixture')", questionID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE question SET current_revision_id = $2, is_active = true WHERE id = $1", questionID, revisionTwo); err != nil {
			return err
		}
		for _, fixture := range []struct{ active, withdrawn bool }{{true, true}, {false, false}} {
			var id, revision string
			if err := db.QueryRow(ctx, "INSERT INTO question(is_active) VALUES ($1) RETURNING id::text", fixture.active).Scan(&id); err != nil {
				return err
			}
			questionIDs = append(questionIDs, id)
			if err := db.QueryRow(ctx, "INSERT INTO question_revision(question_id, text, category, relationship_fit, mode_fit, intensity, revision_number, withdrawn_at, withdrawn_reason) VALUES ($1, 'Coverage eligibility fixture', 'relationship', 'partner', 'together', 'medium', 1, CASE WHEN $2 THEN now() ELSE NULL END, CASE WHEN $2 THEN 'test fixture' ELSE NULL END) RETURNING id::text", id, fixture.withdrawn).Scan(&revision); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "UPDATE question SET current_revision_id = $2 WHERE id = $1", id, revision); err != nil {
				return err
			}
		}

		for i := 0; i < 5; i++ {
			var pairID, firstMembership, secondMembership, eraID, conversationID string
			if err := db.QueryRow(ctx, "INSERT INTO pair(relationship_type) VALUES ('partner') RETURNING id::text").Scan(&pairID); err != nil {
				return err
			}
			pairIDs = append(pairIDs, pairID)
			if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'first') RETURNING id::text", pairID, participantIDs[0]).Scan(&firstMembership); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", pairID, participantIDs[1]).Scan(&secondMembership); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3) RETURNING id::text", pairID, firstMembership, secondMembership).Scan(&eraID); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1, 'fun', $2, $3) RETURNING id::text", pairID, participantIDs[0], eraID).Scan(&conversationID); err != nil {
				return err
			}
			state := []string{"unresolved", "asked", "skipped", "asked", "invalidated"}[i]
			liked := i == 1 || i == 2 || i == 3
			if _, err := db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id, state, resolved_at, liked_at, skip_request_id) VALUES ($1, $2, $3, $4::private_question_candidate_state, CASE WHEN $4 = 'unresolved' THEN NULL ELSE now() END, CASE WHEN $5 THEN now() ELSE NULL END, CASE WHEN $4 = 'skipped' THEN gen_random_uuid() ELSE NULL END)", conversationID, questionID, revisionOne, state, liked); err != nil {
				return err
			}
			if state == "skipped" {
				for retry := 0; retry < 2; retry++ {
					if _, err := db.Exec(ctx, "UPDATE private_question_candidate SET state = 'skipped', resolved_at = COALESCE(resolved_at, now()) WHERE conversation_id = $1 AND question_id = $2", conversationID, questionID); err != nil {
						return err
					}
				}
			}
			if i < 4 {
				var sessionID string
				if err := db.QueryRow(ctx, "INSERT INTO together_session(pair_id, membership_era_id, category, started_by_participant_id, selection_seed, ended_at) VALUES ($1, $2, 'fun', $3, 'admin-analytics', CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id::text", pairID, eraID, participantIDs[0], i == 0).Scan(&sessionID); err != nil {
					return err
				}
				advanced := i > 0
				skipped := i == 2
				liked = i == 1 || i == 2
				if _, err := db.Exec(ctx, "INSERT INTO together_session_question(session_id, question_id, question_revision_id, position, advanced_at, skipped_at, liked_at) VALUES ($1, $2, $3, 1, CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $5 THEN now() ELSE NULL END, CASE WHEN $6 THEN now() ELSE NULL END)", sessionID, questionID, revisionOne, advanced, skipped, liked); err != nil {
					return err
				}
				if i == 2 {
					for retry := 0; retry < 2; retry++ {
						if _, err := db.Exec(ctx, "UPDATE together_session_question SET advanced_at = COALESCE(advanced_at, now()) WHERE session_id = $1 AND question_id = $2", sessionID, questionID); err != nil {
							return err
						}
					}
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("seed analytics fixture: %v", err)
	}

	t.Cleanup(func() {
		_ = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			for _, id := range pairIDs {
				_, _ = db.Exec(context.Background(), "DELETE FROM private_conversation WHERE pair_id = $1", id)
				_, _ = db.Exec(context.Background(), "DELETE FROM together_session WHERE pair_id = $1", id)
				_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id = $1", id)
			}
			for _, id := range questionIDs {
				_, _ = db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", id)
				_, _ = db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", id)
				_, _ = db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", id)
			}
			for _, id := range participantIDs {
				_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id = $1", id)
			}
			for _, id := range authIDs {
				_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id = $1", id)
			}
			return nil
		})
	})

	current, err := store.SelectRevision(ctx, questionID, domain.ScopeCurrent, "")
	if err != nil {
		t.Fatal(err)
	}
	if current.SelectedRevisionID != revisionTwo {
		t.Fatalf("current revision = %s, want R2", current.SelectedRevisionID)
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, err := db.Exec(ctx, "UPDATE private_question_candidate SET liked_at = NULL WHERE question_id = $1 AND question_revision_id = $2 AND state = 'asked' AND conversation_id IN (SELECT pc.id FROM private_conversation pc WHERE pc.pair_id = $3)", questionID, revisionOne, pairIDs[3])
		return err
	}); err != nil {
		t.Fatalf("simulate final unlike state: %v", err)
	}
	if got, err := store.PrivateAggregate(ctx, questionID, current.SelectedRevisionID, domain.ScopeCurrent); err != nil || got != nil {
		t.Fatalf("current Private R2 aggregate = %+v, err=%v; want suppressed/no activity", got, err)
	}
	if got, err := store.TogetherAggregate(ctx, questionID, current.SelectedRevisionID, domain.ScopeCurrent); err != nil || got != nil {
		t.Fatalf("current Together R2 aggregate = %+v, err=%v; want suppressed/no activity", got, err)
	}

	if got, err := store.PrivateAggregate(ctx, questionID, revisionOne, domain.ScopeRevision); err != nil || got != nil {
		t.Fatalf("four-Pair Private bucket = %+v, err=%v; want insufficient data", got, err)
	}
	if got, err := store.TogetherAggregate(ctx, questionID, revisionOne, domain.ScopeRevision); err != nil || got != nil {
		t.Fatalf("four-Pair Together bucket = %+v, err=%v; want insufficient data", got, err)
	}

	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var pairID, firstMembership, replacementMembership, eraID, conversationID, oldEraID string
		if err := db.QueryRow(ctx, "SELECT p.id::text, pm.id::text, e.id::text FROM pair p JOIN pair_membership pm ON pm.pair_id = p.id AND pm.slot = 'first' JOIN pair_membership_era e ON e.pair_id = p.id WHERE p.id = $1", pairIDs[0]).Scan(&pairID, &firstMembership, &oldEraID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership SET ended_at = now() WHERE pair_id = $1 AND slot = 'second'", pairID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership_era SET ended_at = now() WHERE id = $1", oldEraID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", pairID, participantIDs[2]).Scan(&replacementMembership); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3) RETURNING id::text", pairID, firstMembership, replacementMembership).Scan(&eraID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1, 'deep', $2, $3) RETURNING id::text", pairID, participantIDs[0], eraID).Scan(&conversationID); err != nil {
			return err
		}
		_, err = db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id, state) VALUES ($1, $2, $3, 'unresolved')", conversationID, questionID, revisionOne)
		return err
	}); err != nil {
		t.Fatalf("add replacement-era activity: %v", err)
	}
	if got, err := store.PrivateAggregate(ctx, questionID, revisionOne, domain.ScopeRevision); err != nil || got != nil {
		t.Fatalf("same Pair replacement era bypassed four-Pair privacy suppression: %+v, err=%v", got, err)
	}

	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		if _, err := db.Exec(ctx, "UPDATE private_question_candidate SET state = 'asked', resolved_at = now() WHERE question_id = $1 AND question_revision_id = $2 AND state = 'invalidated'", questionID, revisionOne); err != nil {
			return err
		}
		var fifthEra, fifthSession string
		if err := db.QueryRow(ctx, "SELECT id::text FROM pair_membership_era WHERE pair_id = $1", pairIDs[4]).Scan(&fifthEra); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO together_session(pair_id, membership_era_id, category, started_by_participant_id, selection_seed) VALUES ($1, $2, 'fun', $3, 'admin-analytics-fifth') RETURNING id::text", pairIDs[4], fifthEra, participantIDs[0]).Scan(&fifthSession); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO together_session_question(session_id, question_id, question_revision_id, position, advanced_at) VALUES ($1, $2, $3, 1, now())", fifthSession, questionID, revisionOne); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "UPDATE pair SET terminated_at = now() WHERE id = $1", pairIDs[4])
		return err
	}); err != nil {
		t.Fatalf("add fifth distinct-Pair activity: %v", err)
	}

	private, err := store.PrivateAggregate(ctx, questionID, revisionOne, domain.ScopeRevision)
	if err != nil {
		t.Fatal(err)
	}
	if private == nil || private.ValidOffers != 6 || private.Decisions != 4 || private.Asked != 3 || private.Skipped != 1 || private.LikedDecisions != 2 {
		t.Fatalf("five-Pair Private aggregate = %+v; want offers=6 decisions=4 asked=3 skipped=1 final-liked=2", private)
	}
	together, err := store.TogetherAggregate(ctx, questionID, revisionOne, domain.ScopeRevision)
	if err != nil {
		t.Fatal(err)
	}
	if together == nil || together.Shown != 5 || together.Decisions != 4 || together.Continued != 3 || together.Skipped != 1 || together.LikedDecisions != 2 {
		t.Fatalf("five-Pair Together aggregate = %+v; want shown=5 decisions=4 continued=3 skipped=1 final-liked=2", together)
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		plans := []struct {
			name  string
			query string
		}{
			{"Private", `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FILTER (WHERE c.state IN ('unresolved', 'asked', 'skipped')) FROM private_question_candidate c JOIN private_conversation pc ON pc.id = c.conversation_id WHERE c.question_id = $1 AND ($2::uuid IS NULL OR c.question_revision_id = $2) AND c.state IN ('unresolved', 'asked', 'skipped') HAVING count(DISTINCT pc.pair_id) >= $3::bigint`},
			{"Together", `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM together_session_question tsq JOIN together_session ts ON ts.id = tsq.session_id WHERE tsq.question_id = $1 AND ($2::uuid IS NULL OR tsq.question_revision_id = $2) HAVING count(DISTINCT ts.pair_id) >= $3::bigint`},
		}
		for _, plan := range plans {
			rows, err := db.Query(ctx, plan.query, questionID, revisionOne, int64(5))
			if err != nil {
				return fmt.Errorf("EXPLAIN ANALYZE %s aggregate: %w", plan.name, err)
			}
			var lines int
			for rows.Next() {
				var line string
				if err := rows.Scan(&line); err != nil {
					rows.Close()
					return err
				}
				lines++
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
			if lines == 0 {
				return fmt.Errorf("EXPLAIN ANALYZE %s aggregate returned no plan", plan.name)
			}
		}
		var indexCount int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('private_candidate_analytics_question_revision_idx', 'together_question_analytics_question_revision_idx')").Scan(&indexCount); err != nil {
			return err
		}
		if indexCount != 2 {
			return fmt.Errorf("analytics indexes present = %d, want 2", indexCount)
		}
		return nil
	}); err != nil {
		t.Fatalf("analytics query plan or index check: %v", err)
	}
	allPrivate, err := store.PrivateAggregate(ctx, questionID, "", domain.ScopeAll)
	if err != nil || allPrivate == nil || allPrivate.ValidOffers != 6 {
		t.Fatalf("all-revisions Private with one qualifying revision = %+v, err=%v", allPrivate, err)
	}
	allTogether, err := store.TogetherAggregate(ctx, questionID, "", domain.ScopeAll)
	if err != nil || allTogether == nil || allTogether.Shown != 5 {
		t.Fatalf("all-revisions Together with one qualifying revision = %+v, err=%v", allTogether, err)
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		for _, pairID := range pairIDs[:4] {
			var eraID, conversationID, sessionID string
			if err := db.QueryRow(ctx, "SELECT id::text FROM pair_membership_era WHERE pair_id = $1 AND ended_at IS NULL", pairID).Scan(&eraID); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1, 'memories', $2, $3) RETURNING id::text", pairID, participantIDs[0], eraID).Scan(&conversationID); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id, state) VALUES ($1, $2, $3, 'unresolved')", conversationID, questionID, revisionTwo); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "UPDATE together_session SET ended_at = now() WHERE pair_id = $1 AND ended_at IS NULL", pairID); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, "INSERT INTO together_session(pair_id, membership_era_id, category, started_by_participant_id, selection_seed) VALUES ($1, $2, 'fun', $3, 'admin-analytics-sparse-revision') RETURNING id::text", pairID, eraID, participantIDs[0]).Scan(&sessionID); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "INSERT INTO together_session_question(session_id, question_id, question_revision_id, position) VALUES ($1, $2, $3, 1)", sessionID, questionID, revisionTwo); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("seed below-threshold second revision: %v", err)
	}
	if got, err := store.PrivateAggregate(ctx, questionID, "", domain.ScopeAll); err != nil || got != nil {
		t.Fatalf("all-revisions Private with a four-Pair revision = %+v, err=%v; want suppressed", got, err)
	}
	if got, err := store.TogetherAggregate(ctx, questionID, "", domain.ScopeAll); err != nil || got != nil {
		t.Fatalf("all-revisions Together with a four-Pair revision = %+v, err=%v; want suppressed", got, err)
	}

	coverage, err := store.Coverage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(coverage) != 20 {
		t.Fatalf("coverage lanes = %d, want category × relationship × mode (20)", len(coverage))
	}
	var relationshipPartnerTogether, relationshipPartnerPrivate, relationshipFriendTogether domain.CoverageLane
	for _, lane := range coverage {
		if lane.Category == "relationship" && lane.RelationshipType == "partner" && lane.Mode == "together" {
			relationshipPartnerTogether = lane
		}
		if lane.Category == "relationship" && lane.RelationshipType == "partner" && lane.Mode == "private" {
			relationshipPartnerPrivate = lane
		}
		if lane.Category == "relationship" && lane.RelationshipType == "friend" && lane.Mode == "together" {
			relationshipFriendTogether = lane
		}
	}
	partnerTogetherBaseline := baseline["relationship/partner/together"]
	if relationshipPartnerTogether.Eligible != partnerTogetherBaseline.Eligible+1 || relationshipPartnerTogether.Deep != partnerTogetherBaseline.Deep+1 {
		t.Fatalf("safe active current revision was not grouped into its exact eligible lane: before=%+v after=%+v", partnerTogetherBaseline, relationshipPartnerTogether)
	}
	if relationshipFriendTogether.Eligible != baseline["relationship/friend/together"].Eligible {
		t.Fatalf("partner-only category fit leaked into friend lane: before=%+v after=%+v", baseline["relationship/friend/together"], relationshipFriendTogether)
	}
	if relationshipPartnerPrivate.Eligible != baseline["relationship/partner/private"].Eligible {
		t.Fatalf("Together-only current Question leaked into Private coverage: before=%+v after=%+v", baseline["relationship/partner/private"], relationshipPartnerPrivate)
	}
}
