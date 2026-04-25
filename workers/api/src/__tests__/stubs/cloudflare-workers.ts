/**
 * Node/vitest stub for the `cloudflare:workers` virtual module.
 *
 * The real module is provided by the workerd runtime and cannot be imported
 * under plain Node. For unit tests we only need a `DurableObject` base class
 * that stores `ctx` and `env` so subclasses can call `this.ctx.storage.*`
 * and `this.env.*` against test fakes.
 */

export class DurableObject<Env = unknown> {
  ctx: DurableObjectState;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown> {
  env: Env;
  ctx: ExecutionContext;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
