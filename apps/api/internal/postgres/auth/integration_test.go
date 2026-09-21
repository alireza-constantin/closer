package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	appauth "github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/argon2"
)

func openAuthTestPool(t *testing.T) *postgres.Pool {
	t.Helper()
	if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
		t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL auth integration checks")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestAnonymousSessionPersistsOnlyHashAndSupportsLookupRevocationAndExpiry(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	service := appauth.NewServiceWithClock(store, func() time.Time { return now })

	created, err := service.CreateAnonymous(context.Background())
	if err != nil {
		t.Fatalf("CreateAnonymous() error = %v", err)
	}
	actor, err := service.ResolveSession(context.Background(), created.Token)
	if err != nil || actor != created.Actor {
		t.Fatalf("ResolveSession() actor = %+v, error = %v", actor, err)
	}

	userID, err := parseUUID(created.Actor.AuthUserID)
	if err != nil {
		t.Fatal(err)
	}
	var hashes [][]byte
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		var queryErr error
		hashes, queryErr = sqlc.New(db).ListAuthSessionTokenHashes(context.Background(), userID)
		return queryErr
	})
	if err != nil {
		t.Fatalf("read stored session hashes: %v", err)
	}
	wantHash := appauth.HashSessionToken(created.Token)
	if len(hashes) != 1 || len(hashes[0]) != sha256.Size || string(hashes[0]) != string(wantHash[:]) {
		t.Fatal("database did not contain exactly SHA-256(raw session token)")
	}
	if string(hashes[0]) == created.Token {
		t.Fatal("raw session token was persisted")
	}

	if err := service.RevokeSession(context.Background(), created.Token); err != nil {
		t.Fatalf("RevokeSession() error = %v", err)
	}
	if _, err := service.ResolveSession(context.Background(), created.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v, want unauthenticated", err)
	}

	oldUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	oldSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	oldToken, err := appauth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	oldHash := appauth.HashSessionToken(oldToken)
	createdAt := now.Add(-appauth.SessionAbsoluteTTL - time.Hour)
	if err := store.CreateAnonymous(context.Background(), oldUserID, oldSessionID, oldHash[:], createdAt, createdAt.Add(appauth.SessionIdleTTL)); err != nil {
		t.Fatalf("insert expired-session fixture: %v", err)
	}
	if _, err := service.ResolveSession(context.Background(), oldToken); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("expired session error = %v, want unauthenticated", err)
	}
}

func TestAuthSessionForeignKeyAndTokenHashUniqueness(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)

	missingUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	sessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	var foreignKeyErr error
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, queryErr := sqlc.New(db).CreateAuthSession(context.Background(), sqlc.CreateAuthSessionParams{
			ID:         mustUUID(t, sessionID),
			AuthUserID: mustUUID(t, missingUserID),
			TokenHash:  make([]byte, sha256.Size),
			CreatedAt:  timestamptz(now),
			ExpiresAt:  timestamptz(now.Add(time.Hour)),
		})
		foreignKeyErr = queryErr
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if foreignKeyErr == nil {
		t.Fatal("auth_session accepted a missing auth_user foreign key")
	}

	created, err := appauth.NewServiceWithClock(store, func() time.Time { return now }).CreateAnonymous(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	firstUserID, err := parseUUID(created.Actor.AuthUserID)
	if err != nil {
		t.Fatal(err)
	}
	var originalHash []byte
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		hashes, queryErr := sqlc.New(db).ListAuthSessionTokenHashes(context.Background(), firstUserID)
		if queryErr == nil && len(hashes) > 0 {
			originalHash = hashes[0]
		}
		return queryErr
	})
	if err != nil || len(originalHash) != sha256.Size {
		t.Fatalf("read original token hash: %v", err)
	}

	secondUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	secondSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAnonymous(context.Background(), secondUserID, secondSessionID, originalHash, now, now.Add(appauth.SessionIdleTTL)); err == nil {
		t.Fatal("auth_session accepted a duplicate token hash")
	}
}

