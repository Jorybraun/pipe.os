/**
 * Node/vitest stub for `@cloudflare/containers`.
 *
 * The real package imports `cloudflare:workers` internally (a workerd virtual
 * module) and therefore cannot load under plain Node. For unit tests we only
 * need a minimal `Container` base class that gives `DevContainerDO` the fields
 * it declares (`defaultPort`, `sleepAfter`) while keeping `DurableObject`'s
 * constructor contract so the existing test-state builder still works.
 */

import { DurableObject } from './cloudflare-workers';

export type InstanceType = 'dev' | 'basic' | 'standard-1' | 'standard-2' | 'standard-3' | 'standard-4';

export type Schedule<T = string> = {
  taskId: string;
  callback: string;
  payload: T;
  type: 'scheduled';
  time: number;
};

/**
 * Test-only spy record for `schedule()` calls. Each DO subclass instance
 * under test owns its own ring via `__schedules`. Tests can read this to
 * assert the DO scheduled the right callback at the right time without
 * exercising the real sqlite-backed scheduler in the Container base class.
 */
export interface ScheduleCall<T = unknown> {
  when: Date | number;
  callback: string;
  payload: T | undefined;
}

export function switchPort(request: Request, port: number): Request {
  const headers = new Headers(request.headers);
  headers.set('cf-container-target-port', String(port));
  return new Request(request, { headers });
}

export class Container<Env = unknown> extends DurableObject<Env> {
  defaultPort?: number;
  requiredPorts?: number[];
  sleepAfter?: string | number;
  instanceType?: InstanceType;

  __schedules: ScheduleCall[] = [];
  __startCalls: unknown[] = [];
  __stopCalls: Array<number | string> = [];
  __destroyCalls = 0;

  // Stub lifecycle hooks — not called in unit tests.
  async onStart(): Promise<void> {}
  async onStop(_: { exitCode: number; reason: string }): Promise<void> {}
  async onError(_: unknown): Promise<void> {}

  async schedule<T = string>(
    when: Date | number,
    callback: string,
    payload?: T,
  ): Promise<Schedule<T>> {
    this.__schedules.push({ when, callback, payload });
    const time =
      when instanceof Date ? when.getTime() : Date.now() + when * 1000;
    return {
      taskId: `stub-${this.__schedules.length}`,
      callback,
      payload: payload as T,
      type: 'scheduled',
      time,
    };
  }

  async stop(signal: number | string = 15): Promise<void> {
    this.__stopCalls.push(signal);
  }

  async startAndWaitForPorts(...args: unknown[]): Promise<void> {
    this.__startCalls.push(args);
  }

  async destroy(): Promise<void> {
    this.__destroyCalls += 1;
  }
}
