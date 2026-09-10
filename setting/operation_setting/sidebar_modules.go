package operation_setting

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// SidebarModulesAdminOptionKey holds the admin sidebar module configuration: a
// JSON object keyed by section, then by module.
const SidebarModulesAdminOptionKey = "SidebarModulesAdmin"

// jsonBool reads a JSON value that must be a plain boolean.
func jsonBool(raw json.RawMessage, fallback bool) bool {
	switch strings.TrimSpace(string(raw)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return fallback
	}
}

// objectField extracts one field from a JSON object.
func objectField(raw json.RawMessage, key string) (json.RawMessage, bool) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, false
	}
	value, ok := obj[key]
	return value, ok
}

// IsSidebarModuleFeatureEnabled reports whether a sidebar module's feature
// switch is on. Modules are stored either as a legacy plain boolean (display
// only, feature always on) or as an object with separate switches:
//
//	"detail": true
//	"model_status": {"enabled": true, "visible": true}
//
// The section master switch and the module's own switch must both be enabled.
// Anything missing or unreadable defaults to enabled, so upgrading never
// silently turns a feature off.
func IsSidebarModuleFeatureEnabled(section, module string) bool {
	raw := strings.TrimSpace(common.OptionMap[SidebarModulesAdminOptionKey])
	if raw == "" {
		return true
	}
	var parsed map[string]map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return true
	}
	sectionConfig, ok := parsed[section]
	if !ok {
		return true
	}
	if sectionRaw, ok := sectionConfig["enabled"]; ok && !jsonBool(sectionRaw, true) {
		return false
	}
	moduleRaw, ok := sectionConfig[module]
	if !ok {
		return true
	}
	if enabled, ok := objectField(moduleRaw, "enabled"); ok {
		return jsonBool(enabled, true)
	}
	return true
}
