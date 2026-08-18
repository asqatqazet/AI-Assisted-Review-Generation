import type { OperatorAccessProjectionDto } from "@review/contracts/context";

import type { OperatorIdentity } from "./operator-auth.port.js";

export interface OperatorContextPort {
  resolveAccess(identity: OperatorIdentity): Promise<OperatorAccessProjectionDto>;
}
