package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// CNB AI quota card: server-side proxy for CNB's org charge API (credits and
// core-hours) plus token usage aggregated from our own consume logs. The card
// is admin-only (route registered behind AdminAuth) and is enabled once
// CNB_QUOTA_TOKEN is present in the environment:
//
//	CNB_QUOTA_TOKEN       CNB token allowed to read the org's billing
//	CNB_QUOTA_ORG         CNB org path, e.g. "acme/web"
//	CNB_QUOTA_CHANNEL_IDS optional comma-separated channel ids; token usage
//	                      is scoped to those channels (default: all channels)

const (
	cnbAPIBase     = "https://api.cnb.cool"
	cnbQuotaTTL    = 5 * time.Minute
	cnbHTTPTimeout = 15 * time.Second
	cnbTZOffset    = int64(8 * 3600) // card day boundaries are UTC+8
	cnbUsageWindow = 89 * 86400      // cumulative token usage window (90 days incl. today)
)

var errCnbQuotaDisabled = errors.New("CNB 额度卡片未启用（未设置 CNB_QUOTA_TOKEN）")

// cnbResource is one billed resource: AI credits (milli÷1000) or core-hours
// (sec÷3600). Freeze is the in-flight (reserved but unsettled) amount.
type cnbResource struct {
	Total  float64 `json:"total"`
	Used   float64 `json:"used"`
	Freeze float64 `json:"freeze"`
}

