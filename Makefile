GO ?= go
GOFMT ?= gofmt
DENO ?= deno

.DEFAULT_GOAL := all
.PHONY: all build wasm wasm-go tools generate check-generator test vet fmt fmt-check check integration live runtime clean

all: build wasm

build: | bin
	CGO_ENABLED=0 $(GO) build -trimpath -o bin/sqlc-gen-typescript-native ./plugin

wasm: | bin
	GO="$(GO)" scripts/build-wasm.sh

wasm-go: | bin
	CGO_ENABLED=0 GOOS=wasip1 GOARCH=wasm $(GO) build -trimpath -ldflags="-s -w" -o bin/sqlc-gen-typescript-native-go.wasm ./plugin

tools:
	scripts/setup-wasm-tools.sh

generate:
	PATH="$(CURDIR)/bin/.tools/protoc-36.1/bin:$$PATH" $(GO) generate ./protocol

check-generator:
	PATH="$(CURDIR)/bin/.tools/protoc-36.1/bin:$$PATH" $(GO) run ./internal/cmd/genprotocol -schema protocol/codegen.proto -out protocol/codegen.go -check

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	find . -type d \( -name .git -o -name bin -o -name node_modules -o -name .integration \) -prune -o -type f -name '*.go' -print0 | xargs -0 $(GOFMT) -w

fmt-check:
	@files=$$(find . -type d \( -name .git -o -name bin -o -name node_modules -o -name .integration \) -prune -o -type f -name '*.go' -print0 | xargs -0 $(GOFMT) -l) || exit; if [ -n "$$files" ]; then printf '%s\n' "$$files"; exit 1; fi

check: fmt-check check-generator vet test wasm

integration:
	GO="$(GO)" scripts/test-integration.sh

live:
	GO="$(GO)" scripts/test-server-live.sh

runtime:
	$(DENO) test --config scripts/deno.json --allow-read --allow-write --allow-env --allow-net --allow-ffi internal/codegen/runtime_test.ts internal/codegen/server_runtime_test.ts internal/codegen/json_runtime_test.ts

bin:
	mkdir -p bin

clean:
	rm -rf bin