func TestExpiredSessionCleanupIsBoundedAndRetainsActiveSessions(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	service := appauth.NewServiceWithClock(store, func() time.Time { return now })

	active, err := service.CreateAnonymous(context.Background())
	if err != nil {
		t.Fatalf("create active session: %v", err)
	}
	expiredUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	expiredSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	expiredToken, err := appauth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	expiredHash := appauth.HashSessionToken(expiredToken)
	createdAt := now.Add(-appauth.SessionAbsoluteTTL - time.Hour)
	if err := store.CreateAnonymous(context.Background(), expiredUserID, expiredSessionID, expiredHash[:], createdAt, createdAt.Add(appauth.SessionIdleTTL)); err != nil {
		t.Fatalf("create expired fixture: %v", err)
	}

	deleted, err := service.CleanupExpiredSessions(context.Background())
	if err != nil {
		t.Fatalf("CleanupExpiredSessions() error = %v", err)
	}
	if deleted < 1 || deleted > appauth.SessionCleanupBatch {
		t.Fatalf("deleted session count = %d, want 1..%d", deleted, appauth.SessionCleanupBatch)
	}
	if _, err := service.ResolveSession(context.Background(), active.Token); err != nil {
		t.Fatalf("cleanup removed an active session: %v", err)
	}
	var expiredExists bool
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		var queryErr error
		expiredExists, queryErr = sqlc.New(db).HasAuthSession(context.Background(), expiredHash[:])
		return queryErr
	})
	if err != nil || expiredExists {
		t.Fatalf("expired session exists after cleanup = %t, error = %v", expiredExists, err)
	}
}

func TestCredentialRegistrationUpgradeLoginAndLogoutPreserveIdentity(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	service := appauth.NewServiceWithCredentials(store, store, nil)
	ctx := context.Background()
	password := "correct horse battery staple"

	registered, err := service.Register(ctx, uniqueAuthEmail(t), password)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if registered.Actor.Kind != appauth.UserKindRegistered {
		t.Fatalf("registered actor kind = %q", registered.Actor.Kind)
	}
	registeredEmail := uniqueEmailFromCredential(t, store, registered.Actor.AuthUserID)
	if _, err := service.Register(ctx, " "+strings.ToUpper(registeredEmail)+" ", password); !errors.Is(err, appauth.ErrEmailInUse) {
		t.Fatalf("normalized duplicate registration error = %v, want email in use", err)
	}
	if _, err := service.ResolveSession(ctx, registered.Token); err != nil {
		t.Fatalf("registration did not create a usable session: %v", err)
	}
	credential, err := store.FindCredential(ctx, mustNormalizeEmail(t, registeredEmail))
	if err != nil || credential.Actor.AuthUserID != registered.Actor.AuthUserID {
		t.Fatalf("registered credential lookup = %+v, %v", credential, err)
	}
	if credential.PasswordHash == password || !strings.HasPrefix(credential.PasswordHash, "$argon2id$v=19$") {
		t.Fatal("registered credential did not persist an encoded Argon2id hash")
	}
	assertNoParticipantForAuthUser(t, pool, registered.Actor.AuthUserID)

	upgradedEmail := uniqueAuthEmail(t)
	anonymous, err := service.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	upgraded, err := service.Upgrade(ctx, anonymous.Token, upgradedEmail, password)
	if err != nil {
		t.Fatalf("Upgrade() error = %v", err)
	}
	if upgraded.AuthUserID != anonymous.Actor.AuthUserID || upgraded.Kind != appauth.UserKindRegistered {
		t.Fatalf("upgrade changed identity: before=%+v after=%+v", anonymous.Actor, upgraded)
	}
	resolved, err := service.ResolveSession(ctx, anonymous.Token)
	if err != nil || resolved != upgraded {
		t.Fatalf("upgrade did not preserve its session: actor=%+v error=%v", resolved, err)
	}
	assertNoParticipantForAuthUser(t, pool, upgraded.AuthUserID)

	unknownErr := func() error {
		_, loginErr := service.Login(ctx, uniqueAuthEmail(t), password, "127.0.0.1", "")
		return loginErr
	}()
	wrongPasswordEmail := strings.ToLower(uniqueAuthEmail(t))
	wrongPasswordAccount, err := service.Register(ctx, wrongPasswordEmail, password)
	if err != nil {
		t.Fatal(err)
	}
	_, wrongErr := service.Login(ctx, wrongPasswordEmail, "this password is wrong", "127.0.0.2", "")
	if !errors.Is(unknownErr, appauth.ErrInvalidCredentials) || !errors.Is(wrongErr, appauth.ErrInvalidCredentials) {
		t.Fatalf("unknown login error = %v, wrong-password error = %v", unknownErr, wrongErr)
	}

	// Logging in from anonymous browser A installs the existing registered
	// identity without changing or deleting A's auth user.
	anonymousBrowser, err := service.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	loggedIn, err := service.Login(ctx, wrongPasswordEmail, password, "127.0.0.3", anonymousBrowser.Token)
	if err != nil || loggedIn.Actor.AuthUserID != wrongPasswordAccount.Actor.AuthUserID {
		t.Fatalf("login from anonymous browser = %+v, %v", loggedIn.Actor, err)
	}
	if _, err := service.ResolveSession(ctx, anonymousBrowser.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("old anonymous browser session error = %v, want unauthenticated", err)
	}
	var anonymousKind string
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT kind FROM auth_user WHERE id = $1", mustUUID(t, anonymousBrowser.Actor.AuthUserID)).Scan(&anonymousKind)
	})
	if err != nil || anonymousKind != string(appauth.UserKindAnonymous) {
		t.Fatalf("anonymous auth identity kind = %q, error = %v", anonymousKind, err)
	}

	phone, err := service.Login(ctx, wrongPasswordEmail, password, "127.0.0.4", "")
	if err != nil {
		t.Fatalf("second-device login error = %v", err)
	}
	if err := service.RevokeSession(ctx, loggedIn.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ResolveSession(ctx, phone.Token); err != nil {
		t.Fatalf("logging out another device revoked phone session: %v", err)
	}
	if err := service.RevokeAllSessions(ctx, phone.Actor); err != nil {
		t.Fatalf("RevokeAllSessions() error = %v", err)
	}
	if _, err := service.ResolveSession(ctx, phone.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("logout-all left phone session valid: %v", err)
	}
}

