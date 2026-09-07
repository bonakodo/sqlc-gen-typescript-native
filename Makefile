GO ?= go
GOFMT ?= gofmt
DENO ?= deno

.DEFAULT_GOAL := all
.PHONY: all build wasm test vet fmt fmt-check check integration live runtime clean

all: build wasm

build: | bin
	CGO_ENABLED=0 $(GO) build -trimpath -o bin/sqlc-gen-typescript-native ./plugin

wasm: | bin
	CGO_ENABLED=0 GOOS=wasip1 GOARCH=wasm $(GO) build -trimpath -o bin/sqlc-gen-typescript-native.wasm ./plugin

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	$(GOFMT) -w .

fmt-check:
	@files=$$($(GOFMT) -l .); if [ -n "$$files" ]; then printf '%s\n' "$$files"; exit 1; fi

check: fmt-check vet test wasm

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
