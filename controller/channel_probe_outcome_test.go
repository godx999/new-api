package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// probeOutcome decides whether a channel test result should be persisted as a
// probe. Upstream failures set BOTH localErr and newAPIError, so gating on
// localErr == nil would silently drop every real failure and leave the model
// status page showing "idle" for a dead channel.
func TestProbeOutcome(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	upstreamErr := errors.New("upstream boom")

	tests := []struct {
		name        string
		result      testResult
		wantRan     bool
		wantSuccess bool
	}{
		{
			name:        "success",
			result:      testResult{context: ctx},
			wantRan:     true,
			wantSuccess: true,
		},
		{
			// HTTP non-200 / DoRequest / DoResponse: both fields set.
			name: "upstream failure carries both errors",
			result: testResult{
				context:     ctx,
				localErr:    upstreamErr,
				newAPIError: types.NewOpenAIError(upstreamErr, types.ErrorCodeBadResponse, http.StatusInternalServerError),
			},
			wantRan:     true,
			wantSuccess: false,
		},
		{
			// Health check synthesises a response-time error on a healthy call.
			name: "synthetic health-check failure has no local error",
			result: testResult{
				context:     ctx,
				newAPIError: types.NewOpenAIError(upstreamErr, types.ErrorCodeChannelResponseTimeExceeded, http.StatusRequestTimeout),
			},
			wantRan:     true,
			wantSuccess: false,
		},
		{
			// Unsupported channel type and GetUserCache failure both return
			// before a test context exists, so neither ever reached upstream.
			name:        "purely local failure stays untracked",
			result:      testResult{localErr: upstreamErr},
			wantRan:     false,
			wantSuccess: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ran, success := probeOutcome(tt.result)
			assert.Equal(t, tt.wantRan, ran)
			assert.Equal(t, tt.wantSuccess, success)
		})
	}
}