func TestLoginRehashesWeakPasswordInSuccessfulSessionTransaction(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	service := appauth.NewServiceWithCredentials(store, store, nil)
	ctx := context.Background()
	password := "correct horse battery staple"
	email := uniqueAuthEmail(t)
	registered, err := service.Register(ctx, email, password)
	if err != nil {
		t.Fatal(err)
	}
	salt := []byte("0123456789abcdef")
	weakKey := argon2.IDKey([]byte(password), salt, 1, 8*1024, 1, appauth.Argon2KeyBytes)
	weakHash := "$argon2id$v=19$m=8192,t=1,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(weakKey)
	userUUID := mustUUID(t, registered.Actor.AuthUserID)
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, queryErr := db.Exec(ctx, "UPDATE auth_credential SET password_hash = $2 WHERE auth_user_id = $1", userUUID, weakHash)
		return queryErr
	})
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(ctx, email, password, "127.0.0.9", "")
	if err != nil {
		t.Fatalf("Login() after weak hash error = %v", err)
	}
	credential, err := store.FindCredential(ctx, mustNormalizeEmail(t, email))
	if err != nil {
		t.Fatal(err)
	}
	if credential.PasswordHash == weakHash || !strings.HasPrefix(credential.PasswordHash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Fatal("successful login did not upgrade the stored Argon2id parameters")
	}
	if _, err := service.ResolveSession(ctx, login.Token); err != nil {
		t.Fatalf("rehash and session creation did not commit together: %v", err)
	}
}

