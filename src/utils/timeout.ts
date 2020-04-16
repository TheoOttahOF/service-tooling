/**
 * Wraps the given promise in a timeout. If the timeout is exceeded, a second action will be triggered.
 *
 * Method returns the result of `action` if it completes within the timeout, or the result of `timeoutAction` if the
 * timeout is exceeded.
 *
 * The original action is passed to the timeout handler, so that the overall function can still return the original
 * result if desired.
 *
 * @param action Promise that should be wrapped in a timeout
 * @param timeoutMs How long 'action' is given to resolve
 * @param timeoutAction Callback that is ran if the timeout is exceeded
 */
export async function withTimeout<T>(action: Promise<T>, timeoutMs: number, timeoutAction: (action: Promise<T>) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            timeoutAction(action).then(resolve, reject);
        }, timeoutMs);

        action.then((result) => {
            clearTimeout(timeout);
            resolve(result);
        }, reject);
    });
}
