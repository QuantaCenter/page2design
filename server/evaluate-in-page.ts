import type { Page } from 'playwright';

/**
 * tsx preserves function names with esbuild's __name helper. A function sent to
 * another JS realm loses that module helper. Supply it inside the evaluation's
 * closure (never on the target page's global object).
 */
export function evaluateInPage<Result, Argument>(
  page: Page,
  fn: (argument: Argument) => Result,
  argument: Argument,
): Promise<Awaited<Result>> {
  const serializedArgument = JSON.stringify(argument) ?? 'undefined';
  return page.evaluate<Awaited<Result>>(
    `(() => { const __name = (value) => value; return (${fn.toString()})(${serializedArgument}); })()`,
  );
}

/** The application supplies its already opened Document to the DOM processor. */
export function evaluateWithDocument<Result, Argument extends object>(
  page: Page,
  fn: (argument: Argument & { document: Document }) => Result,
  argument: Argument,
): Promise<Awaited<Result>> {
  return page.evaluate<Awaited<Result>>(
    `(() => { const __name = (value) => value; return (${fn.toString()})({ ...${JSON.stringify(argument)}, document: window.document }); })()`,
  );
}