func TestAnonymousUpgradeEmailUniquenessRaceUsesDatabaseConstraint(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	left, err := appauth.NewService(store).CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	right, err := appauth.NewService(store).CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	email := uniqueAuthEmail(t)
	start := make(chan struct{})
	type upgradeResult struct {
		userID string
		err    error
	}
	errorsFound := make(chan upgradeResult, 2)
	var workers sync.WaitGroup
	for _, userID := range []string{left.Actor.AuthUserID, right.Actor.AuthUserID} {
		workers.Add(1)
		go func(userID string) {
			defer workers.Done()
			<-start
			errorsFound <- upgradeResult{userID: userID, err: store.Upgrade(ctx, userID, strings.ToLower(email), "test-only-encoded-password", time.Now().UTC())}
		}(userID)
	}
	close(start)
	workers.Wait()
	close(errorsFound)
	succeeded, conflicts := 0, 0
	var losingUserID string
	for result := range errorsFound {
		switch {
		case result.err == nil:
			succeeded++
		case errors.Is(result.err, appauth.ErrEmailInUse):
			conflicts++
			losingUserID = result.userID
		default:
			t.Fatalf("upgrade race returned unexpected error: %v", result.err)
		}
	}
	if succeeded != 1 || conflicts != 1 {
		t.Fatalf("upgrade race successes=%d email conflicts=%d, want one each", succeeded, conflicts)
	}
	var losingUserKind string
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT kind FROM auth_user WHERE id = $1", mustUUID(t, losingUserID)).Scan(&losingUserKind)
	})
	if err != nil || losingUserKind != string(appauth.UserKindAnonymous) {
		t.Fatalf("losing upgrade changed identity to %q, error=%v", losingUserKind, err)
	}
	losingToken := left.Token
	if left.Actor.AuthUserID != losingUserID {
		losingToken = right.Token
	}
	if actor, err := appauth.NewService(store).ResolveSession(ctx, losingToken); err != nil || actor.AuthUserID != losingUserID || actor.Kind != appauth.UserKindAnonymous {
		t.Fatalf("losing upgrade changed its current session: actor=%+v error=%v", actor, err)
	}
}

func TestConsumerRateLimitIsAtomicAcrossConcurrentRequestsAndScopes(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	const attempts = 20
	runID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	sharedIPSubject := testSubject("ip", runID)
	results := make(chan appauth.LoginRateResult, attempts)
	errs := make(chan error, attempts)
	var workers sync.WaitGroup
	for i := 0; i < attempts; i++ {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			result, err := store.CountConsumerLoginAttempt(ctx, sharedIPSubject, testSubject("email", fmt.Sprintf("%s-%d", runID, i)))
			results <- result
			errs <- err
		}(i)
	}
	workers.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("CountConsumerLoginAttempt() error = %v", err)
		}
	}
	limited := 0
	for result := range results {
		if result.Limited {
			limited++
		}
	}
	if limited != attempts-appauth.ConsumerLoginLimit {
		t.Fatalf("concurrent same-IP throttles=%d, want %d", limited, attempts-appauth.ConsumerLoginLimit)
	}

	emailSubject := testSubject("email", runID+"-shared")
	independentIP, err := store.CountConsumerLoginAttempt(ctx, testSubject("ip", runID+"-independent"), emailSubject)
	if err != nil || independentIP.Limited {
		t.Fatalf("different IP was not independent: %+v, %v", independentIP, err)
	}
	for attempt := 2; attempt <= appauth.ConsumerLoginLimit; attempt++ {
		if _, err := store.CountConsumerLoginAttempt(ctx, testSubject("ip", fmt.Sprintf("%s-%d", runID, attempt)), emailSubject); err != nil {
			t.Fatal(err)
		}
	}
	limitedEmail, err := store.CountConsumerLoginAttempt(ctx, testSubject("ip", runID+"-fresh"), emailSubject)
	if err != nil || !limitedEmail.Limited {
		t.Fatalf("normalized-email limit result = %+v, %v; want limited", limitedEmail, err)
	}
}

func TestConsumerRateLimitAcceptsTenThenResetsAtFixedWindowBoundary(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	userID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	ipSubject := testSubject("ip", userID)
	emailSubject := testSubject("email", userID)
	for attempt := 1; attempt <= appauth.ConsumerLoginLimit; attempt++ {
		result, err := store.CountConsumerLoginAttempt(ctx, ipSubject, emailSubject)
		if err != nil || result.Limited {
			t.Fatalf("attempt %d result=%+v error=%v; expected accepted", attempt, result, err)
		}
	}
	eleventh, err := store.CountConsumerLoginAttempt(ctx, ipSubject, emailSubject)
	if err != nil || !eleventh.Limited || eleventh.RetryAfter <= 0 || eleventh.RetryAfter > appauth.ConsumerLoginWindow {
		t.Fatalf("attempt 11 result=%+v error=%v; want a wait up to one minute", eleventh, err)
	}
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, queryErr := db.Exec(ctx, `UPDATE auth_rate_limit SET window_started_at = clock_timestamp() - interval '1 minute'
			WHERE (scope = 'consumer_login_ip' AND subject = $1)
			   OR (scope = 'consumer_login_email' AND subject = $2)`, ipSubject, emailSubject)
		return queryErr
	})
	if err != nil {
		t.Fatal(err)
	}
	afterWindow, err := store.CountConsumerLoginAttempt(ctx, ipSubject, emailSubject)
	if err != nil || afterWindow.Limited {
		t.Fatalf("first request after window result=%+v error=%v; want accepted", afterWindow, err)
	}
}

