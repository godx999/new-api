package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Per-model usage for the "usage details" page: spend, tokens and call count
// per model over a time range, plus a bucketed series for the trend chart.

const (
	// Ordinary users may look back a full year; the table is an aggregate, so
	// the query stays cheap.
	maxModelUsageSpanSeconds = int64(366 * 86400)
	// Guard against a bogus client timezone skewing the day buckets.
	maxModelUsageTZOffset = int64(14 * 3600)
)

type modelUsageSummary struct {
	Quota      int `json:"quota"`
	TokenUsed  int `json:"token_used"`
	Count      int `json:"count"`
	ModelCount int `json:"model_count"`
}

type modelUsageItem struct {
	ModelName  string `json:"model_name"`
	Quota      int    `json:"quota"`
	TokenUsed  int    `json:"token_used"`
	Count      int    `json:"count"`
	LastUsedAt int64  `json:"last_used_at"`
	// Available reports whether the model still has an enabled channel. Models
	// whose channels are gone keep their historical usage but are flagged so
	// the UI can hide them behind a toggle.
	Available bool `json:"available"`
}

type modelUsagePoint struct {
	ModelName string `json:"model_name"`
	CreatedAt int64  `json:"created_at"`
	Quota     int    `json:"quota"`
	TokenUsed int    `json:"token_used"`
	Count     int    `json:"count"`
}

func parseModelUsageQuery(c *gin.Context) (start, end, tzOffset int64, ok bool) {
	start, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || start <= 0 {
		common.ApiErrorMsg(c, "invalid start_timestamp")
		return 0, 0, 0, false
	}
	end, err = strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || end <= 0 || end < start {
		common.ApiErrorMsg(c, "invalid end_timestamp")
		return 0, 0, 0, false
	}
	tzOffset, _ = strconv.ParseInt(c.Query("tz_offset"), 10, 64)
	if tzOffset > maxModelUsageTZOffset || tzOffset < -maxModelUsageTZOffset {
		tzOffset = 0
	}
	return start, end, tzOffset, true
}

func buildModelUsagePayload(start, end, tzOffset int64, granularity string, userID int, username string) (gin.H, error) {
	rows, err := model.GetModelUsageSummary(start, end, userID, username)
	if err != nil {
		return nil, err
	}
	series, err := model.GetModelUsageSeries(start, end, tzOffset, userID, username)
	if err != nil {
		return nil, err
	}

	enabled := make(map[string]bool)
	for _, name := range model.GetEnabledModels() {
		enabled[name] = true
	}

	// quota_data timestamps are hour buckets; the logs carry the exact request
	// time, so prefer them for the "last used" column (minute-level).
	lastUsedExact := model.GetModelLastUsedAt(start, end, userID, username)

	summary := modelUsageSummary{ModelCount: len(rows)}
	items := make([]modelUsageItem, 0, len(rows))
	for _, row := range rows {
		summary.Quota += row.Quota
		summary.TokenUsed += row.TokenUsed
		summary.Count += row.Count
		lastUsedAt := row.LastUsedAt
		if at, ok := lastUsedExact[row.ModelName]; ok {
			lastUsedAt = at
		}
		items = append(items, modelUsageItem{
			ModelName:  row.ModelName,
			Quota:      row.Quota,
			TokenUsed:  row.TokenUsed,
			Count:      row.Count,
			LastUsedAt: lastUsedAt,
			Available:  enabled[row.ModelName],
		})
	}

	return gin.H{
		"summary": summary,
		"models":  items,
		"series":  mergeModelUsageBuckets(series, tzOffset, granularity),
	}, nil
}

// mergeModelUsageBuckets folds day buckets into the requested granularity so
// the client receives one point per week/month. Merging in Go avoids
// dialect-specific date functions entirely.
func mergeModelUsageBuckets(rows []model.ModelUsageBucketRow, tzOffset int64, granularity string) []modelUsagePoint {
	type key struct {
		model  string
		bucket int64
	}
	merged := make(map[key]*modelUsagePoint)
	order := make([]key, 0, len(rows))
	for _, row := range rows {
		bucket := model.AlignModelUsageBucket(row.Bucket, tzOffset, granularity)
		k := key{model: row.ModelName, bucket: bucket}
		point, ok := merged[k]
		if !ok {
			point = &modelUsagePoint{ModelName: row.ModelName, CreatedAt: bucket}
			merged[k] = point
			order = append(order, k)
		}
		point.Quota += row.Quota
		point.TokenUsed += row.TokenUsed
		point.Count += row.Count
	}
	points := make([]modelUsagePoint, 0, len(order))
	for _, k := range order {
		points = append(points, *merged[k])
	}
	return points
}

// GetModelUsage serves the admin view: every user's usage, optionally narrowed
// to one username.
func GetModelUsage(c *gin.Context) {
	start, end, tzOffset, ok := parseModelUsageQuery(c)
	if !ok {
		return
	}
	payload, err := buildModelUsagePayload(start, end, tzOffset, c.Query("granularity"), 0, c.Query("username"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}

// GetUserModelUsage serves the same payload scoped to the signed-in user.
func GetUserModelUsage(c *gin.Context) {
	start, end, tzOffset, ok := parseModelUsageQuery(c)
	if !ok {
		return
	}
	if end-start > maxModelUsageSpanSeconds {
		common.ApiErrorMsg(c, "时间跨度不能超过 366 天")
		return
	}
	payload, err := buildModelUsagePayload(start, end, tzOffset, c.Query("granularity"), c.GetInt("id"), "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, payload)
}
