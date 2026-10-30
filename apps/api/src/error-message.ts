/** The message of anything thrown: errors keep their message, other values are stringified. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
