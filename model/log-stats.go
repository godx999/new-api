package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Aggregated token usage for the CNB quota dashboard card, computed from the
// consume logs. Timestamps are unix seconds; day bucketing is done with plain
// integer arithmetic so the same query works on SQLite, MySQL and PostgreSQL.
type CnbUsageStats struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	Requests         int64 `json:"requests"`
	// Daily maps a day bucket ((created_at + tzOffset) aligned to 86400) to
	// that day's aggregated usage.
	Daily map[int64]CnbDailyUsage `json:"-"`
}

type CnbDailyUsage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	Requests         int64 `json:"requests"`
}

// CnbDayBucket returns the day bucket of a unix timestamp for the given UTC
// offset in seconds. For a timestamp that is exactly a UTC+offset midnight the
// bucket equals timestamp+tzOffset.
func CnbDayBucket(timestamp int64, tzOffset int64) int64 {
	shifted := timestamp + tzOffset
	return shifted - (shifted % 86400)
}

// CnbBucketDate renders a day bucket as YYYY-MM-DD in the shifted timezone.
func CnbBucketDate(bucket int64) string {
	return time.Unix(bucket, 0).UTC().Format("2006-01-02")
}

type cnbUsageRow struct {
	PromptTokens     int64
	CompletionTokens int64
	Requests         int64
}

type cnbDailyRow struct {
	Day              int64
	PromptTokens     int64
	CompletionTokens int64
	Requests         int64
}

func cnbUsageQuery(start, end int64, channelIds []int) *gorm.DB {
	tx := LOG_DB.Table("logs").
		Where("type = ?", LogTypeConsume).
		Where("created_at >= ? AND created_at < ?", start, end)
	switch {
	case len(channelIds) == 1:
		tx = tx.Where("channel_id = ?", channelIds[0])
	case len(channelIds) > 1:
		tx = tx.Where("channel_id IN ?", channelIds)
	}
	return tx
}

// GetCnbTokenUsage aggregates prompt/completion tokens, request count and a
// per-day breakdown over [start, end) unix seconds, optionally restricted to
// channelIds (nil = no channel filter).
func GetCnbTokenUsage(start, end int64, tzOffset int64, channelIds []int) (*CnbUsageStats, error) {
	var totals cnbUsageRow
	if err := cnbUsageQuery(start, end, channelIds).
		Select("COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COUNT(*) AS requests").
		Scan(&totals).Error; err != nil {
		common.SysError("failed to aggregate cnb token usage: " + err.Error())
		return nil, errors.New("查询Token用量失败")
	}

	var daily []cnbDailyRow
	if err := cnbUsageQuery(start, end, channelIds).
		Select("(created_at + ?) - ((created_at + ?) % 86400) AS day, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COUNT(*) AS requests", tzOffset, tzOffset).
		Group("day").
		Order("day asc").
		Scan(&daily).Error; err != nil {
		common.SysError("failed to aggregate cnb daily usage: " + err.Error())
		return nil, errors.New("查询每日Token用量失败")
	}

	stats := &CnbUsageStats{
		PromptTokens:     totals.PromptTokens,
		CompletionTokens: totals.CompletionTokens,
		Requests:         totals.Requests,
		Daily:            make(map[int64]CnbDailyUsage, len(daily)),
	}
	for _, row := range daily {
		stats.Daily[row.Day] = CnbDailyUsage{
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			Requests:         row.Requests,
		}
	}
	return stats, nil
}
