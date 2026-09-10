/**
 * _Blank Domain - API Service
 * Replace '_Blank' with your screenset name.
 */

// @cpt-FEATURE:implement-endpoint-descriptors:p1

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
} from '@gears-frontx/react';
import { RestMockPlugin } from '@gears-frontx/frontx-template-shell';
import type { GetBlankStatusResponse } from './types';
import { blankMockMap } from './mocks';

/**
 * _Blank API Service
 * Add your domain-specific endpoint methods here.
 */
export class _BlankApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({
      timeout: 30000,
    });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: '/api/blank' }, restProtocol, restEndpoints);

    this.registerPlugin(
      restProtocol,
      new RestMockPlugin({
        mockMap: blankMockMap,
        delay: 100,
      })
    );
  }

  // @cpt-begin:implement-endpoint-descriptors:p1:inst-blank-descriptors
  readonly getStatus = this.protocol(RestEndpointProtocol)
    .query<GetBlankStatusResponse>('/status');
  // @cpt-end:implement-endpoint-descriptors:p1:inst-blank-descriptors
}
