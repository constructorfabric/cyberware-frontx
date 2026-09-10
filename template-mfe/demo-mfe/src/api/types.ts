/**
 * Accounts Domain - API Types
 * Type definitions for accounts service endpoints
 *
 * MFE-local types (mirrored from host's src/app/api/types.ts).
 * The MFE bundles its own copy of @gears-frontx/react and cannot import from the host.
 */

import type { Language } from '@gears-frontx/react';

/**
 * User Extra Properties
 * Applications extend this via module augmentation for platform-specific fields
 * @public Reserved for future module augmentation
 */
export interface UserExtra {
  // Applications add their types via module augmentation
  // Empty by default
  [key: string]: unknown;
}

/**
 * User entity from API
 */
export interface ApiUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  language: Language;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  extra?: UserExtra;
}

/**
 * User roles
 * @public Reserved for future use
 */
export enum UserRole {
  Admin = 'admin',
  User = 'user',
}

/**
 * Get current user response
 */
export interface GetCurrentUserResponse {
  user: ApiUser;
}

/**
 * Update profile request payload.
 */
export interface UpdateProfileRequest {
  firstName: string;
  lastName: string;
  department?: string;
}