type cnbDailyPoint struct {
	Date             string `json:"date"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	Requests         int64  `json:"requests"`
}

type cnbUsageView struct {
	Today      model.CnbDailyUsage `json:"today"`
	Cumulative model.CnbDailyUsage `json:"cumulative"`
	Daily      []cnbDailyPoint     `json:"daily"`
}

type CnbQuotaSnapshot struct {
	Org       string       `json:"org"`
	Credits   cnbResource  `json:"credits"`
	Dev       cnbResource  `json:"dev"`
	CI        cnbResource  `json:"ci"`
	Usage     cnbUsageView `json:"usage"`
	FetchedAt int64        `json:"fetched_at"`
}

var (
	cnbQuotaMu      sync.Mutex
	cnbQuotaCache   *CnbQuotaSnapshot
	cnbQuotaCacheAt time.Time
)

func cnbQuotaToken() string { return strings.TrimSpace(os.Getenv("CNB_QUOTA_TOKEN")) }
func cnbQuotaOrg() string   { return strings.TrimSpace(os.Getenv("CNB_QUOTA_ORG")) }

func cnbQuotaChannelIds() []int {
	raw := strings.TrimSpace(os.Getenv("CNB_QUOTA_CHANNEL_IDS"))
	if raw == "" {
		return nil
	}
	var ids []int
	for _, part := range strings.Split(raw, ",") {
		if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

// cnbChargeGet calls one CNB charge sub-resource, either "quota" (allowances)
// or "volume" (consumption + in-flight freeze), mirroring cnb2api's reader.
func cnbChargeGet(client *http.Client, org, kind, token string) (map[string]any, error) {
	endpoint := fmt.Sprintf("%s/%s/-/charge/%s", cnbAPIBase, org, kind)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 CNB /-/charge/%s 失败: %w", kind, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 CNB /-/charge/%s 响应失败: %w", kind, err)
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, fmt.Errorf("CNB /-/charge/%s 返回 %d（请检查 CNB_QUOTA_TOKEN 是否有该组织账单读取权限）", kind, resp.StatusCode)
	case http.StatusNotFound:
		return nil, fmt.Errorf("CNB /-/charge/%s 返回 %d（请检查 CNB_QUOTA_ORG 组织路径）", kind, resp.StatusCode)
	case http.StatusOK:
		// fall through to parse
	default:
		return nil, fmt.Errorf("CNB /-/charge/%s 返回 %d: %.200s", kind, resp.StatusCode, body)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析 CNB /-/charge/%s 响应失败: %w", kind, err)
	}
	return parsed, nil
}

func cnbNum(m map[string]any, key string) float64 {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return v
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return f
		}
	}
	return 0
}

func cnbSub(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return nil
}

// normalizeCnbCharge mirrors cnb2api's normalize: milli units ÷1000 = credits,
// seconds ÷3600 = core-hours; missing fields degrade to zero.
func normalizeCnbCharge(org string, quota, volume map[string]any) (string, cnbResource, cnbResource, cnbResource) {
	milli := func(v float64) float64 { return v / 1000 }
	secH := func(v float64) float64 { return v / 3600 }

	credits := cnbResource{
		Total:  milli(cnbNum(cnbSub(quota, "credit_in_milli"), "total")),
		Used:   milli(cnbNum(volume, "credit_in_milli")),
		Freeze: milli(cnbNum(volume, "freeze_credit_in_milli")),
	}
	dev := cnbResource{
		Total:  secH(cnbNum(cnbSub(quota, "dev_in_sec"), "total")),
		Used:   secH(cnbNum(volume, "dev_in_sec")),
		Freeze: secH(cnbNum(volume, "freeze_dev_in_sec")),
	}
	ci := cnbResource{
		Total: secH(cnbNum(cnbSub(quota, "ci_in_sec"), "total")),
		Used:  secH(cnbNum(volume, "ci_in_sec")),
	}
	return org, credits, dev, ci
}

func collectCnbUsage() (cnbUsageView, error) {
	channelIds := cnbQuotaChannelIds()
	now := time.Now().Unix()
	dayBucket := model.CnbDayBucket(now, cnbTZOffset)
	start := dayBucket - cnbTZOffset - cnbUsageWindow // 89 full days + today, UTC+8

	stats, err := model.GetCnbTokenUsage(start, now+1, cnbTZOffset, channelIds)
	if err != nil {
		return cnbUsageView{}, err
	}

	view := cnbUsageView{
		Cumulative: model.CnbDailyUsage{
			PromptTokens:     stats.PromptTokens,
			CompletionTokens: stats.CompletionTokens,
			Requests:         stats.Requests,
		},
		Daily: make([]cnbDailyPoint, 0, 7),
	}
	if today, ok := stats.Daily[dayBucket]; ok {
		view.Today = today
	}
	for i := 6; i >= 0; i-- {
		bucket := dayBucket - int64(i)*86400
		point := cnbDailyPoint{Date: model.CnbBucketDate(bucket)}
		if day, ok := stats.Daily[bucket]; ok {
			point.PromptTokens = day.PromptTokens
			point.CompletionTokens = day.CompletionTokens
			point.Requests = day.Requests
		}
		view.Daily = append(view.Daily, point)
	}
	return view, nil
}

// fetchCnbQuotaSnapshot builds a fresh snapshot from CNB + local logs. The
// cache mutex is never held across the network calls.
func fetchCnbQuotaSnapshot(force bool) (*CnbQuotaSnapshot, error) {
	if !force {
		cnbQuotaMu.Lock()
		cached := cnbQuotaCache
		fresh := cached != nil && time.Since(cnbQuotaCacheAt) < cnbQuotaTTL
		cnbQuotaMu.Unlock()
		if fresh {
			return cached, nil
		}
	}

	token := cnbQuotaToken()
	org := cnbQuotaOrg()
	if token == "" {
		return nil, errCnbQuotaDisabled
	}
	if org == "" {
		return nil, errors.New("未配置 CNB_QUOTA_ORG（CNB 组织路径，如 acme/web）")
	}

	client := &http.Client{Timeout: cnbHTTPTimeout}
	var quota, volume map[string]any
	var errQuota, errVolume error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); quota, errQuota = cnbChargeGet(client, org, "quota", token) }()
	go func() { defer wg.Done(); volume, errVolume = cnbChargeGet(client, org, "volume", token) }()
	wg.Wait()

	if errQuota != nil || errVolume != nil {
		// Serve the last good snapshot so a transient upstream failure does
		// not blank out the card.
		cnbQuotaMu.Lock()
		stale := cnbQuotaCache
		cnbQuotaMu.Unlock()
		if stale != nil {
			return stale, nil
		}
		if errQuota != nil {
			return nil, errQuota
		}
		return nil, errVolume
	}

	_, credits, dev, ci := normalizeCnbCharge(org, quota, volume)
	snapshot := &CnbQuotaSnapshot{
		Org:     org,
		Credits: credits,
		Dev:     dev,
		CI:      ci,
	}
	// A failure while aggregating local usage must not kill the CNB half of
	// the card; the usage section just stays zeroed until the next refresh.
	if usage, err := collectCnbUsage(); err == nil {
		snapshot.Usage = usage
	} else {
		common.SysError("cnb quota card: token usage aggregation failed: " + err.Error())
	}
	snapshot.FetchedAt = time.Now().Unix()

	cnbQuotaMu.Lock()
	cnbQuotaCache = snapshot
	cnbQuotaCacheAt = time.Now()
	cnbQuotaMu.Unlock()
	return snapshot, nil
}

// GetCnbQuota returns the payload for the admin CNB AI quota card. Pass
// ?refresh=1 to bypass the 5-minute cache.
func GetCnbQuota(c *gin.Context) {
	if cnbQuotaToken() == "" {
		common.ApiSuccess(c, gin.H{"enabled": false})
		return
	}
	snapshot, err := fetchCnbQuotaSnapshot(c.Query("refresh") == "1")
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{
		"enabled": true,
		"quota":   snapshot,
	})
}
