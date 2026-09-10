import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  Field,
  FieldLabel,
  Input,
} from '@gears-frontx/ui-kit';
import type { ApiUser } from '../../../api/types';
import styles from '../ProfileScreen.module.css';

export type ProfileFormValues = {
  firstName: string;
  lastName: string;
  department: string;
};

interface ProfileDetailsCardProps {
  user: ApiUser;
  isSaving: boolean;
  saveErrorMessage?: string;
  t: (key: string) => string;
  onRefresh: () => void;
  onSubmit: (values: ProfileFormValues) => Promise<void>;
}

/**
 * Read the form's three values off a profile.
 *
 * The names are coalesced although `ApiUser` types them as `string`: that type
 * describes a response body nothing validates, so a profile whose name fields
 * came back null reaches here as one. Every value below is trimmed and rendered
 * as a controlled input's value, and both of those turn a null into a thrown
 * render rather than an empty field.
 */
function getFormValues(user: ApiUser): ProfileFormValues {
  return {
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    department:
      typeof user.extra?.department === 'string' ? user.extra.department : '',
  };
}

export const ProfileDetailsCard: React.FC<ProfileDetailsCardProps> = ({
  user,
  isSaving,
  saveErrorMessage,
  t,
  onRefresh,
  onSubmit,
}) => {
  /*
   * The edit buffer is the only state the card holds, and its presence is what
   * "editing" means. The pair it replaces — an `isEditing` flag beside a
   * `formValues` copy — had to be re-synced from `user` in an effect whenever a
   * refetch delivered a new profile while the form was closed, and a setState
   * called synchronously in an effect body re-renders the card before paint
   * (`react-hooks/set-state-in-effect`). With the buffer absent outside editing,
   * the displayed values are derived from `user` on every render and there is
   * nothing left to re-sync; a refetch arriving mid-edit still leaves the
   * buffer alone, exactly as the effect's `!isEditing` guard did.
   */
  const [editingValues, setEditingValues] = useState<ProfileFormValues | null>(null);
  const isEditing = editingValues !== null;

  const initialValues = useMemo(() => getFormValues(user), [user]);
  const formValues = editingValues ?? initialValues;
  const normalizedValues = useMemo(
    () => ({
      firstName: formValues.firstName.trim(),
      lastName: formValues.lastName.trim(),
      department: formValues.department.trim(),
    }),
    [formValues]
  );
  const isDirty =
    normalizedValues.firstName !== initialValues.firstName ||
    normalizedValues.lastName !== initialValues.lastName ||
    normalizedValues.department !== initialValues.department;
  const isFormValid =
    normalizedValues.firstName.length > 0 && normalizedValues.lastName.length > 0;

  const handleFieldChange =
    (field: keyof ProfileFormValues) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;

        // Only the editing branch renders these inputs, so there is always a
        // buffer to update. A change that somehow arrived after the buffer
        // closed is dropped: reopening the form from `user` is the Edit
        // button's decision, not this handler's.
        setEditingValues((current) =>
          current === null ? null : { ...current, [field]: value }
        );
      };

  const handleCancel = () => {
    setEditingValues(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isDirty || !isFormValid) {
      return;
    }

    try {
      await onSubmit(normalizedValues);
      setEditingValues(null);
    } catch {
      // Parent surfaces the error via saveErrorMessage; keep editing open.
    }
  };

  let body: React.ReactNode;
  if (isEditing) {
    body = (
      /*
       * The form sits inside CardContent rather than around the card's slots:
       * Card spaces its slots with `gap: var(--card-spacing)` on the card root,
       * so that rhythm only falls between Card's direct children. A wrapper
       * around them leaves the card a single child and the gap applies to
       * nothing, while the slots' horizontal padding still lands.
       */
      <form onSubmit={handleSubmit} className={styles.form}>
        {/*
          Field is layout only: it wires no ids and disables no control, so
          each label points at its input's own id and each input carries its
          own `disabled`. `data-disabled` on the Field is what dims the label
          alongside the control the kit's CSS already dims.
        */}
        <Field data-disabled={isSaving || undefined}>
          <FieldLabel htmlFor="profile-first-name">{t('first_name_label')}</FieldLabel>
          <Input
            id="profile-first-name"
            disabled={isSaving}
            value={formValues.firstName}
            onChange={handleFieldChange('firstName')}
          />
        </Field>

        <Field data-disabled={isSaving || undefined}>
          <FieldLabel htmlFor="profile-last-name">{t('last_name_label')}</FieldLabel>
          <Input
            id="profile-last-name"
            disabled={isSaving}
            value={formValues.lastName}
            onChange={handleFieldChange('lastName')}
          />
        </Field>

        <Field data-disabled={isSaving || undefined}>
          <FieldLabel htmlFor="profile-department">{t('department_label')}</FieldLabel>
          <Input
            id="profile-department"
            disabled={isSaving}
            value={formValues.department}
            onChange={handleFieldChange('department')}
          />
        </Field>

        {/*
          The save failure belongs to the request, not to any one control, so it
          stays outside the Fields rather than in a FieldError none of them owns.
        */}
        {saveErrorMessage ? <p className={styles.error}>{saveErrorMessage}</p> : null}

        <div className={styles.actions}>
          <Button type="submit" disabled={!isDirty || !isFormValid || isSaving}>
            {isSaving ? t('saving') : t('save')}
          </Button>
          <Button type="button" variant="outline" disabled={isSaving} onClick={handleCancel}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    );
  } else {
    body = (
      <dl className={styles.definitions}>
        <div>
          <dt className={styles.term}>{t('role_label')}</dt>
          <dd>{user.role}</dd>
        </div>
        {user.extra?.department !== undefined && (
          <div>
            <dt className={styles.term}>{t('department_label')}</dt>
            <dd>{String(user.extra.department)}</dd>
          </div>
        )}
        <div>
          <dt className={styles.term}>{t('id_label')}</dt>
          <dd className={styles.value}>{user.id}</dd>
        </div>
        <div>
          <dt className={styles.term}>{t('created_label')}</dt>
          <dd>{new Date(user.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className={styles.term}>{t('last_updated_label')}</dt>
          <dd>{new Date(user.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
    );
  }

  return (
    <Card>
      <CardContent>
        <div className={styles.identity}>
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={`${user.firstName} ${user.lastName}`}
              className={styles.avatar}
            />
          )}
          <h2 className={styles.name}>
            {user.firstName} {user.lastName}
          </h2>
          <p className={styles.email}>{user.email}</p>
        </div>
      </CardContent>
      <CardContent>{body}</CardContent>
      <CardFooter>
        <div className={styles.actions}>
          <Button data-testid="profile-refresh-button" onClick={onRefresh} disabled={isSaving}>
            {t('refresh')}
          </Button>
          {isEditing ? null : (
            <Button variant="outline" disabled={isSaving} onClick={() => setEditingValues(initialValues)}>
              {t('edit_profile')}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

ProfileDetailsCard.displayName = 'ProfileDetailsCard';
