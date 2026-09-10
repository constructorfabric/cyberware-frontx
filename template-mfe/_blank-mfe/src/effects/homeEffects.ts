/**
 * Home Domain - Effects
 * Add your domain effects here.
 * Effects subscribe to events via eventBus and dispatch to the store.
 *
 * Example:
 *   eventBus.on('mfe/home/data-fetch-requested', async () => {
 *     const response = await apiRegistry.getService(_BlankApiService).getData();
 *     dispatch(setData(response.data));
 *   });
 */

import { type AppDispatch } from '@gears-frontx/react';

/**
 * Initialize home domain effects
 */
export function initHomeEffects(dispatch: AppDispatch): void {
  void dispatch;
}
