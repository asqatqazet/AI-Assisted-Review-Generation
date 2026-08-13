# TS-18 adversarial review

1. **Domain Promotion Gate:**
   The 100% evaluation pass-rate check is enforced inside the pure domain logic. This prevents external API clients or internal CLI tools from bypassing quality gates.

2. **Strict Weight Summing:**
   Variant weights must sum to exactly 100 rather than being silently normalized. Silent normalization masks operator configuration errors.

3. **Content Addressing:**
   Because prompt versions are content-addressed, old generations are always explicable and reproducible from their recorded prompt version hash.
