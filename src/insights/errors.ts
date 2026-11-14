// Playbook errors, ported from valioaimo gateway/playbook/engine.py: the same codes, statuses and body shape.

export type ErrorExtra = Record<string, unknown>;

export class PlaybookError extends Error {
  readonly status: number = 400;
  readonly code: string = 'bad_request';
  readonly extra: ErrorExtra;

  constructor(message: string, extra: ErrorExtra = {}) {
    super(message);
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

/** 409: the tool is not unlocked yet; `next_allowed_tools` says what is. */
export class StepNotAllowed extends PlaybookError {
  override readonly status = 409;
  override readonly code = 'step_not_allowed';
}

/** 422: the input was checked and refused; `fix` names what is valid. */
export class GuardFailed extends PlaybookError {
  override readonly status = 422;
  override readonly code = 'guard_failed';
}

export class NotFound extends PlaybookError {
  override readonly status = 404;
  override readonly code = 'not_found';
}

export function fail({ message, fix }: { message: string; fix: unknown }): never {
  throw new GuardFailed(message, { fix });
}
