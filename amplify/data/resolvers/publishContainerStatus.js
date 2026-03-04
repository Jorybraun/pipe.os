/**
 * AppSync NONE-source resolver for the publishContainerStatus mutation.
 *
 * This mutation has no backing data store — it exists purely to trigger
 * the onContainerStatusChanged subscription. The resolver passes the
 * mutation arguments through as the result so that subscribers receive them.
 *
 * @see https://docs.amplify.aws/react/build-a-backend/data/custom-business-logic/
 */

/**
 * @param {import('@aws-appsync/utils').Context} ctx
 * @returns {import('@aws-appsync/utils').NONERequest}
 */
export function request(ctx) {
  return {
    payload: {
      taskArn: ctx.args.taskArn,
      sessionId: ctx.args.sessionId,
      status: ctx.args.status,
      url: ctx.args.url ?? null,
      updatedAt: ctx.util.time.nowISO8601(),
    },
  };
}

/**
 * @param {import('@aws-appsync/utils').Context} ctx
 * @returns {*}
 */
export function response(ctx) {
  return ctx.result;
}
