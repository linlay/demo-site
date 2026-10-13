.PHONY: dev build build-backend test-backend check

# Dependencies must already have been installed by the user. No target installs them.
export GOTOOLCHAIN := local
export GOPROXY := off

dev:
	pnpm run dev

build:
	pnpm --dir frontend run build
	$(MAKE) build-backend

build-backend:
	mkdir -p build
	cd backend && go build -mod=readonly -o ../build/demo-site-server ./cmd/server

test-backend:
	cd backend && go test -mod=readonly ./...

check:
	pnpm run quality

.PHONY: dev-backend build-linux
TARGET_ARCH ?= amd64

dev-backend:
	cd backend && go run -mod=readonly ./cmd/server

build-linux:
	mkdir -p build
	cd backend && CGO_ENABLED=0 GOOS=linux GOARCH=$(TARGET_ARCH) go build -mod=readonly -trimpath -o ../build/demo-site-server-linux ./cmd/server
