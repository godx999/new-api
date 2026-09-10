package controller

import (
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// Model status page: per-model health derived from the scheduled channel tests
// (定期渠道测试). Each probe covers one channel, so a model's status aggregates
// the probes of every enabled channel serving it. A model with no enabled
// channel is not listed at all.

const (
	modelStatusProbeCount = 24
	// A successful probe slower than this is reported as "slow".
	modelStatusSlowLatencyMs = 5000
	modelStatusMinLookback   = int64(6 * 3600)
)

// Probe result codes; one block per probe in the UI strip.
const (
	probeResultPassed = 0
	probeResultSlow   = 1
	probeResultFailed = 2
)

type modelStatusProbeInfo struct {
	Enabled         bool    `json:"enabled"`
	IntervalMinutes float64 `json:"interval_minutes"`
	LastAt          int64   `json:"last_at"`
	NextAt          int64   `json:"next_at"`
	ChannelsCovered int     `json:"channels_covered"`
	ChannelsTotal   int     `json:"channels_total"`
}

type modelStatusItem struct {
	ModelName     string `json:"model_name"`
	State         string `json:"state"`
	LatencyMs     int    `json:"latency_ms"`
	ChannelsUp    int    `json:"channels_up"`
	ChannelsTotal int    `json:"channels_total"`
	LastProbeAt   int64  `json:"last_probe_at"`
	Recent        []int  `json:"recent"`
}

func probeResultCode(probe *model.ChannelProbe) int {
	if !probe.Success {
		return probeResultFailed
	}
	if probe.LatencyMs > modelStatusSlowLatencyMs {
		return probeResultSlow
	}
	return probeResultPassed
}

func modelStatusOrder(state string) int {
	switch state {
	case "ok":
		return 0
	case "warn":
		return 1
	case "err":
		return 2
	default:
		return 3
	}
}

// GetModelStatus reports the health of every model that still has at least one
// enabled channel, based on the probe history recorded by the scheduled
// channel test.
func GetModelStatus(c *gin.Context) {
	monitor := operation_setting.GetMonitorSetting()

	modelChannels, err := model.GetModelChannelMap()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	channelIdSet := make(map[int]bool)
	for _, channels := range modelChannels {
		for id := range channels {
			channelIdSet[id] = true
		}
	}
	channelIds := make([]int, 0, len(channelIdSet))
	for id := range channelIdSet {
		channelIds = append(channelIds, id)
	}
	sort.Ints(channelIds)

	intervalMinutes := monitor.AutoTestChannelMinutes
	if intervalMinutes <= 0 {
		intervalMinutes = 10
	}
	lookback := int64(intervalMinutes * 60 * float64(modelStatusProbeCount) * 2)
	if lookback < modelStatusMinLookback {
		lookback = modelStatusMinLookback
	}

	probes, err := model.GetChannelProbesSince(channelIds, common.GetTimestamp()-lookback)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byChannel := make(map[int][]*model.ChannelProbe, len(channelIds))
	for _, probe := range probes {
		byChannel[probe.ChannelId] = append(byChannel[probe.ChannelId], probe)
	}

	coveredChannels := 0
	var lastProbeAt int64
	for _, id := range channelIds {
		list := byChannel[id]
		if len(list) == 0 {
			continue
		}
		coveredChannels++
		if last := list[len(list)-1].CreatedAt; last > lastProbeAt {
			lastProbeAt = last
		}
	}

	items := make([]modelStatusItem, 0, len(modelChannels))
	for name, channels := range modelChannels {
		item := modelStatusItem{
			ModelName:     name,
			ChannelsTotal: len(channels),
			Recent:        make([]int, 0, modelStatusProbeCount),
		}

		merged := make([]*model.ChannelProbe, 0)
		latestPerChannel := make(map[int]*model.ChannelProbe, len(channels))
		for id := range channels {
			list := byChannel[id]
			if len(list) == 0 {
				continue
			}
			merged = append(merged, list...)
			latestPerChannel[id] = list[len(list)-1]
		}

		if len(merged) == 0 {
			item.State = "idle"
			items = append(items, item)
			continue
		}

		sort.Slice(merged, func(i, j int) bool {
			if merged[i].CreatedAt == merged[j].CreatedAt {
				return merged[i].Id < merged[j].Id
			}
			return merged[i].CreatedAt < merged[j].CreatedAt
		})
		item.LastProbeAt = merged[len(merged)-1].CreatedAt

		start := 0
		if len(merged) > modelStatusProbeCount {
			start = len(merged) - modelStatusProbeCount
		}
		for _, probe := range merged[start:] {
			item.Recent = append(item.Recent, probeResultCode(probe))
		}

		totalLatency := 0
		successCount := 0
		for _, probe := range latestPerChannel {
			if probe.Success {
				item.ChannelsUp++
				totalLatency += probe.LatencyMs
				successCount++
			}
		}
		if successCount > 0 {
			item.LatencyMs = totalLatency / successCount
		}

		switch {
		case item.ChannelsUp == 0:
			item.State = "err"
		case item.ChannelsUp < item.ChannelsTotal || item.LatencyMs > modelStatusSlowLatencyMs:
			item.State = "warn"
		default:
			item.State = "ok"
		}
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		if left, right := modelStatusOrder(items[i].State), modelStatusOrder(items[j].State); left != right {
			return left < right
		}
		return items[i].ModelName < items[j].ModelName
	})

	nextAt := int64(0)
	if lastProbeAt > 0 {
		nextAt = lastProbeAt + int64(intervalMinutes*60)
	}

	common.ApiSuccess(c, gin.H{
		"probe": modelStatusProbeInfo{
			Enabled:         monitor.AutoTestChannelEnabled,
			IntervalMinutes: intervalMinutes,
			LastAt:          lastProbeAt,
			NextAt:          nextAt,
			ChannelsCovered: coveredChannels,
			ChannelsTotal:   len(channelIds),
		},
		"models": items,
	})
}
