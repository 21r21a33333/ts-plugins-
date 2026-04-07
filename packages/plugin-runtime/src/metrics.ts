/**
 * In-memory runtime metrics used by tests and local instrumentation hooks.
 */

export type MetricOutcome = "success" | "typed_error" | "framework_failure";

export class RuntimeMetrics {
  private readonly requests = new Map<string, number>();
  private readonly queueDepth = new Map<string, number>();
  private readonly restarts = new Map<string, number>();
  private readonly breakerTransitions = new Map<string, number>();
  private readonly latency = new Map<string, number[]>();

  recordRequest(
    pluginId: string,
    methodName: string,
    outcome: MetricOutcome,
    latencyMs: number,
  ): void {
    increment(this.requests, `${pluginId}:${methodName}:${outcome}`);
    const latencyKey = `${pluginId}:${methodName}`;
    const values = this.latency.get(latencyKey) ?? [];
    values.push(latencyMs);
    this.latency.set(latencyKey, values);
  }

  setQueueDepth(pluginId: string, depth: number): void {
    this.queueDepth.set(pluginId, depth);
  }

  recordRestart(pluginId: string): void {
    increment(this.restarts, pluginId);
  }

  recordBreakerTransition(pluginId: string, transition: string): void {
    increment(this.breakerTransitions, `${pluginId}:${transition}`);
  }

  requestCount(pluginId: string, methodName: string, outcome: MetricOutcome): number {
    return this.requests.get(`${pluginId}:${methodName}:${outcome}`) ?? 0;
  }

  currentQueueDepth(pluginId: string): number {
    return this.queueDepth.get(pluginId) ?? 0;
  }

  restartCount(pluginId: string): number {
    return this.restarts.get(pluginId) ?? 0;
  }

  breakerTransitionCount(pluginId: string, transition: string): number {
    return this.breakerTransitions.get(`${pluginId}:${transition}`) ?? 0;
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
