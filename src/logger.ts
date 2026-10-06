export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, event: string, metadata: Record<string, string | number | boolean> = {}): void {
  const entry = { time: new Date().toISOString(), level, event, ...metadata };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export async function audited<T>(tool: string, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await action();
    log('info', 'tool.completed', { tool, durationMs: Math.round(performance.now() - started), outcome: 'ok' });
    return result;
  } catch (error) {
    log('error', 'tool.completed', {
      tool,
      durationMs: Math.round(performance.now() - started),
      outcome: error instanceof Error ? error.name : 'error',
    });
    throw error;
  }
}
