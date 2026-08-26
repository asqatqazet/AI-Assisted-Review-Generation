# 学生版部署执行手册

这份手册用于部署严格零预算的 assessment walking skeleton：合成租户、`FakeProvider`、CloudFront
默认域名、按需 Lambda 和 Neon Free。它不会部署 OpenAI/Gemini、真实客户数据或生产管理端。
逻辑上仍只有 `web-bff`、`context-service`、`generation-service` 三个 deployable；AWS 将 Context 的同一
artifact 运行成 Reviewer Context 与 Console Context 两个物理 Lambda，以隔离 IAM、签名材料和数据库角色。
当前 expand release 还暂存一个不接收新 candidate/正常流量的旧 Context Lambda，专门让迁移前的不可变版本可回滚；
因此过渡期有七个 product/compatibility functions，正常 release 仍只提升下述六个 aliases。加上不带 alias 的
Fake-only Generation canary，Terraform 共管理八个物理 Lambda。旧函数拥有独立 legacy role，新 Reviewer role
无权读取旧数据库参数。

本手册唯一支持的 Terraform target 是 `infra/terraform/student`。`infra/terraform/production` 是过时且不完整的
scaffold，运行时、网络与 secret 假设均不符合当前架构；**不要在该目录执行 `terraform apply`**。

## 0. 完成标准

只有下列证据全部存在，才能把部署标记为成功：

- GitHub `verify` 通过；
- `deploy-student` 所有步骤通过；
- CloudFront `/health` 和 UI 可访问；
- `/auth/login` 跳转到 Cognito，未登录的 `/api/v1/console/session` 返回 `401`；
- 受邀 Operator 可登录 `/console`，且只看到 Context 根据当前 Access Grants 返回的 Tenant/Location；
- `/s/speicher-neun/hafencity` 返回 reviewer entry redirect；
- 直接访问两个 Lambda Function URL 都返回 `403`；
- release artifact 中存在可搬移校验的 checksums、Terraform outputs、六个被提升的数字化 Lambda alias version、
  单独记录的 legacy Context immutable version，
  以及 `evidence/post-deploy-assessment.json`；
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
3. 指导创建 GitHub OIDC provider/role，并把部署 variables/secrets 只写入受保护的 `student` environment；
4. 创建/迁移 Neon 数据库；
5. 创建并验证相互隔离的 Context/Generation pooled connections；
6. 生成三组独立 Ed25519 keypairs、两个独立 HMAC secret 与 CSRF secret，直接写入 GitHub
   `student` environment Secrets 后删除本地临时文件；
7. 核对配置并打开部署 workflow。

向导不会把 cloud secret 写入 `.env`，也不会自动触发部署。

如果首次运行已经完成 Stage 1–3，但 Neon 在
`20260823000019_operator_capability_rls` 留下 `P3009` failed migration，不要重跑完整向导。先更新
`main`，轮换任何曾暴露的 Neon owner 密码，然后运行专用恢复向导：

```bash
git pull --ff-only
./scripts/resume-student-deployment-from-neon.sh
```

恢复向导只执行原 Stage 4–7。它只会把上述唯一已知 migration 标记为 rolled back；如果 Prisma 报告
其他失败 migration，会 fail closed 并保持数据库状态不变。

## 3. AWS OIDC 的准确配置

在 IAM → Identity providers 添加：

```text
Provider URL: https://token.actions.githubusercontent.com
Audience:     sts.amazonaws.com
```

创建角色 `review-github-deploy-student`，只用于这个独立的学生 AWS 账户。角色需要
`PowerUserAccess`，再加向导展示的 inline policy。该 policy 只允许管理/传递四个固定 Lambda role，
并要求创建时附加 `ReviewStudentLambdaBoundary`；不要把 Resource 改回 `review-*-student-role` wildcard。
`PowerUserAccess` 仍然较宽；这是隔离 assessment 账户的务实 bootstrap 权限，不应复用到包含其他工作负载的
账户。

如果 Terraform 在 `iam:CreateRole` 处报告 deploy role 没有 identity-based permission，运行专用修复向导：

