import { serve } from "./serve.mjs";

serve((request) => ({
  id: request.id,
  error: {
    code: "protocol-mismatch",
    message: `The client speaks engine protocol version ${request.params.protocolVersion} but this engine speaks version 99.`,
  },
}));
