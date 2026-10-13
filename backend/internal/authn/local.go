// Package authn implements the demo's embedded, single-account OAuth store.
package authn

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"demo-site/backend/internal/config"
	"demo-site/backend/internal/model"
)

var ErrInvalidToken = errors.New("invalid access token")
var ErrInvalidGrant = errors.New("invalid grant")
var ErrUnavailable = errors.New("authorization unavailable")

const TokenLifetime = time.Hour

type Local struct {
	DB     *sql.DB
	Config config.MCP
	Now    func() time.Time
}

func (l *Local) now() time.Time {
	if l.Now != nil {
		return l.Now()
	}
	return time.Now()
}
func Hash(s string) string          { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func Secret() string                { return rand.Text() + rand.Text() }
func (l *Local) credential() string { return Hash(l.Config.Username + "\x00" + l.Config.Password) }
func (l *Local) Login(username, password string) bool {
	supplied := Hash(username + "\x00" + password)
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(l.credential())) == 1
}
func (l *Local) Principal(client, scope string) model.Principal {
	return model.Principal{Issuer: l.Config.Issuer, Subject: l.Config.Username, ClientID: client, Scopes: strings.Fields(scope)}
}
func (l *Local) Verify(ctx context.Context, token string) (model.Principal, time.Time, error) {
	var p model.Principal
	var scope string
	var exp int64
	if len(token) < 32 || len(token) > 256 {
		return p, time.Time{}, ErrInvalidToken
	}
	err := l.DB.QueryRowContext(ctx, `SELECT subject,client_id,scope,expires_at FROM demo_oauth_tokens WHERE hash=? AND issuer=? AND audience=? AND credential_hash=? AND expires_at>?`, Hash(token), l.Config.Issuer, l.Config.PublicURL, l.credential(), l.now().Unix()).Scan(&p.Subject, &p.ClientID, &scope, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return p, time.Time{}, ErrInvalidToken
	}
	if err != nil {
		return p, time.Time{}, ErrUnavailable
	}
	p.Issuer = l.Config.Issuer
	p.Scopes = strings.Fields(scope)
	return p, time.Unix(exp, 0), nil
}

type Client struct {
	ID        string   `json:"client_id"`
	Name      string   `json:"client_name"`
	Redirects []string `json:"redirect_uris"`
}

func (l *Local) Register(ctx context.Context, name string, redirects []string) (Client, error) {
	c := Client{Secret(), name, redirects}
	data, _ := json.Marshal(redirects)
	// Persistent cap bounds anonymous registration; existing clients survive restarts.
	result, err := l.DB.ExecContext(ctx, `INSERT INTO demo_oauth_clients(id,name,redirects,created_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM demo_oauth_clients)<1024`, c.ID, name, string(data), l.now().Unix())
	if err != nil {
		return c, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return c, ErrUnavailable
	}
	return c, nil
}
func (l *Local) Client(ctx context.Context, id string) (Client, error) {
	var c Client
	var data string
	err := l.DB.QueryRowContext(ctx, `SELECT id,name,redirects FROM demo_oauth_clients WHERE id=?`, id).Scan(&c.ID, &c.Name, &data)
	if err == nil {
		err = json.Unmarshal([]byte(data), &c.Redirects)
	}
	return c, err
}

type Grant struct{ ClientID, RedirectURI, Challenge, Scope, Resource string }

func (l *Local) Code(ctx context.Context, g Grant) (string, error) {
	code := Secret()
	_, err := l.DB.ExecContext(ctx, `INSERT INTO demo_oauth_codes(hash,client_id,redirect_uri,challenge,scope,issuer,audience,credential_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`, Hash(code), g.ClientID, g.RedirectURI, g.Challenge, g.Scope, l.Config.Issuer, g.Resource, l.credential(), l.now().Add(5*time.Minute).Unix())
	return code, err
}
func (l *Local) Issue(ctx context.Context, client, scope string) (string, time.Time, error) {
	token := Secret()
	expiry := l.now().Add(TokenLifetime)
	_, err := l.DB.ExecContext(ctx, `INSERT INTO demo_oauth_tokens(hash,client_id,subject,scope,issuer,audience,credential_hash,expires_at) VALUES(?,?,?,?,?,?,?,?)`, Hash(token), client, l.Config.Username, scope, l.Config.Issuer, l.Config.PublicURL, l.credential(), expiry.Unix())
	return token, expiry, err
}
func (l *Local) Exchange(ctx context.Context, code, client, redirect, resource, verifier string) (string, string, error) {
	if len(verifier) < 43 || len(verifier) > 128 {
		return "", "", ErrInvalidGrant
	}
	for _, ch := range verifier {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("-._~", ch)) {
			return "", "", ErrInvalidGrant
		}
	}
	tx, err := l.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback()
	var challenge, scope string
	var used int
	err = tx.QueryRowContext(ctx, `SELECT challenge,scope,consumed FROM demo_oauth_codes WHERE hash=? AND client_id=? AND redirect_uri=? AND audience=? AND issuer=? AND credential_hash=? AND expires_at>?`, Hash(code), client, redirect, resource, l.Config.Issuer, l.credential(), l.now().Unix()).Scan(&challenge, &scope, &used)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrInvalidGrant
	}
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	if subtle.ConstantTimeCompare([]byte(challenge), []byte(base64.RawURLEncoding.EncodeToString(sum[:]))) != 1 {
		return "", "", ErrInvalidGrant
	}
	if used != 0 {
		// Replay with the correct binding also revokes the token issued by this code.
		if _, err = tx.ExecContext(ctx, `DELETE FROM demo_oauth_tokens WHERE code_hash=?`, Hash(code)); err != nil {
			return "", "", err
		}
		if err = tx.Commit(); err != nil {
			return "", "", err
		}
		return "", "", ErrInvalidGrant
	}
	if _, err = tx.ExecContext(ctx, `UPDATE demo_oauth_codes SET consumed=1 WHERE hash=?`, Hash(code)); err != nil {
		return "", "", err
	}
	token := Secret()
	_, err = tx.ExecContext(ctx, `INSERT INTO demo_oauth_tokens(hash,client_id,subject,scope,issuer,audience,credential_hash,expires_at,code_hash) VALUES(?,?,?,?,?,?,?,?,?)`, Hash(token), client, l.Config.Username, scope, l.Config.Issuer, l.Config.PublicURL, l.credential(), l.now().Add(TokenLifetime).Unix(), Hash(code))
	if err != nil {
		return "", "", err
	}
	return token, scope, tx.Commit()
}
func (l *Local) Revoke(ctx context.Context, token, client string) error {
	_, err := l.DB.ExecContext(ctx, `DELETE FROM demo_oauth_tokens WHERE hash=? AND client_id=?`, Hash(token), client)
	return err
}
