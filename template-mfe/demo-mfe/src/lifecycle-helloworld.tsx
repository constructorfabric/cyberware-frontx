import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { KitThemedLifecycle } from './shared/KitThemedLifecycle';
import { mfeApp } from './init';
import { HelloWorldScreen } from './screens/helloworld/HelloWorldScreen';

class HelloWorldLifecycle extends KitThemedLifecycle {
  constructor() {
    super(mfeApp);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <HelloWorldScreen bridge={bridge} />;
  }
}

/**
 * Export a singleton instance of the lifecycle class.
 * Module Federation expects a default export; the handler calls
 * moduleFactory() which returns this module, then validates it
 * has mount/unmount methods.
 */
export default new HelloWorldLifecycle();
