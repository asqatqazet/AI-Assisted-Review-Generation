# TS-10 adversarial review

1. **Disclosure Storing vs Generation**:
   Disclosure text is generated at policy evaluation time and incorporated into the Draft. It is not stored statically in configuration, ensuring Tenant renames do not cause stale data while completed historical Generations retain their generated artifacts.

2. **Action Exclusion Explanations**:
   The `availableActions` function explicitly identifies whether an action was excluded due to Tenant configuration or Review Format constraints, avoiding silent UI suppression.

3. **Contradictory Configuration Protection**:
   `open-qr` entry mode with `requireVerifiedExperience` is flagged as an invalid state at the domain level, catching administrative errors before runtime execution.
