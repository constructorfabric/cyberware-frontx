/**
 * Home Domain - Slice
 * Add your domain state, reducers, and selectors here.
 * Replace '_blank/home' with your screenset/domain name.
 */

import { createSlice } from '@gears-frontx/react';

const { slice } = createSlice({
  name: '_blank/home',
  initialState: {},
  reducers: {},
});

export const homeSlice = slice;

/**
 * RootState augmentation for type-safe selectors
 * Update the state type when you add your domain state shape.
 */
declare module '@gears-frontx/react' {
  interface RootState {
    '_blank/home': Record<string, never>;
  }
}
