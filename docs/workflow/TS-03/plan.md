# TS-03 plan

## Outcome

Turn the prototype fixture shapes into validated wire DTOs while keeping the accepted canonical domain
language and safety model intact.

## Public seam

Consumers import only:

- `@review/contracts/shared`
- `@review/contracts/context`
- `@review/contracts/generation`

Every DTO is a strict Zod schema with its inferred type. Compatibility fixtures are explicitly prefixed
`Prototype`; they are not domain values.

