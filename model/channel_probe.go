package model

import (
	"errors"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

// ChannelProbe is one result of the scheduled channel test (定期渠道测试).
// The channel row only keeps the latest result; this short rolling history is
// what lets the model status page draw a per-model probe strip.
type ChannelProbe struct {
	Id        int    `json:"id"`
	ChannelId int    `json:"channel_id" gorm:"index:idx_channel_probe_channel_time,priority:1"`
	ModelName string `json:"model_name" gorm:"size:255;default:''"`
	Success   bool   `json:"success"`
	LatencyMs int    `json:"latency_ms"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index:idx_channel_probe_channel_time,priority:2"`
}

// ChannelProbeRetentionDays bounds how long probe history is kept.
const ChannelProbeRetentionDays = 7

// RecordChannelProbe appends one probe result. Failures are logged but never
// propagated: recording history must not affect the test outcome.
func RecordChannelProbe(channelId int, modelName string, success bool, latencyMs int) {
	if DB == nil || channelId <= 0 {
		return
	}
	probe := &ChannelProbe{
		ChannelId: channelId,
		ModelName: modelName,
		Success:   success,
		LatencyMs: latencyMs,
		CreatedAt: common.GetTimestamp(),
	}
	if err := DB.Create(probe).Error; err != nil {
		common.SysError("failed to record channel probe: " + err.Error())
	}
	maybeCleanupChannelProbes()
}

// lastProbeCleanupAt guards the retention sweep so it runs at most hourly.
var lastProbeCleanupAt int64

func maybeCleanupChannelProbes() {
	now := common.GetTimestamp()
	last := atomic.LoadInt64(&lastProbeCleanupAt)
	if now-last < 3600 {
		return
	}
	if !atomic.CompareAndSwapInt64(&lastProbeCleanupAt, last, now) {
		return
	}
	CleanupChannelProbes()
}

// CleanupChannelProbes drops history older than the retention window; called
// once per test cycle so the table stays bounded.
func CleanupChannelProbes() {
	if DB == nil {
		return
	}
	cutoff := common.GetTimestamp() - int64(ChannelProbeRetentionDays)*86400
	if err := DB.Where("created_at < ?", cutoff).Delete(&ChannelProbe{}).Error; err != nil {
		common.SysError("failed to cleanup channel probes: " + err.Error())
	}
}

// GetChannelProbesSince loads probe history for the given channels.
func GetChannelProbesSince(channelIds []int, since int64) ([]*ChannelProbe, error) {
	if len(channelIds) == 0 {
		return nil, nil
	}
	var probes []*ChannelProbe
	err := DB.Where("channel_id IN ? AND created_at >= ?", channelIds, since).
		Order("created_at ASC").
		Find(&probes).Error
	if err != nil {
		common.SysError("failed to load channel probes: " + err.Error())
		return nil, errors.New("查询渠道探测记录失败")
	}
	return probes, nil
}

// GetModelChannelMap returns, for every model that has at least one enabled
// ability, the set of enabled channel ids serving it. Channels that are turned
// off are excluded, which is what makes a model disappear from the model status
// page once all of its channels are disabled.
func GetModelChannelMap() (map[string]map[int]bool, error) {
	var rows []struct {
		Model     string
		ChannelId int
	}
	err := DB.Table("abilities").
		Select("abilities.model AS model, abilities.channel_id AS channel_id").
		Joins("left join channels on abilities.channel_id = channels.id").
		Where("abilities.enabled = ? AND channels.status = ?", true, common.ChannelStatusEnabled).
		Scan(&rows).Error
	if err != nil {
		common.SysError("failed to load model channel map: " + err.Error())
		return nil, errors.New("查询模型渠道失败")
	}
	result := make(map[string]map[int]bool, len(rows))
	for _, row := range rows {
		if row.Model == "" || row.ChannelId <= 0 {
			continue
		}
		channels, ok := result[row.Model]
		if !ok {
			channels = make(map[int]bool)
			result[row.Model] = channels
		}
		channels[row.ChannelId] = true
	}
	return result, nil
}
