// @cpt-flow:cpt-frontx-flow-template-resolution-update-local:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1
import type { FetchFn } from '../resolver/types';
import { TemplateInventory } from '../inventory/TemplateInventory';
import type { ErrorCode } from '../envelope';

export interface UpdateLocalResult {
  ok: boolean;
  message: string;
  /**
   * The dictionary code the inventory failure reported. Absent on success.
   * `update-local` is the last command whose refusals had nowhere to put one:
   * it recognized no `--json` at all, so a caller asking for the
   * machine-readable form got an empty stream and a sentence on stderr.
   */
  code?: ErrorCode;
}

export async function updateLocalCommand(
  name: string,
  spec: string,
  inventory: TemplateInventory,
  fetchFn: FetchFn,
): Promise<UpdateLocalResult> {
  const result = await inventory.updateLocal(name, spec, fetchFn);
  if (!result.ok) {
    return { ok: false, code: result.error.code, message: result.error.message };
  }
  return {
    ok: true,
    message: `Updated ${result.value.name} to ${result.value.ref}`,
  };
}
