package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"time"

	"demo-site/backend/internal/model"
	"demo-site/backend/internal/repository"
)

type Sessions struct {
	Store   *repository.Store
	Profile string
	Now     func() time.Time
}

func randomID() string { return rand.Text() }
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s *Sessions) clock() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}
func (s *Sessions) Bootstrap(ctx context.Context, token string) (model.Session, string, error) {
	if token != "" {
		session, err := s.Store.Session(ctx, tokenHash(token), s.clock())
		if err == nil {
			return session, "", nil
		}
		var failure *model.Error
		if !errors.As(err, &failure) || failure.Status != 401 {
			return session, "", err
		}
	}
	// 32 random bytes = 256 bits. Only its digest is persisted.
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return model.Session{}, "", err
	}
	token = hex.EncodeToString(secret)
	session, err := s.Store.CreateSession(ctx, randomID(), tokenHash(token), randomID(), s.Profile, s.clock())
	return session, token, err
}

var resetKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func (s *Sessions) Reset(ctx context.Context, token, generation, key string) (model.Session, error) {
	if token == "" {
		return model.Session{}, model.Failure(401, "session.expired", "请先建立演示会话。")
	}
	if generation == "" {
		return model.Session{}, model.Invalid("generation", "缺少数据版本。")
	}
	if !resetKey.MatchString(key) {
		return model.Session{}, model.Invalid("requestId", "重置请求编号无效。")
	}
	return s.Store.Reset(ctx, tokenHash(token), generation, key, randomID(), s.clock())
}
func (s *Sessions) Report(ctx context.Context, token, generation string, filter model.ReportFilter) (model.Report, error) {
	if token == "" {
		return model.Report{}, model.Failure(401, "session.expired", "请先建立演示会话。")
	}
	if generation == "" {
		return model.Report{}, model.Invalid("generation", "缺少数据版本。")
	}
	if err := validateFilter(&filter); err != nil {
		return model.Report{}, err
	}
	return s.Store.Report(ctx, tokenHash(token), generation, filter, s.clock())
}
