# Zero-budget hosting: current service facts

Status: research note, checked 2026-08-16. Prices are USD before tax. This note uses only
first-party service documentation and separates an ongoing allowance from a promotional credit.

## Conclusion

A student can run the assessment on AWS for **$0 for at most six months**, provided the account is
new and the **Free account plan** is selected. That plan provides $100 on sign-up, up to another
$100 for completing console activities, never produces an AWS bill before an explicit upgrade, and
ends at the earlier of six months or credit exhaustion. AWS nevertheless requires a payment method.
Access is then suspended; upgrading is required to regain access, and AWS permanently closes the
account and deletes its content if it is not upgraded within the 90-day recovery window. Credits
themselves expire 12 months after account creation. Student status does not extend these rules.
[AWS Free Tier announcement](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/),
[FAQ](https://aws.amazon.com/free/free-tier-faqs/),
[terms](https://aws.amazon.com/free/terms/).

This is therefore a time-boxed assessment deployment, not an indefinitely free production account.
After six months the account must move to the Paid plan to keep running even services with an
"Always Free" monthly allowance. On a Paid plan, AWS Budgets is an alert/action mechanism rather
than a hard spend cap: AWS warns that billing data can be delayed and costs can continue increasing
after a threshold is crossed. [AWS Free Tier offer types](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html),
[AWS Budgets delay](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

There is a second hard constraint: a **live, public, dual-provider deployment in Germany cannot be
promised for $0**.

- OpenAI does not document a universal API free tier or a student allocation. Plan it as paid-only:
  new API accounts use prepaid billing, the minimum purchase is $5, purchased credit expires after
  one year, and auto-recharge must be left disabled for a capped assessment budget. An account may
  happen to have promotional/free credit, but the official wording does not promise it. OpenAI also warns that
  cutoff can lag and briefly create a negative balance. [OpenAI prepaid billing](https://help.openai.com/en/articles/8264778-what-is-prepaid-billing),
  [setup and delayed cutoff](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing).
- Gemini Developer API has a real unpaid tier for selected models, with free input and output tokens.
  However, when an API Client is made available to users in the EEA, Switzerland, or UK, Google's
  current terms require the Client to use **Paid Services**. This rules out an unpaid public Berlin
  demo, although the unpaid API remains useful for local development. Gemini Paid requires an active
  billing account. Accounts assigned to Prepay must currently add at least $10, while Google may instead
  assign Postpay, which creates uncapped billing exposure; this project therefore requires an owner-approved
  $10 Gemini reserve in either case. Google Cloud welcome/free-trial credit cannot fund Gemini API usage.
  [Gemini terms](https://ai.google.dev/gemini-api/terms),
  [billing](https://ai.google.dev/gemini-api/docs/billing).

The honest $0 deployment therefore runs `FakeProvider` in AWS and keeps the OpenAI and Gemini
adapters integration-tested but disabled. A real public provider requires a grant/credit or a small
explicit budget; it must never silently fall back from an exhausted free provider to a paid one.

## AWS service-by-service decision

| Component | What is actually free | Zero-budget decision |
|---|---|---|
| AWS Free account plan | Limited-time credit-backed, no-charge account: at most 6 months; only new AWS customers qualify. | Use for the submission window. Record account-expiry and teardown dates on day one. |
| Lambda on-demand | **Always Free** allowance on Free and Paid plans: 1,000,000 requests and 400,000 GB-seconds per month, aggregated across functions. Response streaming also has a 100 GiB monthly allowance beyond the first free 6 MB per response. [Lambda free offer](https://aws.amazon.com/free/compute/), [pricing](https://aws.amazon.com/lambda/pricing/) | Keep all three deployables as on-demand Lambdas. No provisioned concurrency. |
| Lambda Function URL | No separate endpoint charge; `RESPONSE_STREAM` supports native streaming. A URL with auth type `NONE` is public to anyone who knows it. [Function URL comparison](https://docs.aws.amazon.com/lambda/latest/dg/furls-http-invoke-decision.html), [streaming](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html), [public access](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html) | Give only Web+BFF a URL, set it to `AWS_IAM`, and authorize CloudFront through [OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html). Context and Generation have no URL and are IAM-invoked only. Browser `POST` requests must supply the payload hash required by Lambda-URL OAC. |
| API Gateway REST | 1M REST calls/month for only the first 12 months for new customers; ordinary pricing follows. [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) | Remove. It duplicates the Function URL and creates a future billing edge. |
| CloudFront pay-as-you-go | All customers receive an ongoing monthly allowance of 1 TB data transfer, 10M HTTP(S) requests and 2M CloudFront Function invocations; overage is still usage-priced. [CloudFront FAQ](https://aws.amazon.com/cloudfront/faqs/) | Keep one distribution during the charge-proof six-month Free account plan. Cache the React assets and restrict its Web+BFF Function URL origin with OAC. Do not assume this is a spend cap after upgrading the AWS account. |
| Standalone WAF | Ordinary WAF has a paid base: $5/Web ACL/month, $1/rule/month, plus requests. [WAF pricing](https://aws.amazon.com/waf/pricing/) | Remove from the six-month Free account plan. Application admission and database-backed limits remain mandatory. |
| CloudFront flat-rate Free plan | A distinct ongoing $0/month plan includes 1M requests, 100 GB transfer, WAF/DDoS protection, Route 53 DNS, TLS, CloudWatch log ingestion, and 5 GB S3 credit, with no overages. **AWS Free account plan users are explicitly ineligible.** [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/), [flat-rate plan guide](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/pricingplanmanager-ug.pdf) | Optional only after upgrading the AWS account to Paid. It does not make the rest of a Paid AWS account hard-capped. |
| S3 static origin | S3 is usage-priced and the new Free account applies credit; it has no permanent unconditional storage allowance. [S3 pricing](https://aws.amazon.com/s3/pricing/) | Keep one tiny private bucket behind CloudFront OAC for the Vite build during the charge-proof six-month plan; disable access logs/versioning. If the account is upgraded, use the CloudFront flat-rate plan's 5 GB S3 credit or reassess before continuing. |
| Route 53/custom domain | A Route 53 hosted zone alone is $0.50/month and domain registration is separate. [Route 53 pricing](https://aws.amazon.com/route53/pricing/) | Remove. Use the AWS-issued `cloudfront.net` hostname; no custom domain is required for an assessment. |
| Cognito User Pool | **Ongoing** allowance for Lite or Essentials: 10,000 direct/social MAU per month. Plus, advanced security, SMS/email, machine-to-machine tokens, and excess MAU can add charges. [Cognito pricing](https://aws.amazon.com/cognito/pricing/) | Keep Lite for the few Operator accounts; administrator-created accounts only, no SMS, SES, Plus, or advanced security. |
| Secrets Manager | Credit-backed/paid: $0.40 per secret-month plus API calls; no ongoing zero-cost secret allowance is stated. [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) | Remove. Use Standard SSM `SecureString` parameters for this non-production assessment. |
| SSM Parameter Store | Standard parameters and standard-throughput API interactions have no additional charge. `SecureString` can use the default AWS-managed `aws/ssm` KMS key. [Systems Manager pricing](https://aws.amazon.com/systems-manager/pricing/), [SecureString encryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html) | Keep. Load provider/DB/session keys once per cold start; least-privilege IAM must restrict paths. No rotation claim. |
| Asymmetric customer-managed KMS keys | Each created key is $1/month. The 20,000-request free tier excludes asymmetric `Sign`, `Verify`, `Encrypt`, `Decrypt`, and `GetPublicKey`. [KMS pricing](https://aws.amazon.com/kms/pricing/) | Remove both custom KMS signing keys. Generate two separate application Ed25519 keypairs offline; store private keys as separate `SecureString` parameters and distribute only the matching public keys. |
| EventBridge Scheduler | **Ongoing** allowance of 14M invocations/month. [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/) | Keep one low-frequency reconciliation schedule targeting an internal reconciliation handler. Do not publish custom bus events. |
| CloudWatch | Ongoing monthly allowance includes 5 GB logs, 10 custom/detailed metrics, 10 standard alarm metrics and three small dashboards. [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) | Keep structured redacted logs, 3-day retention, at most 10 custom metrics and a few alarms. No tracing/Application Signals. |
| AWS Budgets / Cost Anomaly Detection | Budget monitoring and notifications are free; the first two action-enabled budgets are free. Cost Anomaly Detection has no added service charge, but its source billing data can lag by up to 24 hours. [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [anomaly detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html) | Enable Free Tier usage alerts plus low-dollar cost alerts and anomaly email. Treat them only as delayed detection, never as a hard spending cap. |
| Neon PostgreSQL | **Ongoing $0**, no card or time limit: 100 CU-hours and 0.5 GB storage per project, up to 2 CU, scale-to-zero after five idle minutes, with pooled connections. [Neon pricing](https://neon.com/pricing), [pooling](https://neon.com/docs/connect/connection-pooling) | Keep one Frankfurt project and the pooled TLS URL. Enforce RLS. Free Neon lacks IP allowlisting, private networking, protected branches, an SLA and long restore history, so store no sensitive production data. [Neon security feature tiers](https://neon.com/docs/security/security-overview) |
| Aurora/RDS Proxy/NAT | Aurora/RDS are available to the new Free plan only through the six-month credits/limits. NAT Gateway is charged per provisioned hour and GB. [Aurora/RDS Free Tier](https://aws.amazon.com/rds/free/), [NAT pricing](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html) | Remove. Neon avoids a VPC, RDS Proxy and paid NAT egress to OpenAI/Gemini. Aurora is a valid short-lived all-AWS exercise, not the zero-budget default. |
| ECS Fargate | Charged for vCPU, memory and storage for the lifetime of each running task; no always-free task allowance is stated. [Fargate pricing](https://aws.amazon.com/fargate/pricing/) | Remove. The workload is sparse and Lambda already has an ongoing free allowance. |

AWS Educate is free training with card-free hands-on labs; it does not currently promise general
deployment credit. AWS Academy Learner Lab is available only through a participating institution and
educator. Ask the university, but do not make either a dependency of the plan.
[AWS Educate](https://aws.amazon.com/education/awseducate/),
[AWS Academy](https://aws.amazon.com/training/awsacademy/).

## Gemini and OpenAI operating rules

Gemini's free limits vary by model, project, account state, and time. Google measures RPM, input TPM
and RPD, applies limits per project rather than per API key, resets RPD at midnight Pacific time, and
now directs developers to AI Studio for the active values. Published limits are not guaranteed.
Consequently, do not hard-code a claimed free RPM/RPD in architecture documentation; read the
project's current quotas at deployment and configure an application limit lower than all three.
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[pricing](https://ai.google.dev/gemini-api/docs/pricing).

For data use, the general unpaid-service terms allow Google and human reviewers to process prompts and
responses to improve products and warn not to send personal, sensitive, or confidential information.
For an account/use in the EEA, Switzerland or UK, an explicit exception applies the Paid Services
data-use terms even to unpaid quota, under which prompts/responses are not used to improve products.
The separate EEA public-Client paid-only rule still applies. [Gemini terms](https://ai.google.dev/gemini-api/terms).

OpenAI's published token prices are usage prices rather than a free allowance. For example, its
current model pages list `gpt-5-mini` at $0.25/1M input tokens and $2/1M output tokens, and
`gpt-5-nano` at $0.05/1M input and $0.40/1M output. Model choice must remain resolved configuration;
quality evaluation, not price alone, decides whether nano is acceptable for review writing.
[GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini),
[GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano).

If a $5 OpenAI exception is approved, turn off auto-recharge, set the smallest project budget, cap
output tokens, pre-authorize every Provider Attempt in the Context database, and stop before the local
ledger reaches $4.50. This bounds ordinary use but is not advertised as an exact provider billing cap
because OpenAI documents delayed cutoff.

## Revised $0 deployment slice

```text
Browser
  -> CloudFront pay-as-you-go (no standalone WAF during the Free account plan)
       -> private S3 OAC (React/Vite hashed assets and shell)
       -> OAC-signed fast Web+BFF Lambda Function URL (AWS_IAM)
       -> OAC-signed stream Web+BFF Lambda Function URL (AWS_IAM, RESPONSE_STREAM)
       -> IAM Invoke Context Lambda -> Neon Free PostgreSQL (Frankfurt, pooled TLS, RLS)
       -> IAM Invoke Generation Lambda -> FakeProvider in deployed $0 mode
                                         -> Gemini only in local unpaid development
                                         -> OpenAI only when explicit paid credit exists

Cognito Lite -> Operator authentication
SSM Standard SecureString -> DB/API/session/signing material
EventBridge Scheduler -> internal reconciliation handler
CloudWatch -> redacted logs, free-tier metrics and alarms
```

The React build is served from private S3 through CloudFront. The fast, stream and internal reconciliation
handlers are one Web+BFF deployable; Context and Generation remain independent deployables and keep the
existing package boundaries. Generation still receives a complete resolved configuration snapshot as a
parameter and has no configuration-read path.

Without edge WAF, protection moves inward and must fail closed:

1. Require a valid opaque invitation before creating a Review Session or invoking Generation.
2. Enforce atomic Review Session, Tenant and Provider-attempt limits in Context/PostgreSQL; in-memory
   counters are only an optimization.
3. Set reserved concurrency (initially fast Web+BFF 5, stream Web+BFF 2, Context 5, Generation 1), while
   leaving provisioned concurrency at zero. Preflight must prove the regional account has all 13 units
   allocatable while leaving AWS's required 100 unreserved; otherwise stop and request a quota increase.
   Reserved concurrency is an upper bound, not a monthly spend cap.
4. Allow one Provider Attempt per Generation, cap response tokens, use a bounded provider timeout,
   and do not retry/fallback automatically after an ambiguous provider result.
5. In unpaid Gemini mode, leave billing unlinked. A quota `429` produces a retry-later result, never
   an OpenAI fallback. In $0 AWS mode, any live-provider flag must default to off.
6. Alarm on Lambda `Throttles`, `ConcurrentExecutions`, monthly GB-seconds, provider attempts, Neon CU
   hours/storage, and the AWS Free-plan/credit expiry dates. Delete the stack immediately after marking.

## Decision boundary

The zero-budget plan is defensible only as an assessment PoC with synthetic/non-sensitive data and a
deterministic deployed provider. If the assignment requires a publicly accessible real LLM in the EEA,
or specifically requires both OpenAI and Gemini to execute live, the missing budget/credit is a hard
external blocker rather than an architecture problem. The smallest honest resolutions are an
institution-provided sandbox/credit, a $5 OpenAI exception, or Gemini paid-billing approval with a $10
project reserve. Enabling both live providers therefore means **$5 OpenAI prepay plus Gemini paid billing;
project policy reserves $15 in total**, rather than claiming a universal $15 provider minimum.
