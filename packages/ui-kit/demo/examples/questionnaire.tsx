import { useState } from 'react';

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
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

/*
 * One array drives both the engine's `items` definitions and the rendered
 * tree, so the two can't drift — the engine warns in development when a
 * definition has no matching rendered part, or when `required`/`disabled`/
 * choice order disagree between them.
 */
const ITEMS = [
  {
    name: 'direction',
    title: 'What should the agent build next?',
    description: 'Choose a direction or describe another task.',
    required: true,
    choices: [
      {
        value: 'tool-calls',
        label: 'Tool call timeline',
        description: 'Show what the agent ran and what came back.',
      },
      {
        value: 'approvals',
        label: 'Approval checkpoints',
        description: 'Ask before sensitive or destructive actions.',
      },
      {
        value: 'handoffs',
        label: 'Sub-agent handoffs',
        description: 'Make delegated work and results easier to follow.',
      },
    ],
    input: { label: 'Another agent feature', placeholder: 'Describe another feature…' },
  },
  {
    name: 'signals',
    title: 'What should every progress update include?',
    description: 'Select all that apply, or skip this question.',
    required: false,
    multiple: true,
    choices: [
      { value: 'progress', label: 'Progress' },
      { value: 'decisions', label: 'Decisions' },
      { value: 'risks', label: 'Risks' },
      { value: 'next-step', label: 'Next step' },
    ],
  },
  {
    name: 'timing',
    title: 'When should work begin?',
    description: 'Choose when the agent should begin the work.',
    required: true,
    choices: [
      { value: 'now', label: 'Start now' },
      { value: 'next-cycle', label: 'Next development cycle' },
      { value: 'backlog', label: 'Add it to the backlog' },
    ],
  },
] as const;

function DefaultDemo() {
  const [result, setResult] = useState<string | null>(null);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Questionnaire
        items={ITEMS}
        defaultItem="direction"
        shortcuts="letters"
        style={{ maxWidth: '28rem' }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setResult(
            JSON.stringify({
              direction: data.get('direction'),
              // A `multiple` item submits one entry per checked choice, so it
              // is read with getAll — a skipped item yields an empty list.
              signals: data.getAll('signals'),
              timing: data.get('timing'),
            }),
          );
        }}
      >
        <QuestionnaireProgress />

        {ITEMS.map((question) => (
          <QuestionnaireItem
            key={question.name}
            name={question.name}
            required={question.required}
            multiple={'multiple' in question && question.multiple}
          >
            <QuestionnaireTitle>{question.title}</QuestionnaireTitle>
            <QuestionnaireDescription>{question.description}</QuestionnaireDescription>
            <QuestionnaireChoices>
              {question.choices.map((choice) => (
                <QuestionnaireChoice key={choice.value} value={choice.value}>
                  <span style={{ fontWeight: 'var(--text-label-weight)' }}>{choice.label}</span>
                  {'description' in choice ? (
                    <QuestionnaireChoiceDescription>
                      {choice.description}
                    </QuestionnaireChoiceDescription>
                  ) : null}
                </QuestionnaireChoice>
              ))}
              {'input' in question ? (
                <QuestionnaireInput
                  aria-label={question.input.label}
                  placeholder={question.input.placeholder}
                />
              ) : null}
            </QuestionnaireChoices>
            <QuestionnaireError />
          </QuestionnaireItem>
        ))}

        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireSkip />
          <QuestionnaireNext />
          <QuestionnaireSubmit>Save plan</QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>

      {result && (
        <pre
          style={{
            margin: 0,
            maxWidth: '28rem',
            overflowX: 'auto',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--muted)',
            color: 'var(--muted-foreground)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-mono-size)',
          }}
        >
          {result}
        </pre>
      )}
    </div>
  );
}

const CHECKPOINT_ITEMS = [
  {
    name: 'environment',
    choices: [{ value: 'staging' }, { value: 'production' }],
    required: true,
  },
  {
    name: 'rollback',
    choices: [{ value: 'automatic' }, { value: 'manual' }, { value: 'none', disabled: true }],
    required: true,
  },
];

/** Replaces Progress's default "Question X of Y" text with a segmented bar
 * built from its render state, without giving up the progressbar role or
 * its announced value. */
function SegmentedProgressDemo() {
  return (
    <Questionnaire items={CHECKPOINT_ITEMS} defaultItem="environment" style={{ maxWidth: '28rem' }}>
      <QuestionnaireProgress
        render={(props, state) => (
          <div {...props}>
            <div
              aria-hidden="true"
              style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}
            >
              {Array.from({ length: state.total }, (_, index) => (
                <span
                  key={index}
                  style={{
                    height: '0.375rem',
                    flex: 1,
                    borderRadius: '9999px',
                    backgroundColor: index < state.current ? 'var(--primary)' : 'var(--muted)',
                  }}
                />
              ))}
            </div>
            <span>
              Checkpoint {state.current} of {state.total}
            </span>
          </div>
        )}
        style={{ width: '100%' }}
      />

      <QuestionnaireItem name="environment" required>
        <QuestionnaireTitle>Where should this deploy?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="staging">Staging</QuestionnaireChoice>
          <QuestionnaireChoice value="production">Production</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>

      <QuestionnaireItem name="rollback" required>
        <QuestionnaireTitle>How should a failed deploy roll back?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="automatic">Automatically</QuestionnaireChoice>
          <QuestionnaireChoice value="manual">On my command</QuestionnaireChoice>
          <QuestionnaireChoice value="none" disabled>
            Don't roll back (unavailable on this plan)
          </QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>

      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>
  );
}

export default function QuestionnaireExample() {
  return (
    <>
      <Section title="Default">
        <DefaultDemo />
      </Section>

      <Section title="Segmented progress & disabled choice">
        <SegmentedProgressDemo />
      </Section>
    </>
  );
}
