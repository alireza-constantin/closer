# Closer Admin V1 analytics specification

**Status:** Locked for Admin V1

This document is the canonical definition of Admin metrics. Quality metrics are
All Time only in V1, default to the current Question Revision, and require at
least five distinct contributing Pairs in every displayed bucket. Below that
threshold Admin displays **Insufficient data** and reveals no count, numerator,
denominator, or rate.

`PRIVATE-01` is required before any metric that depends on skipped candidates or
final candidate Likes can be truthfully produced.

## Grouping and privacy rules

- **Question grouping:** stable logical `question_id`.
- **Revision grouping:** pinned `question_revision_id`; it never joins an old
  occurrence to a mutable current Revision for convenience.
- **Default scope:** current Revision only. Historical Revisions are selectable.
  **All revisions — historical aggregate** is explicitly labelled as historical.
- **Contributing Pair:** distinct logical Pair joined only inside the aggregate
  query for privacy suppression; Pair identity is never returned.
- **No date UI:** V1 is All Time. Timestamp columns identify authoritative
  future cohort fields, not a V1 filter.

## Metric catalog

| Metric                   | Definition                                                                       | Source table/fields                                                                                                          | Numerator                                        | Denominator          | Timestamp/cohort field                             | Question grouping | Revision grouping      | Privacy threshold | Currently measurable? | Dependency   | Notes                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------- | -------------------------------------------------- | ----------------- | ---------------------- | ----------------- | --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Private Valid Offers     | Candidates in `unresolved`, `asked`, or `skipped` state; excludes `invalidated`. | `private_question_candidate.state`, `question_id`, `question_revision_id`                                                    | Count of valid candidate rows                    | —                    | `created_at`                                       | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Partial               | `PRIVATE-01` | Unresolved is a valid offer and lowers Decision Rate.                                                             |
| Private Decisions        | Asked or skipped valid offers.                                                   | `private_question_candidate.state`                                                                                           | `asked + skipped`                                | —                    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Partial               | `PRIVATE-01` | Existing data has `asked`; `skipped` is new.                                                                      |
| Private Decision Rate    | Share of valid offers that receive Ask or Skip.                                  | Candidate state                                                                                                              | Private Decisions                                | Private Valid Offers | `resolved_at` for decision; `created_at` for offer | `question_id`     | `question_revision_id` | 5 distinct Pairs  | No                    | `PRIVATE-01` | Do not substitute Ask/Offers for this metric.                                                                     |
| Private Asked            | Valid offers whose state is `asked`.                                             | `private_question_candidate.state`                                                                                           | Count of `asked`                                 | —                    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Count is displayed only when its bucket passes privacy suppression.                                               |
| Private Ask Rate         | Share of Decisions that are Asked.                                               | Candidate state                                                                                                              | `asked`                                          | Private Decisions    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | No                    | `PRIVATE-01` | Ask and Skip are mutually exclusive terminal outcomes.                                                            |
| Private Skipped          | Valid offers whose state is `skipped`.                                           | `private_question_candidate.state`                                                                                           | Count of `skipped`                               | —                    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | No                    | `PRIVATE-01` | Skip consumes logical Question identity in that Conversation.                                                     |
| Private Skip Rate        | Share of Decisions that are Skipped.                                             | Candidate state                                                                                                              | `skipped`                                        | Private Decisions    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | No                    | `PRIVATE-01` | Never combine with a Private Decline.                                                                             |
| Private Like Rate        | Share of Decisions with final candidate Like on.                                 | `private_question_candidate.liked_at`, state                                                                                 | liked `asked + skipped`                          | Private Decisions    | `resolved_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | No                    | `PRIVATE-01` | Final Like only; no toggle-event history. Invalidated rows are excluded.                                          |
| Together Shown           | Persisted Together shown-question occurrence.                                    | `together_session_question.shown_at`, `question_id`, `question_revision_id`                                                  | Count of shown occurrences                       | —                    | `shown_at`                                         | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | A final card may be shown but undecided.                                                                          |
| Together Decisions       | Shown occurrences advanced by the session.                                       | `together_session_question.advanced_at`                                                                                      | Count where `advanced_at IS NOT NULL`            | —                    | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Manual end may leave the final card out.                                                                          |
| Together Continue        | Decisions that were not skipped.                                                 | `advanced_at`, `skipped_at`                                                                                                  | `advanced_at IS NOT NULL AND skipped_at IS NULL` | —                    | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Continue is a Together-specific action.                                                                           |
| Together Continue Rate   | Share of Together Decisions that continue.                                       | `advanced_at`, `skipped_at`                                                                                                  | Together Continue                                | Together Decisions   | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Continue and Skip rates are complementary only when data integrity guarantees every decision is one or the other. |
| Together Skip            | Decisions marked skipped.                                                        | `skipped_at`                                                                                                                 | `skipped_at IS NOT NULL`                         | —                    | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Count is a decision outcome, not session exhaustion.                                                              |
| Together Skip Rate       | Share of Together Decisions that skip.                                           | `skipped_at`, `advanced_at`                                                                                                  | Together Skip                                    | Together Decisions   | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | Do not compare directly to Private Skip without mode context.                                                     |
| Together Like Rate       | Share of decided cards with final Like on.                                       | `liked_at`, `advanced_at`                                                                                                    | final liked decided occurrences                  | Together Decisions   | `advanced_at`                                      | `question_id`     | `question_revision_id` | 5 distinct Pairs  | Yes                   | None         | A liked final card left undecided is excluded.                                                                    |
| Eligible inventory count | Current eligible Questions in one `category × relationship × mode` lane.         | `question.is_active`, `question.current_revision_id`, `question_revision.withdrawn_at`, category, relationship fit, mode fit | Count of eligible current Revisions              | —                    | Current state, not an event cohort                 | `question_id`     | Current revision only  | Not applicable    | Yes                   | None         | Intensity is a diagnostic composition, not a separate warning lane.                                               |

## Derived inventory health

| Eligible Questions in lane | Health   |
| -------------------------- | -------- |
| 0–5                        | Critical |
| 6–11                       | Low      |
| 12+                        | Healthy  |

These thresholds are application-level constants. They do not measure
historical exhaustion.

## Explicit exclusions

Admin V1 does not calculate or expose:

- Private exhaustion or a proxy for it;
- Pair, Participant, Session, or occurrence drilldowns;
- answer or reply content;
- sentiment, compatibility, relationship scores, or quality scores;
- 7-day, 30-day, or custom date ranges;
- a cross-mode combined performance score.