func TestAdminBootstrapLoginAndRecoveryAreIsolated(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	service := appauth.NewServiceWithCredentials(store, store, nil)
	adminEmail := uniqueAuthEmail(t)
	adminPassword := "first admin password"

	bootstrapped, err := service.BootstrapAdmin(ctx, adminEmail, adminPassword)
	if err != nil || !bootstrapped.Created || bootstrapped.AuthUserID == "" {
		t.Fatalf("BootstrapAdmin() = %+v, %v; want new Admin", bootstrapped, err)
	}
	if isAdmin, err := store.IsAdmin(ctx, bootstrapped.AuthUserID); err != nil || !isAdmin {
		t.Fatalf("bootstrapped identity Admin membership=%t error=%v", isAdmin, err)
	}
	adminCredential, err := store.FindAdminCredential(ctx, mustNormalizeEmail(t, adminEmail))
	if err != nil || adminCredential.PasswordHash == adminPassword || !strings.HasPrefix(adminCredential.PasswordHash, "$argon2id$v=19$") {
		t.Fatalf("Admin bootstrap did not persist an encoded password hash; lookup error=%v", err)
	}
	assertNoParticipantForAuthUser(t, pool, bootstrapped.AuthUserID)
	var initialSessionCount int64
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT count(*) FROM auth_session WHERE auth_user_id = $1", mustUUID(t, bootstrapped.AuthUserID)).Scan(&initialSessionCount)
	}); err != nil {
		t.Fatalf("read bootstrap session count: %v", err)
	}
	if initialSessionCount != 0 {
		t.Fatalf("Admin bootstrap created %d sessions; want no session before explicit login", initialSessionCount)
	}

	noOp, err := service.BootstrapAdmin(ctx, adminEmail, "different bootstrap password")
	if err != nil || noOp.Created || noOp.AuthUserID != bootstrapped.AuthUserID {
		t.Fatalf("same-Admin bootstrap retry = %+v, %v; want unchanged no-op", noOp, err)
	}
	adminSession, err := service.AdminLogin(ctx, adminEmail, adminPassword, "127.0.0.21", "")
	if err != nil || adminSession.Actor.AuthUserID != bootstrapped.AuthUserID {
		t.Fatalf("AdminLogin() after bootstrap no-op = %+v, %v", adminSession.Actor, err)
	}
	secondDeviceAdminSession, err := service.AdminLogin(ctx, adminEmail, adminPassword, "127.0.0.25", "")
	if err != nil || secondDeviceAdminSession.Actor.AuthUserID != bootstrapped.AuthUserID {
		t.Fatalf("second Admin device login = %+v, %v", secondDeviceAdminSession.Actor, err)
	}

	consumerEmail := uniqueAuthEmail(t)
	consumerSession, err := service.Register(ctx, consumerEmail, "consumer password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.BootstrapAdmin(ctx, consumerEmail, "attempted promotion password"); !errors.Is(err, appauth.ErrAdminEmailInUse) {
		t.Fatalf("bootstrap over consumer email error=%v, want ErrAdminEmailInUse", err)
	}
	consumerCredential, err := store.FindCredential(ctx, mustNormalizeEmail(t, consumerEmail))
	if err != nil || consumerCredential.Actor.AuthUserID != consumerSession.Actor.AuthUserID || consumerCredential.Actor.Kind != appauth.UserKindRegistered {
		t.Fatalf("consumer changed after rejected bootstrap: %+v, %v", consumerCredential, err)
	}

	secondAdminEmail := uniqueAuthEmail(t)
	secondAdmin, err := service.BootstrapAdmin(ctx, secondAdminEmail, "second admin password")
	if err != nil || !secondAdmin.Created {
		t.Fatalf("second BootstrapAdmin() = %+v, %v", secondAdmin, err)
	}
	secondAdminSession, err := service.AdminLogin(ctx, secondAdminEmail, "second admin password", "127.0.0.22", "")
	if err != nil {
		t.Fatalf("second AdminLogin() error=%v", err)
	}

	recovery, err := service.RecoverAdmin(ctx, adminEmail, "recovered admin password")
	if err != nil || recovery.AuthUserID != bootstrapped.AuthUserID || recovery.RevokedSessionCount < 2 {
		t.Fatalf("RecoverAdmin() = %+v, %v; want only first Admin and revoked sessions", recovery, err)
	}
	if _, err := service.ResolveSession(ctx, adminSession.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("recovery left old Admin session valid: %v", err)
	}
	if _, err := service.ResolveSession(ctx, secondDeviceAdminSession.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("recovery left second-device Admin session valid: %v", err)
	}
	if _, err := service.ResolveSession(ctx, secondAdminSession.Token); err != nil {
		t.Fatalf("recovery revoked a different Admin session: %v", err)
	}
	if _, err := service.ResolveSession(ctx, consumerSession.Token); err != nil {
		t.Fatalf("recovery revoked a consumer session: %v", err)
	}
	if _, err := service.AdminLogin(ctx, adminEmail, adminPassword, "127.0.0.23", ""); !errors.Is(err, appauth.ErrInvalidCredentials) {
		t.Fatalf("old Admin password error=%v, want generic invalid credentials", err)
	}
	newAdminSession, err := service.AdminLogin(ctx, adminEmail, "recovered admin password", "127.0.0.24", "")
	if err != nil || newAdminSession.Actor.AuthUserID != bootstrapped.AuthUserID {
		t.Fatalf("AdminLogin() with recovered password = %+v, %v", newAdminSession.Actor, err)
	}
	if _, err := service.RecoverAdmin(ctx, consumerEmail, "consumer reset password"); !errors.Is(err, appauth.ErrAdminNotFound) {
		t.Fatalf("consumer recovery error=%v, want ErrAdminNotFound", err)
	}
}

