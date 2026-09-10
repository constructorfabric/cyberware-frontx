import { describe, expect, it } from 'vitest';
import { err, ok } from '../envelope';
import type { Envelope, ErrorCode } from '../envelope';

describe('ok', () => {
  it('produces {ok: true, data}', () => {
    expect(ok({ templates: ['auth'] })).toEqual({ ok: true, data: { templates: ['auth'] } });
  });
});

describe('err', () => {
  it('produces the failure shape with details omitted when not given', () => {
    const result = err('TEMPLATE_NOT_REGISTERED', 'no entry named "auth"');

    expect(result).toEqual({
      ok: false,
      error: { code: 'TEMPLATE_NOT_REGISTERED', message: 'no entry named "auth"' },
    });
    expect('details' in result.error).toBe(false);
  });

  it('produces the failure shape with details included when given', () => {
    const result = err('TARGET_CONFLICT', 'path already claimed', { path: 'apps/web', contestingTarget: 'auth' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TARGET_CONFLICT',
        message: 'path already claimed',
        details: { path: 'apps/web', contestingTarget: 'auth' },
      },
    });
  });

  it('every one of the sixteen ADR-fixed codes constructs a valid envelope', () => {
    const codes: ErrorCode[] = [
      'INVALID_MANIFEST',
      'VERSION_MISMATCH',
      'TEMPLATE_NOT_REGISTERED',
      'TARGET_CONFLICT',
      'CONTENT_CONFLICT',
      'EXISTING_PATHS_REQUIRE_DECISION',
      'CONFIRMATION_REQUIRED',
      'ORIGIN_UNAVAILABLE',
      'PROJECT_INVALID',
      'REGISTRATION_CONFLICT',
      'TARGETS_EXIST',
      'TARGET_NOT_APPLIED',
      'INVALID_PATH',
      'NOTHING_TO_RESTORE',
      'INVALID_INPUT',
      'INTERNAL',
    ];

    for (const code of codes) {
      expect(err(code, 'message')).toEqual({ ok: false, error: { code, message: 'message' } });
    }
  });
});

// Compile-time-only check that `ErrorCode` is a closed literal union: if
// 'NOT_A_REAL_CODE' were assignable to it, `IsNotAssignable` below would
// resolve to `never` and the following assignment would fail to compile.
// Written this way rather than with `// @ts-expect-error` because this
// repository's eslint config (`@typescript-eslint/ban-ts-comment`) disallows
// that directive outside a couple of already-`TODO`-tracked exceptions
// unrelated to this package.
type IsNotAssignable<T, U> = T extends U ? never : true;
const errorCodeIsClosed: IsNotAssignable<'NOT_A_REAL_CODE', ErrorCode> = true;

describe('ErrorCode', () => {
  it('is a closed literal union — a code outside the fixed vocabulary is a compile-time error', () => {
    expect(errorCodeIsClosed).toBe(true);
  });

  it('ok/false is a two-way discriminant a caller can narrow on', () => {
    const envelope: Envelope<{ n: number }> = ok({ n: 1 });
    if (envelope.ok) {
      expect(envelope.data.n).toBe(1);
    } else {
      throw new Error('expected the ok branch');
    }
  });
});
