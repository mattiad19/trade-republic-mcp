export class SafeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SafeError';
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof SafeError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'Die Anfrage konnte nicht verarbeitet werden.' };
}
