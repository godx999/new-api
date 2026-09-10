# CNB 额度卡片 · 使用详细 · 模型状态

本分支（`cnb-quota-card`）在 new-api 上新增三个功能：**CNB AI 额度卡片**（管理员首页）、**使用详细**页面、**模型状态**页面。三者共用同一分支与同一镜像。

## 一、CNB AI 额度卡片

在 new-api 管理员控制台首页增加一张「CNB AI Quota」卡片，展示 CNB 云原生构建平台组织账单与本地 Token 用量：

- **Credits**（AI 额度）用量条 + 百分比，**Dev 核时**、**CI 核时** 用量条（红黄绿着色：<60% 绿，60–85% 黄，≥85% 红）
- 剩余 / 总额、预留中（in-flight，尚未结算）的额度与核时
- **Token 用量**：今日（UTC+8）与累计（近 90 天）的输入/输出 tokens、请求数；近 7 天迷你柱状图
- 每 5 分钟自动刷新（服务端对 CNB 接口做 5 分钟缓存；上游故障时自动回退展示上一次成功数据）

仅 **管理员** 可见：接口走 `AdminAuth`，前端面板仅对管理员渲染。未配置环境变量时卡片整体不出现。

数据来源：

| 数据 | 来源 |
|---|---|
| Credits / Dev / CI 核时 | CNB 官方接口 `https://api.cnb.cool/{org}/-/charge/quota` 与 `/-/charge/volume`（Bearer 令牌鉴权），换算规则 `*_in_milli÷1000=credits`、`*_in_sec÷3600=核时` |
| Token 用量 / 请求数 | new-api 自身 `logs` 表（consume 日志）聚合，无需依赖 cnb2api 反代在线 |

## 涉及文件

| 文件 | 说明 |
|---|---|
| `controller/cnb-quota.go` | CNB charge 接口代理、归一化、5 分钟缓存、聚合入口 |
| `model/log-stats.go` | 日志表 token/请求数聚合（兼容 SQLite/MySQL/PostgreSQL，无 SQL 方言日期函数） |
| `router/api-router.go` | 注册 `GET /api/cnb_quota`（`DisableCache` + `AdminAuth`） |
| `web/src/features/cnb-quota/` | 前端卡片（`api.ts` / `types.ts` / `components/cnb-quota-card.tsx`） |
| `web/src/features/dashboard/components/overview/overview-dashboard.tsx` | 控制台首页挂载（仅管理员） |
| `web/src/i18n/locales/{en,zh}.json` | 卡片文案 |
| `.github/workflows/docker-cnb.yml` | CI：构建并推送自定义 Docker 镜像到 GHCR |
| `controller/model-usage.go` | 使用详细：按模型的用量聚合接口（管理员 / 本人） |
| `model/usedata_models.go` | 使用详细：`quota_data` 按模型汇总 + 按天分桶（周/月在 Go 内合并，避免 SQL 方言差异） |
| `controller/model-status.go` | 模型状态：按模型聚合渠道探测结果、状态判定 |
| `model/channel_probe.go` | 模型状态：探测历史表 `channel_probes`，记录 / 清理 / 查询 |
| `setting/operation_setting/sidebar_modules.go` | 侧边栏模块「功能」开关解析（兼容旧布尔值与新对象形态） |
| `controller/channel-test.go` | 渠道测试结束后记录一条探测历史（受功能开关控制） |
| `web/src/features/usage-details/` | 使用详细页面 |
| `web/src/features/model-status/` | 模型状态页面 |
| `web/src/features/system-settings/maintenance/{config.ts,sidebar-modules-section.tsx}` | 侧边栏模块双开关（功能 + 展示） |
| `web/src/hooks/use-sidebar-config.ts` | 侧边栏可见性与功能开关判定 |

## 配置（环境变量）

| 变量 | 必填 | 说明 |
|---|---|---|
| `CNB_QUOTA_TOKEN` | 是 | CNB 令牌，需有目标组织账单读取权限（在 CNB「设置 → 个人访问令牌」创建即可，无需流水线特殊 scope） |
| `CNB_QUOTA_ORG` | 是 | CNB 组织路径，如 `acme/web`（取 org 段） |
| `CNB_QUOTA_CHANNEL_IDS` | 否 | 逗号分隔的 new-api 渠道 id；Token 用量仅统计这些渠道。留空统计全部渠道 |

也可以写在挂载的 `.env` 文件中（new-api 启动时通过 godotenv 加载）。

手动强制刷新缓存：`GET /api/cnb_quota?refresh=1`。

## 部署（NAS / Docker）

因为改了源码，需要构建自定义镜像。已内置 GitHub Actions 工作流（`docker-cnb.yml`），推送 `cnb-quota-card` 分支即自动构建并推送镜像到 GHCR：

1. **Fork** `QuantumNous/new-api` 到你的 GitHub 账号。
2. 将本地的 `cnb-quota-card` 分支推送到你的 fork：
   ```bash
   git remote add fork https://github.com/<你的用户名>/new-api.git
   git push fork cnb-quota-card
   ```
