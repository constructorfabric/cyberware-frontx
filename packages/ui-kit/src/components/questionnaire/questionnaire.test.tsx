import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from './questionnaire';
import styles from './questionnaire.module.css';

afterEach(cleanup);

// `aria-hidden="true"` (stamped by the primitive on a hidden nav button —
// see questionnaire.tsx's QuestionnairePrevious/Skip/Next doc comments)
// makes its accessible name resolve to "" per the accname algorithm, even
// when a hidden-state-inclusive `getByRole(..., { hidden: true })` query is
// used — the name computation itself, not the role/visibility filter, is
// what's affected. Locating by the button's own label text sidesteps that:
// text queries aren't tied to the accessibility tree.
function navButton(name: string) {
  const button = screen.getByText(name).closest('button');
  if (!button) {
    throw new Error(`no <button> ancestor for text "${name}"`);
  }
  return button;
}

function activeItem() {
  const fieldset = document.querySelector('fieldset:not([hidden])');
  if (!fieldset) {
    throw new Error('no active item');
  }
  return fieldset;
}

const ITEMS = [
  { name: 'role', choices: [{ value: 'engineer' }, { value: 'designer' }], required: true },
  { name: 'tools', choices: [{ value: 'cli' }, { value: 'editor' }] },
  { name: 'notes' },
];

function renderQuestionnaire(onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void) {
  return render(
    <Questionnaire items={ITEMS} defaultItem="role" onSubmit={onSubmit}>
      <QuestionnaireProgress />
      <QuestionnaireItem name="role" required>
        <QuestionnaireTitle>What's your role?</QuestionnaireTitle>
        <QuestionnaireDescription>Pick one.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="engineer">Engineer</QuestionnaireChoice>
          <QuestionnaireChoice value="designer">Designer</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireItem name="tools" multiple>
        <QuestionnaireTitle>Which tools?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="cli">CLI</QuestionnaireChoice>
          <QuestionnaireChoice value="editor">Editor</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireItem name="notes">
        <QuestionnaireTitle>Anything else?</QuestionnaireTitle>
        <QuestionnaireInput placeholder="Optional notes" />
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>,
  );
}

function answerRole() {
  fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }));
}

