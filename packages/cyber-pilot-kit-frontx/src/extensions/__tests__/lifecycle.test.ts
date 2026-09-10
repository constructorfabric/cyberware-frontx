// @cpt-state:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1
import { describe, it, expect } from 'vitest';
import {
  runExtensionLifecycle,
  transitionBundledToDenied,
  transitionBundledToDiscovered,
  transitionFromDiscovered,
  transitionValidatedToActivated,
} from '../lifecycle.js';
import { AiExtensionLifecycleState } from '../types.js';

describe('AiExtension lifecycle', () => {
  it('BUNDLED -> DENIED when the identity carries no registered origin, reporting the denial', () => {
    const denied = transitionBundledToDenied('untrusted-template');
    expect(denied.state).toBe(AiExtensionLifecycleState.DENIED);
    expect(denied.denial.identity).toBe('untrusted-template');
    expect(denied.denial.reason).toMatch(/no registered, pinned origin/);
  });

  it('BUNDLED -> DISCOVERED when a bundle entry is located', () => {
    const raw = { id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' };
    const discovered = transitionBundledToDiscovered(raw);
    expect(discovered.state).toBe(AiExtensionLifecycleState.DISCOVERED);
  });

  it('DISCOVERED -> VALIDATED when the entry conforms', () => {
    const raw = { id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' };
    const validated = transitionFromDiscovered(raw);
    expect(validated.state).toBe(AiExtensionLifecycleState.VALIDATED);
  });

  it('DISCOVERED -> REJECTED when the entry is malformed', () => {
    const raw = { id: 'broken', category: 'skills' };
    const rejected = transitionFromDiscovered(raw);
    expect(rejected.state).toBe(AiExtensionLifecycleState.REJECTED);
  });

  it('VALIDATED -> ACTIVATED when the composed set is committed', () => {
    const activated = transitionValidatedToActivated({ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' });
    expect(activated.state).toBe(AiExtensionLifecycleState.ACTIVATED);
  });

  it('a valid bundle entry reaches ACTIVATED via the full lifecycle', () => {
    const result = runExtensionLifecycle({ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' });
    expect(result.state).toBe(AiExtensionLifecycleState.ACTIVATED);
    expect(result.entry?.id).toBe('skill-1');
  });

  it('a malformed entry reaches REJECTED and is NOT activated', () => {
    const result = runExtensionLifecycle({ id: 'broken', category: 'skills' });
    expect(result.state).toBe(AiExtensionLifecycleState.REJECTED);
    expect(result.entry).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('an entry naming an out-of-set category reaches REJECTED', () => {
    const result = runExtensionLifecycle({ id: 'oob', category: 'mocks', path: 'mocks/oob.md' });
    expect(result.state).toBe(AiExtensionLifecycleState.REJECTED);
  });
});