func TestAdminBootstrapRacingConsumerSignupNeverPromotesTheConsumer(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	email := uniqueAuthEmail(t)
	adminUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	consumerUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	consumerSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	consumerToken, err := appauth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	consumerTokenHash := appauth.HashSessionToken(consumerToken)
	now := time.Now().UTC()
	start := make(chan struct{})
	type outcome struct {
		adminCreated bool
		adminErr     error
		consumerErr  error
	}
	result := make(chan outcome, 1)
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		<-start
		_, created, adminErr := store.BootstrapAdmin(ctx, adminUserID, email, "operator-hash", now)
		if adminErr != nil && !errors.Is(adminErr, appauth.ErrAdminEmailInUse) {
			result <- outcome{adminCreated: created, adminErr: adminErr}
			return
		}
		result <- outcome{adminCreated: created, adminErr: adminErr}
	}()
	consumerResult := make(chan error, 1)
	go func() {
		defer workers.Done()
		<-start
		consumerResult <- store.Register(ctx, consumerUserID, consumerSessionID, email, "consumer-hash", consumerTokenHash[:], now, now.Add(appauth.SessionIdleTTL))
	}()
	close(start)
	workers.Wait()
	adminOutcome := <-result
	consumerErr := <-consumerResult
	adminWon := adminOutcome.adminErr == nil && adminOutcome.adminCreated
	consumerWon := consumerErr == nil
	if adminWon == consumerWon {
		t.Fatalf("bootstrap/signup race: admin=%+v consumerErr=%v; want exactly one winner", adminOutcome, consumerErr)
	}
	if adminWon && !errors.Is(consumerErr, appauth.ErrEmailInUse) {
		t.Fatalf("Admin won but consumer error=%v, want duplicate-email rejection", consumerErr)
	}
	if consumerWon && !errors.Is(adminOutcome.adminErr, appauth.ErrAdminEmailInUse) {
		t.Fatalf("consumer won but Admin error=%v, want no-promotion rejection", adminOutcome.adminErr)
	}

	var kind string
	var adminMembership bool
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, `SELECT u.kind, EXISTS (
			SELECT 1 FROM admin_user AS a WHERE a.auth_user_id = u.id
		) FROM auth_user AS u JOIN auth_credential AS c ON c.auth_user_id = u.id
		WHERE c.email_normalized = $1`, mustNormalizeEmail(t, email)).Scan(&kind, &adminMembership)
	})
	if err != nil {
		t.Fatalf("read signup/bootstrap race winner: %v", err)
	}
	if consumerWon && (kind != string(appauth.UserKindRegistered) || adminMembership) {
		t.Fatalf("consumer identity kind=%q admin membership=%t after race", kind, adminMembership)
	}
	if adminWon && (kind != string(appauth.UserKindAdmin) || !adminMembership) {
		t.Fatalf("Admin identity kind=%q admin membership=%t after race", kind, adminMembership)
	}
}