```bash
./scripts/repair-student-deploy-role.sh
```

它从 `student` environment variable 读取公开的 role ARN，生成只列出四个固定 role ARN、限制
`iam:PassedToService=lambda.amazonaws.com` 且强制 permissions boundary 的 inline policy，指导人工在
AWS Console 保存，然后在再次确认后用 `student-low-quota` 重跑部署。它不会接收或保存 AWS access key、密码、
MFA code、数据库 URL 或 provider secret。AWS 官方 console 路径是 Permissions → Add permissions →
Create inline policy → JSON。

这个仓库创建于 2026-08-16，因此必须使用 GitHub 新版 immutable OIDC subject：

```text
repo:asqatqazet@79821148/AI-Assisted-Review-Generation@1336406804:environment:student
```

Trust policy 必须同时以 `StringEquals` 检查：

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
token.actions.githubusercontent.com:sub = 上面的 immutable subject
```

所有 AWS workflow job 都绑定 GitHub Environment `student`。在 Settings → Environments 中把它限制为 selected
branch `main`，并把部署 secrets/variables 放进该 environment；向导会删除同名 repo-scoped 副本，且未确认保护规则时
拒绝继续。不要使用
`repo:asqatqazet/*`、分支 subject 或任意 wildcard。GitHub 官方解释了
[AWS OIDC 和 immutable subject 格式](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)，
AWS 官方也要求用 `sub` 限定具体仓库/分支：
[创建 GitHub OIDC role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)。

向导写入：

```text
Variable AWS_DEPLOY_ROLE_ARN
Variable COST_ALERT_EMAIL
```

## 4. Neon 数据库

在 Neon 创建 Frankfurt Free project。迁移使用 **direct** owner URL；reviewer runtime、Operator Console
和 Generation 使用三个互不继承的角色及各自 **pooled** URL。不要交换四条 URL。

```text
NEON_MIGRATION_DATABASE_URL   direct owner URL，仅部署 workflow 使用
NEON_CONTEXT_RUNTIME_DATABASE_URL  context_runtime_svc pooled URL，仅 reviewer/session/admission 使用
NEON_CONSOLE_CONTROL_DATABASE_URL  console_control_svc pooled URL，仅 Operator Console 使用
NEON_GENERATION_DATABASE_URL  generation_svc pooled URL
```

向导会在你确认后执行 Prisma migrations，并创建
`context_runtime_svc`、`console_control_svc` 和 `generation_svc`。当前是数据库 **expand phase**：旧
`context_svc` 暂时保留 `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`，仅让迁移前已发布的不可变 Context
函数在本次发布失败时仍能回滚运行。旧函数与新 Reviewer 是两个物理 Lambda 和两个 IAM role；新
Reviewer/Console Context 无权读取旧 URL。旧角色的 raw-GUC Console
兼容只在 `session_user = context_svc` 时成立，不能被三个新 runtime 角色使用。待新版本越过约定的回滚窗口后，
必须用单独的 contract migration 撤销该桥并改回 `NOLOGIN`，不能与本次 release promotion 合并。

向导再为三个新 runtime 角色设置独立随机密码并验证连接。应用使用 `BEGIN` + `SET LOCAL` + transaction，因此与 transaction pooling 的边界一致。Neon 官方说明了
[pooled URL 的 `-pooler` 形式和 SET 的 transaction 限制](https://neon.com/docs/connect/connection-pooling)。

验收：三个 runtime URL 都通过精确 `current_user`、`LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT` 和
required/forbidden privilege 检查；GitHub `student` environment 中存在四条不同名称的 database secrets。

## 5. GitHub 配置清单

在 repository Settings → Secrets and variables → Actions 中应看到：

```text
Variables (2)
AWS_DEPLOY_ROLE_ARN
COST_ALERT_EMAIL

Required secrets (13)
NEON_MIGRATION_DATABASE_URL
NEON_CONTEXT_RUNTIME_DATABASE_URL
NEON_CONSOLE_CONTROL_DATABASE_URL
NEON_GENERATION_DATABASE_URL
REVIEW_CSRF_SECRET
PUBLIC_SOURCE_RATE_HMAC_SECRET
CONTEXT_WORK_PRIVATE_KEY_PEM
CONTEXT_WORK_PUBLIC_KEY_PEM
CONSOLE_AUTHORITY_PRIVATE_KEY_PEM
CONSOLE_AUTHORITY_PUBLIC_KEY_PEM
CONSOLE_DATABASE_AUTHORITY_SECRET
GENERATION_WORK_PRIVATE_KEY_PEM
GENERATION_WORK_PUBLIC_KEY_PEM
```

三组 Ed25519 pair 的用途不可互换：`CONTEXT_WORK_*` 只允许 Reviewer Context 签发付费工作；
`CONSOLE_AUTHORITY_*` 只允许 Console Context 签发 Generation 读取/FakeProvider Bench 权限；
`GENERATION_WORK_*` 只允许 Generation 签发 lease、执行与结算回执。每个 Lambda 只读取它需要的 private
或 public half，因此 Console/Bench 权限不能伪造付费生成请求。

两个 HMAC 边界也不可互换。`CONSOLE_DATABASE_AUTHORITY_SECRET` 在 migration 后写入 owner-only 数据库
记录，并只把对应 SSM 参数授予 Context Console。每个 Console transaction 使用 30 秒、单次 nonce 的
HMAC binding；直接拿到 `console_control_svc` URL 的调用者即使设置 `app.operator_id`，也不能枚举/重绑
Operator 或冒充 Platform admin。

`PUBLIC_SOURCE_RATE_HMAC_SECRET` 只授予 Reviewer Context。BFF 先把 IPv4 归一到 `/32`、IPv6 归一到
`/64`，Context 再用 UTC day、策略和该 source prefix 派生 bucket。数据库在一个 transaction 内按序锁定并统计
前一、当前与后一 UTC day 的三个 bucket，因此午夜后的 transaction 先提交时，延迟的午夜前 transaction 也不能
多放行。每小时 reconciliation 在 23 小时阈值清理，cutoff 通过 migration-owner-only function 立即 purge；数据库和
日志都不保存原始 IP。`REVIEW_CSRF_SECRET` 是 BFF 的另一项
应用秘密，不得复用上述两个 HMAC authority boundary。
Expand 窗口中的旧两参数函数无法提交前一天 bucket，因此暂时使用更严格的全局 per-policy allowance；它可能提前
返回 429，但换 bucket 不能多放行。rollback 窗口关闭后的 contract migration 才移除该 overload。

也可以检查名称：

```bash
gh variable list --env student
gh secret list --env student
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
4. `operator_email` 填写首位 Console 管理员的真实邮箱；
5. `tenant_operator_email` 填写另一个、与管理员不同的 Tenant-only 验收账号邮箱；
6. `bootstrap_initial_operator` 默认保持 `false`；只有数据库中全局 `Operators = 0` 且历史
   `Platform Grants = 0` 时才设置 `true`；
7. `student-low-quota` 不需要 provider cost 确认；仅选择 `reserved-concurrency` 时设置
   `acknowledge_provider_cost = true`；
8. 开始运行。

首次部署成功后的每次例行部署必须保持 `bootstrap_initial_operator = false`。workflow 在 Operator 写入前读取全局
状态：任意历史 Operator 或 Platform Grant 存在时都会拒绝 bootstrap；因此 disabled/revoked Operator 不能借部署
恢复。Platform 管理员必须仍有预期 ACTIVE Platform/Tenant Grants。Tenant-only 账号独立派生：缺失时才创建；存在时
必须恰好有一个 ACTIVE Tenant Grant 且零 Platform Grants，否则失败并要求走单独的管理员修复流程。

首次 apply 会创建两个 Cognito 用户并分别发送临时密码邮件。两个邮箱各自绑定到不可变的 Cognito issuer/subject；
workflow 分别写入 Platform 管理员权限与 Tenant-only 权限，不共享凭据。不要通过改浏览器
query、cookie 或前端状态来切换权限；每次 Console session 都由 Context 重新读取当前、未撤销且未过期的 Grants。

workflow 会主动拒绝以下情况：不是 OIDC assumed role、不是 Active Free plan、credits 已耗尽、日期不安全、
Region 不是 `eu-central-1`，或所选 capacity profile 与实际 Lambda quota 不匹配。`student-low-quota`
要求 account/unreserved concurrency 均至少为 10，不为任何 released Lambda 设置 function reservation，并且只允许
受控的 synthetic/FakeProvider assessment。切换到该
profile 时，workflow 先把当前 Generation reserved concurrency 设为 `0`，再验证独立的 Fake-only canary 和全部
candidate handlers，最后才提升 aliases 并解除安全闸；失败不会重新开放旧的 paid live。`reserved-concurrency` 仍要求
在保留 100 unreserved 的同时分配 13 个 reserved units：BFF fast/stream 为 5/2、Reviewer/Console Context
为 4/1、Generation 为 1；reconciliation 与 Fake-only canary 保持 unreserved。AWS 对 reserved concurrency 的
100 unreserved 约束见
[Lambda API 文档](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html)。

命令行观察运行：

```bash
gh run list --workflow deploy-student.yml --branch main --limit 1
gh run watch <RUN_ID> --exit-status
```

任何步骤失败都不要手工跳过。修正根因后重新 dispatch；seed、Terraform 和 alias promotion 都设计为可重跑。
Prompt 发布也不能跳步：workflow 先运行不含 Evaluation/Candidate/Deployment/snapshot 的 base-only
`seed-student.sql`，再从 clean `HEAD` 对固定 `evals/golden` 运行 evaluator；Operator authority 建立后，
deployment-only qualifier 才通过生产 Console Draft/publish seam 生成 canonical snapshot。不要用 SQL 手写
evaluation summary、Candidate 或 snapshot，也不要把 local static fixture 用于 AWS。
deterministic report 即使 100% 通过也只证明 composition/grounding；student strict-$0 还要求 migration 33
中明确审核的 Prompt ID 与 content hash。修改 body/hash 会在 evaluator、Candidate、Deployment 和 qualifier
全部 fail closed；换一个 Tenant 也不会绕过该规则，不能靠重跑 mocked suite 获得新批准。migration 33
还会在全局 release lock 内检查已有 Candidate、Deployment、RUNNING Experiment 与 active Location 最新
snapshot；发现未批准引用时不删除历史，而是中止部署并保持 Generation frozen，修复当前指针/状态后再执行。

首次 apply 是一个明确的 bootstrap 例外：Terraform 必须先创建 CloudFront origin 和六个 `live` aliases，workflow
才能对六个 `candidate` aliases 与 staged UI 做组合 smoke。因此第一次创建环境不能证明 candidate-before-live；必须
保持 access-restricted，并把成功的 candidate-before-live promotion 作为后续 rolling release 的门槛。不要把首次
bootstrap 记录成 canary release evidence。

## 7. 部署后验收

下载同一次成功运行的 release evidence：

```bash
EVIDENCE_DIR="$(mktemp -d)"
gh run download <RUN_ID> --name student-release --dir "$EVIDENCE_DIR"
shasum -a 256 -c "$EVIDENCE_DIR/checksums.sha256"
DOMAIN="$(jq -r '.cloudfront_domain_name.value' "$EVIDENCE_DIR/deployment-outputs.json")"
curl --fail-with-body "https://$DOMAIN/health"
curl -I "https://$DOMAIN/s/speicher-neun/hafencity"
open "https://$DOMAIN/console"
open "https://$DOMAIN/s/speicher-neun/hafencity"
```

Operator Portal 的固定入口是 `https://$DOMAIN/console`。点击 **Sign in** 后使用 workflow 的 `operator_email` 和
Cognito 邀请邮件中的临时密码；首次登录按 Cognito 页面要求设置新密码和可选 TOTP。成功后浏览器只持有 BFF
加密签发的 `HttpOnly; Secure; SameSite=Lax` session cookie，OIDC token 不下发给 React。BFF 在 ID token
接近过期时使用加密保存的 refresh token 刷新，并重新校验 issuer、audience、subject 和 email；Logout 会先调用
Cognito revoke，再跳转 Hosted UI logout，而不只是清本地 cookie。若页面显示
“Console access unavailable”，先检查该身份对应的 Access Grant 是否为 `ACTIVE` 且未过期，而不是在前端选择 Tenant。

在浏览器完成合成旅程并确认：

- 页面明确显示 synthetic/FakeProvider 语义；
- reviewer 只看到 **Generate**；Paraphrase 与其余转换 Action 不得由 feature flag、配置或重放路径开启；
- stream 中只有进度，terminal Draft 在 grounding guard 后一次出现；
- Draft 只使用已确认的 Assertion；
- Copy 成功；失败时仍停留在结果页面。

当前 workflow 的云端 provider delay 是 `0`。60 秒流式路径已经在真实 PostgreSQL 的 CI acceptance 中通过，
但尚无自动化云端 60 秒 run。不要把本次首发记录成“cloud 60-second accepted”；该证据仍是后续 gate。

workflow 还会自动运行 `post-deploy-assessment-smoke.sh`：验证 Platform 与 Tenant-only 权限隔离、Tenant 身份对
Platform catalogue 得到 generic not-found、Fake Bench 零成本且不新增 execution rows、完整 reviewer Generate 流程，
并核对线上 release SHA。该脚本只把布尔验收结果写入 artifact；Cognito subject、cookie 和数据库 URL 不写入证据。

## 8. 回滚演练

选择一个已成功的 `deploy-student` run ID，打开
[rollback-student workflow](https://github.com/asqatqazet/AI-Assisted-Review-Generation/actions/workflows/rollback-student.yml)：

1. Run workflow on `main`；
2. 填入 `release_run_id`；
3. 运行并等待全部步骤通过。

回滚先确认 run 来自本仓库 `main` 上成功的 `deploy-student`，并把 manifest、source SHA、三份 Lambda zip 和
canonical UI digest 绑定。Bucket/Distribution 从当前可信 Terraform state 解析，不接受 artifact 指定的破坏性目标。
它先部署并 smoke candidate aliases/UI prefix，再保存并切换六个 qualified `live` aliases 和 UI pointer；任何
post-promotion probe 失败都会恢复旧版本。它不会回滚数据库 migration，因此每个 migration 至少要向后兼容一个
release。

## 9. 销毁与费用边界

- AWS Budget 是告警，不是 hard cap；收到告警立即停止公开入口。
- 首次上线只开放受控演示窗口，不输入真实 reviewer/customer 数据。
- `student-cutoff` 每天读取持久化在 SSM 的 `teardown_date`；到期后禁用 CloudFront、reconciliation EventBridge rule，
  并把 Terraform state 中列出的所有 Lambda reserved concurrency 设为 `0`。这只是 fail-safe cutoff，不是 destroy。
- 在 `teardown_date` 前仍应执行经过 review 的 Terraform destroy、清空远端 state bucket，并删除 Neon project；
  cutoff 保留资源状态是为了可审计和可恢复，不能替代销毁。
- OpenAI 没有可靠的持续免费 API entitlement；EEA public client 的 Gemini 也不能作为严格零预算路径。两者继续禁用。

## 10. 仍然不是生产就绪

首次 assessment 部署成功后，以下工作仍未完成：真实云端 60 秒测试证据、自动 destroy、WAF/abuse 决策、
生产负载下的 admission/reconciliation 证据，以及受预算保护的 OpenAI/Gemini live evidence。Console 的
Draft/ETag/Publish、Prompt Evaluation/Candidacy/Deployment、snapshot-first admission、运营读平面、
FakeProvider Bench、当前 Grant 复查与 tenant-only 导航已经落地并有本地 PostgreSQL/浏览器测试。Experiments
与 Paraphrase 的独立语义 validator/release capability 明确 deferred；这仍是 synthetic assessment，而不是面向真实
客户数据的生产后台。
