# TS-08 adversarial review

1. **Ceiling Placement:**
   Placing the claim ceiling in the system message establishes it as a strict behavioral invariant on model execution rather than a conversational user preference.

2. **Schema-driven Grounding:**
   The output schema requires the provider to return explicit claims mapped to assertion IDs, enabling deterministic post-generation validation by the Grounding Guard.

3. **Data-driven Action Dispatch:**
   Action composition uses common data representations and standard message assembly rather than separate code branches.
