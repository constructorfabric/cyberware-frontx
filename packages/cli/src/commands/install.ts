// @cpt-flow:cpt-frontx-flow-template-resolution-install:p1
// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
import type { FetchFn } from '../resolver/types';
import { TemplateInventory } from '../inventory/TemplateInventory';
import type { DiscoveryHookResult, ExtensionDiscoveryHook } from '../discovery/types';
import type { ErrorCode } from '../envelope';

export interface InstallCommandResult {
  ok: boolean;
  message: string;
  /**
   * The dictionary code the failure reported, when the underlying inventory
   * failure carried one. Absent on success and on a failure that has no coded
   * origin (a source-spec that will not parse, refused here rather than by a
   * resolver).
   *
   * The whole chain has to carry it or the last link cannot report it: the
   * resolver refuses a legacy manifest with `INVALID_MANIFEST`, and until this
   * field existed the code was dropped three times over — at the inventory
   * boundary, here, and at the dispatcher, which had no `--json` envelope to
   * put it in at all.
   */
  code?: ErrorCode;
  discovery?: DiscoveryHookResult;
}

/**
 * @param discoveryHook Optional cross-package edge (F16 <- F10): when
 * provided, invoked with the installed template's name+ref immediately
 * after a successful install, signaling the AI Tooling Framework that an
 * installed template is present so it can run its extension-discovery scan.
 * Never invoked on a failed install. Omitting the hook preserves the
 * pre-F16 install behavior exactly.
 */
export async function installCommand(
  spec: string,
  inventory: TemplateInventory,
  fetchFn: FetchFn,
  discoveryHook?: ExtensionDiscoveryHook,
): Promise<InstallCommandResult> {
  const result = await inventory.install(spec, fetchFn);
  if (!result.ok) {
    return { ok: false, code: result.error.code, message: result.error.message };
  }

  const message = `Installed ${result.value.name}@${result.value.ref}`;

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template
  if (!discoveryHook) {
    return { ok: true, message };
  }

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  const discovery = await discoveryHook({ name: result.value.name, ref: result.value.ref });
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  return { ok: true, message, discovery };
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template
}
