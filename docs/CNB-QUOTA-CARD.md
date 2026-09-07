# CNB AI 额度卡片（CNB Quota Card）

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

## 本地开发

```bash
# 前端（web/ 目录，使用 bun）
cd web && bun install --frozen-lockfile
bun run typecheck && bun run build

# 后端（需要 Go ≥ 1.25）
go build ./... && go vet ./controller ./model ./router
```
