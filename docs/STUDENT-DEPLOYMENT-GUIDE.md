# 学生版部署执行手册

这份手册用于部署严格零预算的 assessment walking skeleton：合成租户、`FakeProvider`、CloudFront
默认域名、按需 Lambda 和 Neon Free。它不会部署 OpenAI/Gemini、真实客户数据或生产管理端。

## 0. 完成标准

只有下列证据全部存在，才能把部署标记为成功：

- GitHub `verify` 通过；
- `deploy-student` 所有步骤通过；
- CloudFront `/health` 和 UI 可访问；
- `/s/demo-tenant/demo-location` 返回 reviewer entry redirect；
- 直接访问两个 Lambda Function URL 都返回 `403`；
- release artifact 中存在 checksums、Terraform outputs 和五个数字化 Lambda alias version；
- 浏览器完成一次选 Fact → Generate → guarded Draft → Copy 的合成旅程。

## 1. 先完成安全止损

之前粘贴到对话中的 AWS root access key 已经泄露，不能继续使用。

1. 使用 root 用户登录 AWS Console，进入账户菜单 → **Security credentials** → **Access keys**。
2. Deactivate 后永久 Delete 该 key；不要只是轮换后保留旧 key。
3. 为 root 开启 MFA。
4. 在 CloudTrail Event history 检查从泄露时间开始的未知操作；发现异常则停止部署。
5. 后续管理操作使用 IAM Identity Center 管理员，GitHub 部署使用 OIDC 临时凭据。

AWS 官方步骤：[删除 root access key](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user_manage_delete-key.html)；
[root 用户安全实践](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)。

验收：root 的 Access keys 区域中不存在 Active key，并且 MFA 为 Active。

## 2. 运行配置向导

先安装并登录 GitHub CLI，然后从仓库根目录执行：

```bash
gh auth login
./scripts/setup-student-deployment.sh
```

向导依次完成：

1. 核对 GitHub 仓库和本机命令；
2. 强制确认 root key 已删除；
3. 指导创建 GitHub OIDC provider/role，并写入两个 GitHub variables；
4. 创建/迁移 Neon 数据库；
5. 创建并验证相互隔离的 Context/Generation pooled connections；
6. 生成 Ed25519 keypairs 与 CSRF secret，直接写入 GitHub Secrets 后删除本地临时文件；
7. 核对配置并打开部署 workflow。

向导不会把 cloud secret 写入 `.env`，也不会自动触发部署。

## 3. AWS OIDC 的准确配置

在 IAM → Identity providers 添加：

```text
Provider URL: https://token.actions.githubusercontent.com
Audience:     sts.amazonaws.com
```

创建角色 `review-github-deploy-student`，只用于这个独立的学生 AWS 账户。角色需要
`PowerUserAccess`，再加向导展示的、仅允许管理/传递 `review-*-student-role` 的 IAM inline policy。
`PowerUserAccess` 仍然较宽；这是隔离 assessment 账户的务实 bootstrap 权限，不应复用到包含其他工作负载的
账户。

这个仓库创建于 2026-08-16，因此必须使用 GitHub 新版 immutable OIDC subject：

```text
repo:asqatqazet@79821148/AI-Assisted-Review-Generation@1336406804:ref:refs/heads/main
```

