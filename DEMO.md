# Demo script

## Grounding rejection

1. Start a Review Session with the single Assertion “The service was attentive.”
2. Script the Fake Model Gateway to return two Claim segments: attentive service and an unasserted
   discount.
3. Run Generate.
4. Observe that no candidate or Draft bytes are streamed or returned, the terminal result is rejected,
   and audit records identify the failed Provider Attempt and unsupported proposition.
5. Script a second Provider Attempt containing only the attentive-service Claim.
6. Observe a validated Draft and a complete Claim-to-Assertion link.

Repeat with Expand and an added parking Claim to demonstrate the stricter exact-Claim-set postcondition.