describe('Questionnaire', () => {
  it('shows only the current item and keeps the rest hidden and inert', () => {
    renderQuestionnaire();
    expect(screen.getByText("What's your role?").tagName).toBe('LEGEND');
    expect(activeItem()).toBe(screen.getByText("What's your role?").closest('fieldset'));
    const later = screen.getByText('Anything else?').closest('fieldset');
    expect(later).toHaveProperty('hidden', true);
    expect(later?.hasAttribute('inert')).toBe(true);
  });

  /*
   * The regression that made the whole stepper paint at once: `hidden` is
   * enforced only by the UA sheet's non-`!important` `[hidden]` rule, so
   * `.item`'s own `display: flex` (and the `display: inline-flex` the kit
   * Button brings to the nav buttons) silently outranked it and every
   * question stayed visible. The stylesheet source is what has to be
   * asserted: jsdom loads no UA stylesheet and does not apply CSS Modules,
   * so a computed-style assertion would pass against the broken CSS too.
   */
  it('re-blocks display for every hidden part that carries an author display', () => {
    // Read from the package root rather than `import.meta.url`, which Vite
    // rewrites to a non-file URL during transform.
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/questionnaire/questionnaire.module.css'),
      'utf8',
    );
    const guard = css
      // Comments here quote CSS snippets, including this very rule.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{'))
      .find(([selector, body]) => body?.includes('display: none') && selector.includes('[hidden]'));

    expect(guard, 'no `[hidden] { display: none }` guard rule found').toBeTruthy();
    for (const part of ['item', 'previous', 'skip', 'next', 'submit']) {
      expect(guard?.[0]).toContain(`.${part}[hidden]`);
    }
  });

  it('renders radio choices by default and checkbox choices for a multiple item', () => {
    renderQuestionnaire();
    const radio = screen.getByRole('radio', { name: 'Engineer' });
    expect(radio.getAttribute('type')).toBe('radio');
    expect(radio.closest(`.${styles.choice}`)?.getAttribute('data-type')).toBe('radio');

    answerRole();
    fireEvent.click(navButton('Next'));
    const checkbox = screen.getByRole('checkbox', { name: 'CLI' });
    expect(checkbox.getAttribute('type')).toBe('checkbox');
    expect(checkbox.closest(`.${styles.choice}`)?.getAttribute('data-type')).toBe('checkbox');
  });

  it('reflects selection on the choice row so the row itself can restyle', () => {
    renderQuestionnaire();
    const input = screen.getByRole('radio', { name: 'Engineer' });
    const choice = input.closest(`.${styles.choice}`);
    expect(choice?.hasAttribute('data-checked')).toBe(false);
    fireEvent.click(input);
    expect(input).toHaveProperty('checked', true);
    expect(choice?.hasAttribute('data-checked')).toBe(true);
    expect(activeItem().getAttribute('data-status')).toBe('answered');
  });

  it('reports progress as a labelled progressbar', () => {
    renderQuestionnaire();
    const progress = screen.getByRole('progressbar');
    expect(progress.className).toContain(styles.progress);
    expect(progress.textContent).toBe('Question 1 of 3');
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    expect(progress.getAttribute('aria-valuemax')).toBe('3');
  });

  it('hides Previous on the first item and Skip on a required item', () => {
    renderQuestionnaire();
    expect(navButton('Previous')).toHaveProperty('hidden', true);
    expect(navButton('Skip')).toHaveProperty('hidden', true);
    expect(navButton('Next')).toHaveProperty('hidden', false);
    expect(navButton('Submit')).toHaveProperty('hidden', true);
  });

  /*
   * Next never disables itself — activating it is what runs validation and
   * reveals the message, so "blocked" has to be observed as "still on the
   * same item, now invalid", not as a disabled button.
   */
  it('blocks Next on an unanswered required item and explains why', () => {
    renderQuestionnaire();
    const next = navButton('Next');
    expect(next).toHaveProperty('disabled', false);
    fireEvent.click(next);
    expect(activeItem().getAttribute('data-status')).toBe('unanswered');
    expect(screen.getByText("What's your role?").closest('fieldset')).toBe(activeItem());
    const error = screen.getByRole('alert');
    expect(error.className).toContain(styles.error);
    expect(error.textContent).toBe('Choose an answer to continue.');
  });

  /* An untouched optional item fails the same way — Skip, not Next, is its
   * way past, and the default copy says so. */
  it('blocks Next on an untouched optional item and points at Skip', () => {
    renderQuestionnaire();
    answerRole();
    fireEvent.click(navButton('Next'));
    fireEvent.click(navButton('Next'));
    expect(screen.getByText('Which tools?').closest('fieldset')).toBe(activeItem());
    expect(screen.getByRole('alert').textContent).toBe('Choose an answer or skip this question.');
  });

  it('advances once answered and reveals Previous', () => {
    renderQuestionnaire();
    answerRole();
    fireEvent.click(navButton('Next'));
    expect(screen.getByText('Which tools?').closest('fieldset')).toBe(activeItem());
    expect(screen.getByRole('progressbar').textContent).toBe('Question 2 of 3');
    expect(navButton('Previous')).toHaveProperty('hidden', false);
    expect(navButton('Skip')).toHaveProperty('hidden', false);
  });

  it('skips an optional item and drops it from the submitted data', () => {
    // `currentTarget` is cleared once dispatch unwinds, so the entries are
    // read inside the handler rather than off the retained mock call.
    let submitted: FormData | null = null;
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitted = new FormData(event.currentTarget);
    });
    renderQuestionnaire(onSubmit);
    answerRole();
    fireEvent.click(navButton('Next'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CLI' }));
    fireEvent.click(navButton('Skip'));

    expect(screen.getByText('Anything else?').closest('fieldset')).toBe(activeItem());
    fireEvent.change(screen.getByPlaceholderText('Optional notes'), {
      target: { value: 'Looking forward to it' },
    });
    fireEvent.click(navButton('Submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const data = submitted as unknown as FormData;
    expect(data.get('role')).toBe('engineer');
    // Checked before skipping, yet absent: skipping clears the answer.
    expect(data.getAll('tools')).toEqual([]);
    expect(data.get('notes')).toBe('Looking forward to it');
  });

  it('swaps Next for Submit on the last item', () => {
    renderQuestionnaire();
    answerRole();
    fireEvent.click(navButton('Next'));
    fireEvent.click(navButton('Skip'));
    expect(navButton('Next')).toHaveProperty('hidden', true);
    expect(navButton('Submit')).toHaveProperty('hidden', false);
    expect(navButton('Skip')).toHaveProperty('hidden', false);
  });

  it('composes the kit Input for the freeform item via the render prop', () => {
    renderQuestionnaire();
    answerRole();
    fireEvent.click(navButton('Next'));
    fireEvent.click(navButton('Skip'));
    const input = screen.getByPlaceholderText('Optional notes') as HTMLInputElement;
    expect(input.className).toContain('input');
    fireEvent.change(input, { target: { value: 'Great kit' } });
    expect(input.value).toBe('Great kit');
    expect(activeItem().getAttribute('data-status')).toBe('answered');
  });

  it('stacks a choice description under its label inside the choice', () => {
    render(
      <Questionnaire items={[{ name: 'plan', choices: [{ value: 'pro' }] }]} defaultItem="plan">
        <QuestionnaireItem name="plan">
          <QuestionnaireChoices>
            <QuestionnaireChoice value="pro">
              Pro
              <QuestionnaireChoiceDescription>Everything included.</QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
          </QuestionnaireChoices>
        </QuestionnaireItem>
      </Questionnaire>,
    );
    const description = screen.getByText('Everything included.');
    expect(description.className).toContain(styles.choiceDescription);
    expect(description.closest(`.${styles.choiceLabel}`)).toBeTruthy();
  });

  it('assigns a letter shortcut per enabled choice and skips disabled ones', () => {
    render(
      <Questionnaire
        items={[
          {
            name: 'plan',
            choices: [{ value: 'free' }, { value: 'pro' }, { value: 'ent', disabled: true }],
          },
        ]}
        defaultItem="plan"
        shortcuts="letters"
      >
        <QuestionnaireItem name="plan">
          <QuestionnaireChoices>
            <QuestionnaireChoice value="free">Free</QuestionnaireChoice>
            <QuestionnaireChoice value="pro">Pro</QuestionnaireChoice>
            <QuestionnaireChoice value="ent" disabled>
              Enterprise
            </QuestionnaireChoice>
          </QuestionnaireChoices>
        </QuestionnaireItem>
      </Questionnaire>,
    );
    const shortcutOf = (name: string) =>
      screen.getByRole('radio', { name }).closest(`.${styles.choice}`)?.getAttribute('data-shortcut');
    expect(shortcutOf('Free')).toBe('A');
    expect(shortcutOf('Pro')).toBe('B');
    expect(shortcutOf('Enterprise')).toBe(null);

    // Exactly one shortcut cap per row — the choice renders its own, so a
    // consumer must not nest a second one.
    const caps = screen.getByRole('radio', { name: 'Free' }).closest(`.${styles.choice}`);
    expect(caps?.querySelectorAll(`.${styles.shortcut}`)).toHaveLength(1);
  });

  it('disables a choice marked disabled', () => {
    render(
      <Questionnaire
        items={[{ name: 'role', choices: [{ value: 'a', disabled: true }] }]}
        defaultItem="role"
      >
        <QuestionnaireItem name="role">
          <QuestionnaireChoices>
            <QuestionnaireChoice value="a" disabled>
              A
            </QuestionnaireChoice>
          </QuestionnaireChoices>
        </QuestionnaireItem>
      </Questionnaire>,
    );
    const input = screen.getByRole('radio', { name: 'A' });
    expect(input).toHaveProperty('disabled', true);
    expect(input.closest(`.${styles.choice}`)?.hasAttribute('data-disabled')).toBe(true);
  });
});
