# TS-03 adversarial review

Implementing the story literally would have made prototype compatibility terms into the domain model,
allowed null-provenance Claims, treated arbitrary Refine instructions as evidence, and encoded resampling
as a semantic transformation. Those requirements conflict with the accepted domain model.

Decision: preserve fixture fields only in explicit `Prototype*Dto` schemas and record every deviation in
`delta.md`. The canonical contracts enforce the corrected safety and lineage model.

