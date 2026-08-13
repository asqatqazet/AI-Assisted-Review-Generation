# TS-19 review

## Behavioral evidence

- 22 golden scenarios span both tenants (`tenant-apex`, `tenant-lumina`), all 3 review format styles (`concise-blurb`, `detailed-narrative`, `social-short`), all 7 actions (`generate`, `reformat`, `condense`, `expand`, `revise-wording`, `paraphrase`, `resample`), and adversarial cases.
- Scenarios include adversarial discount invention, unnamed staff member fabrication, unauthorized claim additions during expand, and banned term injection.
- Runner executes deterministically with zero variance, zero cost, and 100% grounding pass rate.
- Results are saved to `evals/results/latest.json` for consumption by TS-18's promotion gate.