func TestAdminRateLimitIsFivePerIPAtomicAndResetsAtWindowBoundary(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	runID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	sharedIPSubject := testSubject("admin-ip", runID)
	const attempts = 20
	results := make(chan appauth.LoginRateResult, attempts)
	errs := make(chan error, attempts)
	var workers sync.WaitGroup
	for i := 0; i < attempts; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			result, err := store.CountAdminLoginAttempt(ctx, sharedIPSubject)
			results <- result
			errs <- err
		}()
	}
	workers.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("CountAdminLoginAttempt() error=%v", err)
		}
	}
	limited := 0
	for result := range results {
		if result.Limited {
			limited++
		}
	}
	if limited != attempts-appauth.AdminLoginLimit {
		t.Fatalf("concurrent Admin throttles=%d, want %d", limited, attempts-appauth.AdminLoginLimit)
	}

	independent, err := store.CountAdminLoginAttempt(ctx, testSubject("admin-ip", runID+"-other-ip"))
	if err != nil || independent.Limited {
		t.Fatalf("different Admin IP result=%+v, error=%v; want independent allowance", independent, err)
	}

	boundarySubject := testSubject("admin-ip", runID+"-boundary")
	for attempt := 1; attempt <= appauth.AdminLoginLimit; attempt++ {
		result, err := store.CountAdminLoginAttempt(ctx, boundarySubject)
		if err != nil || result.Limited {
			t.Fatalf("Admin attempt %d result=%+v error=%v; expected accepted", attempt, result, err)
		}
	}
	sixth, err := store.CountAdminLoginAttempt(ctx, boundarySubject)
	if err != nil || !sixth.Limited || sixth.RetryAfter <= 0 || sixth.RetryAfter > time.Minute {
		t.Fatalf("Admin attempt 6 result=%+v error=%v; want limited within one minute", sixth, err)
	}
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, queryErr := db.Exec(ctx, `UPDATE auth_rate_limit SET window_started_at = clock_timestamp() - interval '1 minute'
			WHERE scope = 'admin_login_ip' AND subject = $1`, boundarySubject)
		return queryErr
	})
	if err != nil {
		t.Fatal(err)
	}
	firstAfterWindow, err := store.CountAdminLoginAttempt(ctx, boundarySubject)
	if err != nil || firstAfterWindow.Limited {
		t.Fatalf("first Admin attempt after window=%+v error=%v; want accepted", firstAfterWindow, err)
	}
}

func testSubject(scope, value string) string {
	hash := sha256.Sum256([]byte(scope + ":" + value))
	return fmt.Sprintf("%x", hash[:])
}

func uniqueAuthEmail(t *testing.T) string {
	t.Helper()
	id, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	return "go03b-" + strings.ReplaceAll(id, "-", "") + "@example.test"
}

func uniqueEmailFromCredential(t *testing.T, store *Store, userID string) string {
	t.Helper()
	var email string
	userUUID := mustUUID(t, userID)
	err := store.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT email_normalized FROM auth_credential WHERE auth_user_id = $1", userUUID).Scan(&email)
	})
	if err != nil {
		t.Fatal(err)
	}
	return email
}

func mustNormalizeEmail(t *testing.T, email string) string {
	t.Helper()
	value, err := appauth.NormalizeEmail(email)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func assertNoParticipantForAuthUser(t *testing.T, pool *postgres.Pool, userID string) {
	t.Helper()
	var count int64
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM participant WHERE auth_user_id = $1", userID).Scan(&count)
	})
	if err != nil {
		t.Fatalf("check Participant isolation: %v", err)
	}
	if count != 0 {
		t.Fatalf("auth user %s unexpectedly has %d Participant rows", userID, count)
	}
}

func mustUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	result, err := parseUUID(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
