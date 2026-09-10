package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Per-model usage aggregation behind the "usage details" page.
//
// The source is quota_data, which is keyed purely by model name (no foreign
// key, no join against model metadata), so rows belonging to a model that has
// since been deleted survive and stay reportable.

type ModelUsageRow struct {
	ModelName  string `json:"model_name"`
	Quota      int    `json:"quota"`
	TokenUsed  int    `json:"token_used"`
	Count      int    `json:"count"`
	LastUsedAt int64  `json:"last_used_at"`
}

// ModelUsageBucketRow is one model's usage inside a single time bucket. The
// bucket is the UTC timestamp of the local day boundary the row was folded
// into; callers merge day buckets into weeks/months.
type ModelUsageBucketRow struct {
	ModelName string `json:"model_name"`
	Bucket    int64  `json:"bucket"`
	Quota     int    `json:"quota"`
	TokenUsed int    `json:"token_used"`
	Count     int    `json:"count"`
}

// modelUsageFilter scopes a quota_data query to a time range and to either one
// user (userID > 0) or one username (admin filtering).
func modelUsageFilter(start, end int64, userID int, username string) *gorm.DB {
	tx := DB.Table("quota_data").Where("created_at >= ? AND created_at <= ?", start, end)
	if userID > 0 {
		tx = tx.Where("user_id = ?", userID)
	} else if username != "" {
		tx = tx.Where("username = ?", username)
	}
	return tx
}

// GetModelUsageSummary totals quota, tokens and calls per model, most spend
// first.
func GetModelUsageSummary(start, end int64, userID int, username string) ([]ModelUsageRow, error) {
	var rows []ModelUsageRow
	err := modelUsageFilter(start, end, userID, username).
		Select("model_name, SUM(quota) AS quota, SUM(token_used) AS token_used, SUM(count) AS count, MAX(created_at) AS last_used_at").
		Group("model_name").
		Order("quota DESC").
		Scan(&rows).Error
	if err != nil {
		common.SysError("failed to aggregate model usage: " + err.Error())
		return nil, errors.New("查询模型用量失败")
	}
	return rows, nil
}

// dayBucketExpr folds created_at into local day boundaries. Plain integer
// arithmetic keeps the query portable across SQLite, MySQL and PostgreSQL.
// The offset is inlined rather than bound because GORM's Group() clause takes
// no bindings; callers clamp it to ±14h first, so inlining is safe.
func dayBucketExpr(tzOffset int64) string {
	return fmt.Sprintf("(created_at + %d) - ((created_at + %d) %% 86400) - %d", tzOffset, tzOffset, tzOffset)
}

// GetModelUsageSeries buckets per-model usage by day. tzOffset shifts the day
// boundary so buckets match the viewer's timezone.
func GetModelUsageSeries(start, end, tzOffset int64, userID int, username string) ([]ModelUsageBucketRow, error) {
	var rows []ModelUsageBucketRow
	expr := dayBucketExpr(tzOffset)
	err := modelUsageFilter(start, end, userID, username).
		Select("model_name, "+expr+" AS bucket, SUM(quota) AS quota, SUM(token_used) AS token_used, SUM(count) AS count").
		Group("model_name, " + expr).
		Order("bucket ASC").
		Scan(&rows).Error
	if err != nil {
		common.SysError("failed to aggregate model usage series: " + err.Error())
		return nil, errors.New("查询模型用量趋势失败")
	}
	return rows, nil
}

// AlignModelUsageBucket folds a day bucket to the requested granularity, still
// expressed in the viewer's timezone. Week buckets start on Monday, month
// buckets on the 1st.
func AlignModelUsageBucket(bucket, tzOffset int64, granularity string) int64 {
	if granularity != "week" && granularity != "month" {
		return bucket
	}
	// bucket + tzOffset is local midnight rendered as UTC seconds.
	local := time.Unix(bucket+tzOffset, 0).UTC()
	switch granularity {
	case "week":
		daysSinceMonday := (int(local.Weekday()) + 6) % 7
		local = local.AddDate(0, 0, -daysSinceMonday)
	case "month":
		local = local.AddDate(0, 0, -(local.Day() - 1))
	}
	return local.Unix() - tzOffset
}

// GetModelLastUsedAt returns the exact last-request timestamp per model from
// the consume logs. quota_data only keeps hourly buckets (its created_at is
// floored to the hour), which is why the UI would otherwise show on-the-hour
// times; this lets it render down to the minute. Errors are swallowed on
// purpose — callers fall back to the hourly value.
func GetModelLastUsedAt(start, end int64, userID int, username string) map[string]int64 {
	type lastUsedRow struct {
		ModelName  string
		LastUsedAt int64
	}
	var rows []lastUsedRow
	tx := LOG_DB.Table("logs").
		Select("model_name, MAX(created_at) AS last_used_at").
		Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, start, end)
	if userID > 0 {
		tx = tx.Where("user_id = ?", userID)
	} else if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if err := tx.Group("model_name").Scan(&rows).Error; err != nil {
		common.SysError("failed to load model last-used time: " + err.Error())
		return nil
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.ModelName] = row.LastUsedAt
	}
	return result
}
