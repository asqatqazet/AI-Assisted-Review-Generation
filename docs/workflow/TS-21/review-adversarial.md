# TS-21 adversarial review

1. **Elimination of Static Credentials:**
   Authenticating via AWS OIDC eliminates static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` tokens from CI secrets, preventing leak risks.

2. **Least Privilege IAM Boundaries:**
   Context Service and Generation Service execute under separate IAM roles with strictly scoped policies (e.g. Generation Service only accesses its specific SSM parameter keys and CloudWatch logs).

3. **Sub-Minute Rollback MTTR:**
   Shifting the Lambda `live` alias takes under 5 seconds without triggering cold image rebuilds or redeployment delays.
