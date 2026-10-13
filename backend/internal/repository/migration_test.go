package repository_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"demo-site/backend/internal/repository"
	"demo-site/backend/migrations"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestExistingBrowserCookieSurvivesRealtimeMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"001_foundation.sql", "002_mcp.sql", "003_demo_oauth.sql"} {
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO schema_migrations VALUES(?,?)`, name, fmt.Sprintf("%x", sha256.Sum256(body))); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	if _, err = db.Exec(`INSERT INTO demo_sessions VALUES(?,?,?,?,?,?,?,?,?)`, "legacy-workspace", "legacy-cookie-hash", "g1", 1, "v1", "acceptance", "2026-10-03", now.Unix(), now.Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	migrated, err := repository.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	view, err := migrated.Session(context.Background(), "legacy-cookie-hash", now)
	if err != nil || view.ID != "legacy-workspace" || view.EventCursor != "legacy-workspace:0" {
		t.Fatalf("lost browser session: %+v %v", view, err)
	}
	migrated.DB.Close()
	reopened, err := repository.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	if _, err = reopened.Session(context.Background(), "legacy-cookie-hash", now); err != nil {
		t.Fatal(err)
	}
}
