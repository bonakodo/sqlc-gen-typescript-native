package transport

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

func TestRunProtocol(t *testing.T) {
	request := &protocol.GenerateRequest{Settings: &protocol.Settings{Engine: "sqlite"}, PluginOptions: []byte(`{"driver":"better-sqlite3"}`)}
	input, err := request.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	want := &protocol.GenerateResponse{Files: []*protocol.File{{Name: "query.ts", Contents: []byte("export const sql = 'SELECT 1';\n")}}}
	wantBytes, err := want.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{nil, {"/plugin.CodegenService/Generate"}, {"plugin.CodegenService/Generate"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			calls := 0
			status := Run(args, bytes.NewReader(input), &stdout, &stderr, func(ctx context.Context, req *protocol.GenerateRequest) (*protocol.GenerateResponse, error) {
				calls++
				if ctx == nil || ctx.Err() != nil || req.GetSettings().GetEngine() != "sqlite" || !bytes.Equal(req.PluginOptions, request.PluginOptions) {
					t.Fatalf("wrong request: %#v", req)
				}
				return want, nil
			})
			if status != 0 || calls != 1 || stderr.Len() != 0 || !bytes.Equal(stdout.Bytes(), wantBytes) {
				t.Fatalf("status=%d calls=%d stdout=%q stderr=%q", status, calls, stdout.Bytes(), stderr.String())
			}
		})
	}
}

func TestRunRejectsBadInputBeforeGeneration(t *testing.T) {
	for _, tc := range []struct {
		name  string
		args  []string
		input io.Reader
	}{
		{"invalid protobuf", nil, bytes.NewReader([]byte{0x0a, 0x80})},
		{"read error", nil, errorReader{}},
		{"unknown method", []string{"/plugin.CodegenService/Other"}, strings.NewReader("")},
		{"unknown service", []string{"/other/Generate"}, strings.NewReader("")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			status := Run(tc.args, tc.input, &stdout, &stderr, func(context.Context, *protocol.GenerateRequest) (*protocol.GenerateResponse, error) {
				t.Fatal("invalid input reached generator")
				return nil, nil
			})
			if status != 2 || stdout.Len() != 0 || stderr.Len() == 0 {
				t.Fatalf("status=%d stdout=%q stderr=%q", status, stdout.String(), stderr.String())
			}
		})
	}
}

func TestRunGeneratorErrorsDoNotWriteProtocolBytes(t *testing.T) {
	for _, tc := range []struct {
		name     string
		response *protocol.GenerateResponse
		err      error
	}{
		{"generation failed", nil, errors.New("bad driver option")},
		{"nil response", nil, nil},
		{"invalid response string", &protocol.GenerateResponse{Files: []*protocol.File{{Name: string([]byte{0xff})}}}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			status := Run(nil, strings.NewReader(""), &stdout, &stderr, func(context.Context, *protocol.GenerateRequest) (*protocol.GenerateResponse, error) {
				return tc.response, tc.err
			})
			if status != 2 || stdout.Len() != 0 || stderr.Len() == 0 {
				t.Fatalf("status=%d stdout=%q stderr=%q", status, stdout.String(), stderr.String())
			}
		})
	}
}

func TestRunReportsOutputFailures(t *testing.T) {
	for _, output := range []io.Writer{errorWriter{}, shortWriter{}} {
		var stderr bytes.Buffer
		status := Run(nil, strings.NewReader(""), output, &stderr, func(context.Context, *protocol.GenerateRequest) (*protocol.GenerateResponse, error) {
			return &protocol.GenerateResponse{Files: []*protocol.File{{Name: "models.ts"}}}, nil
		})
		if status != 2 || stderr.Len() == 0 {
			t.Fatalf("status=%d stderr=%q", status, stderr.String())
		}
	}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, errors.New("read failed") }

type errorWriter struct{}

func (errorWriter) Write([]byte) (int, error) { return 0, errors.New("write failed") }

type shortWriter struct{}

func (shortWriter) Write(b []byte) (int, error) { return len(b) - 1, nil }