Trust policy 必须同时以 `StringEquals` 检查：

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
token.actions.githubusercontent.com:sub = 上面的 immutable subject
```

不要使用 `repo:asqatqazet/*` 或任意分支 wildcard。GitHub 官方解释了
[AWS OIDC 和 immutable subject 格式](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)，
AWS 官方也要求用 `sub` 限定具体仓库/分支：
[创建 GitHub OIDC role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)。

向导写入：

```text
Variable AWS_DEPLOY_ROLE_ARN
Variable COST_ALERT_EMAIL
```

## 4. Neon 数据库

在 Neon 创建 Frankfurt Free project。迁移使用 **direct** owner URL；Context 和 Generation 使用各自角色的
**pooled** URL。不要交换三条 URL。

```text
NEON_MIGRATION_DATABASE_URL   direct owner URL，仅部署 workflow 使用
NEON_CONTEXT_DATABASE_URL     context_svc pooled URL
NEON_GENERATION_DATABASE_URL  generation_svc pooled URL
```

向导会在你确认后执行 Prisma migrations；迁移创建 `context_svc` 和 `generation_svc`，向导再为它们设置独立
随机密码并验证连接。应用使用 `BEGIN` + `SET LOCAL app.tenant_id` + transaction，因此与 transaction pooling
的边界一致。Neon 官方说明了
[pooled URL 的 `-pooler` 形式和 SET 的 transaction 限制](https://neon.com/docs/connect/connection-pooling)。

验收：向导中的两次 `SELECT 1` 均成功；GitHub 中存在三条不同名称的 database secrets。

## 5. GitHub 配置清单

在 repository Settings → Secrets and variables → Actions 中应看到：

```text
Variables (2)
AWS_DEPLOY_ROLE_ARN
COST_ALERT_EMAIL

Secrets (8)
NEON_MIGRATION_DATABASE_URL
NEON_CONTEXT_DATABASE_URL
NEON_GENERATION_DATABASE_URL
REVIEW_CSRF_SECRET
CONTEXT_WORK_PRIVATE_KEY_PEM
CONTEXT_WORK_PUBLIC_KEY_PEM
GENERATION_WORK_PRIVATE_KEY_PEM
GENERATION_WORK_PUBLIC_KEY_PEM
```

也可以检查名称：

```bash
gh variable list
gh secret list
```

GitHub 不会重新显示 secret value，这是正常行为。官方命令说明：
[GitHub Actions Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

## 6. 首次部署

先确认最新 `main` 的 verify workflow 已通过：

```bash
git switch main
git pull --ff-only
gh run list --workflow verify.yml --branch main --limit 3
```

然后打开 [deploy-student workflow](https://github.com/asqatqazet/AI-Assisted-Review-Generation/actions/workflows/deploy-student.yml)：

1. 选择 **Run workflow**，branch 必须是 `main`；
2. `teardown_date` 填 AWS Free plan 到期日前的日期；
3. `deployment_profile` 保持默认的 `student-low-quota`；
4. 勾选 `acknowledge_fake_provider_only`；
5. 开始运行。

workflow 会主动拒绝以下情况：不是 OIDC assumed role、不是 Active Free plan、credits 已耗尽、日期不安全、
Region 不是 `eu-central-1`，或所选 capacity profile 与实际 Lambda quota 不匹配。`student-low-quota`
要求 account/unreserved concurrency 均至少为 10，并且 Terraform 不设置 function reservations；它只允许受控的
synthetic/FakeProvider assessment。`reserved-concurrency` 仍要求在保留 100 unreserved 的同时分配本项目所需的
13 concurrency。AWS 对 reserved concurrency 的 100 unreserved 约束见
[Lambda API 文档](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html)。

命令行观察运行：

```bash
gh run list --workflow deploy-student.yml --branch main --limit 1
gh run watch <RUN_ID> --exit-status
```

任何步骤失败都不要手工跳过。修正根因后重新 dispatch；seed、Terraform 和 alias promotion 都设计为可重跑。

## 7. 部署后验收

下载同一次成功运行的 release evidence：

```bash
EVIDENCE_DIR="$(mktemp -d)"
gh run download <RUN_ID> --name student-release --dir "$EVIDENCE_DIR"
shasum -a 256 -c "$EVIDENCE_DIR/checksums.sha256"
DOMAIN="$(jq -r '.cloudfront_domain_name.value' "$EVIDENCE_DIR/deployment-outputs.json")"
curl --fail-with-body "https://$DOMAIN/health"
curl -I "https://$DOMAIN/s/demo-tenant/demo-location"
open "https://$DOMAIN/s/demo-tenant/demo-location"
```

在浏览器完成合成旅程并确认：

- 页面明确显示 synthetic/FakeProvider 语义；
- stream 中只有进度，terminal Draft 在 grounding guard 后一次出现；
- Draft 只使用已确认的 Assertion；
- Copy 成功；失败时仍停留在结果页面。

当前 workflow 的云端 provider delay 是 `0`。60 秒流式路径已经在真实 PostgreSQL 的 CI acceptance 中通过，
但尚无自动化云端 60 秒 run。不要把本次首发记录成“cloud 60-second accepted”；该证据仍是后续 gate。

## 8. 回滚演练

选择一个已成功的 `deploy-student` run ID，打开
[rollback-student workflow](https://github.com/asqatqazet/AI-Assisted-Review-Generation/actions/workflows/rollback-student.yml)：

1. Run workflow on `main`；
2. 填入 `release_run_id`；
3. 运行并等待全部步骤通过。

回滚会校验 archive checksums，只移动五个 qualified `live` aliases，恢复匹配的 UI，然后重新 probe。它不会回滚
数据库 migration，因此每个 migration 至少要向后兼容一个 release。

## 9. 销毁与费用边界

- AWS Budget 是告警，不是 hard cap；收到告警立即停止公开入口。
- 首次上线只开放受控演示窗口，不输入真实 reviewer/customer 数据。
- 在 `teardown_date` 前销毁 Terraform stack、删除 SSM parameters、清空远端 state bucket，并删除 Neon project。
- 当前仓库还没有自动 destroy workflow；销毁必须作为人工变更执行并保留证据。在该 workflow 落地前，不要无人值守
  地保持部署到 Free plan 到期日。
- OpenAI 没有可靠的持续免费 API entitlement；EEA public client 的 Gemini 也不能作为严格零预算路径。两者继续禁用。

## 10. 仍然不是生产就绪

首次 assessment 部署成功后，以下工作仍未完成：跨 Lambda 的 PostgreSQL admission rate limit、Cognito operator
登录/Access Grant、自动化云端 60 秒测试、自动 destroy、WAF/abuse 决策，以及受预算保护的 OpenAI/Gemini live
evidence。不要把这套 topology 宣称为 customer production topology。
