package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestPinnedSchemaAndOracle(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, tc := range []struct {
		path, digest string
		oracle       bool
	}{
		{"protocol/codegen.proto", "1b4ab1166ccfd3f5ff83e8bc6f80d7b19a70060f8070131730cadaf7ab34c093", false},
		{"internal/testpb/codegen.pb.go", "ee064a2792bc5cad34a6721e7ce7c0652fda6e67fa19de258f3a7c454a16e668", true},
	} {
		data, err := os.ReadFile(filepath.Join(root, tc.path))
		if err != nil {
			t.Fatal(err)
		}
		if tc.oracle {
			data = bytes.Replace(data, []byte("package testpb\n"), []byte("package plugin\n"), 1)
		}
		if got := fmt.Sprintf("%x", sha256.Sum256(data)); got != tc.digest {
			t.Errorf("%s differs from pinned sqlc v1.31.1: %s", tc.path, got)
		}
	}
}

func TestGeneratedProtocolMatchesSchema(t *testing.T) {
	if _, err := exec.LookPath(protocPath()); err != nil {
		t.Skip("install protoc to check the generated protocol against its pinned schema")
	}
	root := filepath.Join("..", "..", "..", "protocol")
	output := filepath.Join(t.TempDir(), "codegen.go")
	if err := generate(filepath.Join(root, "codegen.proto"), output, false); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(root, "codegen.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("protocol/codegen.go is stale; run go generate ./protocol")
	}
	if err := generate(filepath.Join(root, "codegen.proto"), output, true); err != nil {
		t.Fatal("check rejected current generated output:", err)
	}
	stale := []byte("stale output\n")
	if err := os.WriteFile(output, stale, 0644); err != nil {
		t.Fatal(err)
	}
	if err := generate(filepath.Join(root, "codegen.proto"), output, true); err == nil {
		t.Fatal("check accepted stale generated output")
	}
	got, err = os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, stale) {
		t.Fatal("check rewrote stale output")
	}
}
