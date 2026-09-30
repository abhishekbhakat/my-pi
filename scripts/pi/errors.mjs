export function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

export class SetupAbort extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SetupAbort";
    this.exitCode = exitCode;
  }
}
