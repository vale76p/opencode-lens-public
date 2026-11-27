// The MCP's error classes, in one module only: `instanceof` holds whichever module throws or checks them.

/** A failure to show to the model as it is (isError), unlike a bug. */
export class ToolError extends Error {}

/** The lens did not answer as expected: shown to the model, with what to check. */
export class LensError extends ToolError {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** prompts/get asked for a name no prompt source has: the client's mistake (-32602). Modules throw it from the kit. */
export class PromptNotFoundError extends ToolError {}