3. 在 fork 仓库 **Settings → Actions → General** 允许 GitHub Actions 运行（GHCR 推送使用内置 `GITHUB_TOKEN`，无需额外密钥）。
4. 等 Actions 构建完成，镜像为 `ghcr.io/<你的用户名>/new-api:cnb`（另有 `cnb-<commit>` 形式的不可变 tag）。
5. 修改 NAS 上的 `docker-compose.yml`：
   ```yaml
   services:
     new-api:
       image: ghcr.io/<你的用户名>/new-api:cnb   # 原 calciumion/new-api:latest
       environment:
         - CNB_QUOTA_TOKEN=你的CNB令牌
         - CNB_QUOTA_ORG=你的组织路径/仓库
         # - CNB_QUOTA_CHANNEL_IDS=1,2
   ```
   然后重建容器：`docker compose pull && docker compose up -d`。
6. 管理员登录控制台 → 首页 Overview，即可看到 CNB AI Quota 卡片。

> 如果 `gh` CLI 已登录，第 1–2 步可以直接执行：`gh repo fork QuantumNous/new-api --clone=false && git push fork cnb-quota-card`。

## 同步上游更新

卡片功能的文件几乎全部为**新增文件**，对上游现有文件的改动只有三处一行级修改（路由注册、首页挂载、i18n 追加），因此同步上游的成本极低：

```bash
git remote add upstream https://github.com/QuantumNous/new-api.git
git fetch upstream
git checkout cnb-quota-card
git merge upstream/main        # 冲突只可能出现在上面三处小改动
git push fork cnb-quota-card   # 推送后 CI 自动构建新镜像
```

可选：添加定时工作流（如每周 `peter-evans/create-pull-request` 方案）自动向上游 main 合并并开 sync PR，人工确认无冲突后 merge 即完成更新。

若上游再次发生前端大版本重写，`web/src/features/cnb-quota/` 目录本身不受影响，只需按新结构重新挂载首页那一行。

## 二、使用详细 页面

- 位置：左侧「常规」分组 → **使用详细**（所有登录用户可见）
- 内容：按模型统计 **消费金额 / Token 用量 / 调用次数 / 占比 / 最后使用**；顶部为汇总卡与消费趋势图
- 时间：默认「近 12 个月 + 月粒度」，范围可切 今天 / 本周 / 本月 / 近 7 天 / 近 30 天 / 近 12 个月，粒度可切 天 / 周 / 月
- 权限：普通用户看自己的用量；管理员看全站，并可按用户名筛选
- 已删除模型：默认隐藏，顶部开关可显示（带「已删除」标记）；其历史用量**始终计入汇总**
- 数据来源：`quota_data` 表（由系统设置里的「数据看板数据导出」累积写入，从开启时起才有数据）。该表以模型名为纯字符串维度，模型被删除后历史行仍保留，因此已删除模型依旧可统计
- 接口：`GET /api/data/models`（管理员）、`GET /api/data/models/self`（本人，跨度上限 366 天）

## 三、模型状态 页面

- 位置：左侧「常规」分组 → **模型状态**（所有登录用户可见）
- 内容：每个模型的状态（正常 / 降级 / 异常 / 未检测）、响应时间、可用渠道 x/y、最后检测时间，以及**近 24 次检测**色块（绿=通过、黄=偏慢、红=失败）
- 顶部：检测间隔、上次检测时间、探测覆盖渠道数；汇总卡为 正常 / 降级 / 异常 / 可用率
- 数据来源：系统设置里的「**定期渠道测试**」（`monitor_setting.auto_test_channel_enabled` + `auto_test_channel_minutes`，默认 10 分钟）。每次测试结束后记录一条探测历史
- **列表口径**：只列出**至少有一个启用渠道**的模型——某个渠道被关闭后，若该模型没有其他可用渠道，就会从本页消失
- **注意**：每个渠道只探测它的「测试模型」一个模型，因此其余模型的响应时间取自所属渠道的探测结果
- 与模型广场的区别：模型广场要求模型「已上架」（元数据状态启用）且至少有一个启用渠道；本页只要求有启用渠道，因此可能多出「有渠道可调用、但未上架到广场」的模型
- 探测历史保留 **7 天**（滚动清理，每小时最多触发一次），数据表 `channel_probes`
- 接口：`GET /api/model_status`

> 术语说明：设置里的「保持连接心跳 (Keep-alive Ping)」是流式响应的 ping 帧（单位秒），**不产生状态数据**；本页联动的是「定期渠道测试 / 测试间隔（分钟）」。

## 四、侧边栏模块双开关

系统设置 → **站点与品牌** → **侧边栏模块** 中，「使用详细」与「模型状态」各有两个开关：

| 开关 | 作用 |
|---|---|
| **功能** | 页面是否可用。关闭后页面提示「该功能已在系统设置中关闭」；模型状态还会**停止记录探测历史**（表不再增长） |
| **展示** | 是否在左侧边栏显示。关闭后仅隐藏入口，仍可用网址直接访问 |

- 其余模块保持原来的单个开关，不受影响
- 配置向后兼容：新增模块会自动出现在已有部署的设置页里，**无需重置配置**

## 本地开发

```bash
# 前端（web/ 目录，使用 bun）
cd web && bun install --frozen-lockfile
bun run typecheck && bun run build

# 后端（需要 Go ≥ 1.25）
go build ./... && go vet ./controller ./model ./router
```
