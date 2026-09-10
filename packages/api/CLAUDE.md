# @gears-frontx/api

API communication protocols and service registry for FrontX applications.

## Core Framework Layer

This package is part of the **Core Framework layer** (`architecture/DESIGN.md` §1.3), alongside `@gears-frontx/mfes` and `@gears-frontx/gts-plugin`. It ships zero `@gears-frontx/*` runtime dependencies and can be used independently — only shared build-time config (`@gears-frontx/eslint-config`, `@gears-frontx/depcruise-config`) appears under devDependencies, and nothing under `src/` may import them. It has `axios` as a peer dependency.

Enforced by `npm run arch:edges` (manifest edges) and `npm run arch:deps:core` (import graph).

## Core Concepts

### BaseApiService

Abstract base class for domain-specific API services:

```typescript
import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/api';

class AccountsApiService extends BaseApiService {
  constructor() {
    const rest = new RestProtocol();
    super(
      { baseURL: '/api/accounts' },
      rest,
      new RestEndpointProtocol(rest)
    );
  }

  async getCurrentUser(): Promise<User> {
    return this.protocol(RestProtocol).get('/user/current');
  }

  async updateProfile(data: ProfileUpdate): Promise<User> {
    return this.protocol(RestProtocol).put('/user/profile', data);
  }
}
```

### Endpoint Descriptors

Services declare read and write endpoints as descriptors. Cache keys are derived automatically from `[baseURL, method, path]`. No manual key factories needed.

```typescript
import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/api';

class AccountsApiService extends BaseApiService {
  constructor() {
    const rest = new RestProtocol();
    super({ baseURL: '/api/accounts' }, rest, new RestEndpointProtocol(rest));
  }

  // Static read endpoint — key: ['/api/accounts', 'GET', '/user/current']
  readonly getCurrentUser = this.protocol(RestEndpointProtocol).query<User>('/user/current');

  // Parameterized read endpoint — key: ['/api/accounts', 'GET', '/user/123', { id: '123' }]
  readonly getUser = this.protocol(RestEndpointProtocol).queryWith<User, { id: string }>(
    (params) => `/user/${params.id}`
  );

  // Read endpoint with cache config override
  readonly getConfig = this.protocol(RestEndpointProtocol).query<AppConfig>('/config', {
    staleTime: 600_000,  // 10 min
    gcTime: Infinity,
  });

  // Write endpoint
  readonly updateProfile = this.protocol(RestEndpointProtocol)
    .mutation<User, ProfileUpdate>('PUT', '/user/profile');
}
```

Components consume descriptors via `useApiQuery(service.endpoint)` — see `@gears-frontx/react`.

### API Registry

Central registry for all API services:

```typescript
import { apiRegistry } from '@gears-frontx/api';

// Register service with class reference (type-safe)
apiRegistry.register(AccountsApiService);

// Get service (type-safe with class reference)
const accounts = apiRegistry.getService(AccountsApiService);
const user = await accounts.getCurrentUser.fetch();
```

### Stream Descriptors (SSE)

Services declare SSE streaming endpoints as stream descriptors. Keys are derived from `[baseURL, 'SSE', path]`. The `SseStreamProtocol.stream()` contract routes through `SseProtocol` with full plugin chain support (including mock short-circuit via `SseMockPlugin`).

```typescript
import {
  BaseApiService,
  SseProtocol,
  SseStreamProtocol,
} from '@gears-frontx/api';

class ChatApiService extends BaseApiService {
  constructor() {
    const sse = new SseProtocol();
    super(
      { baseURL: '/api/chat' },
      sse,
      new SseStreamProtocol(sse)
    );
  }

  // SSE stream — key: ['/api/chat', 'SSE', '/stream/messages']
  // Default parser: JSON.parse(event.data)
  readonly messageStream = this.protocol(SseStreamProtocol)
    .stream<ChatMessage>('/stream/messages');

  // With custom parser
  readonly rawStream = this.protocol(SseStreamProtocol).stream<string>(
    '/stream/raw',
    { parse: (event) => event.data }
  );
}
```

Components consume stream descriptors via `useApiStream(service.streamDescriptor)` — see `@gears-frontx/react`.

### Mock Support

Configure mocks via RestMockPlugin using the `registerPlugin()` pattern. Framework controls mock plugin activation via the Mock API toggle.

```typescript
import { BaseApiService, RestProtocol, RestMockPlugin } from '@gears-frontx/api';

// Register mock plugins in service constructor
// Framework activates/deactivates based on mock mode state
class ChatApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: '/api/chat' }, restProtocol);

    // Register mock plugin (framework controls when it's active)
    this.registerPlugin(restProtocol, new RestMockPlugin({
      mockMap: {
        'GET /api/chat/threads': () => [{ id: '1', title: 'Thread 1' }],
        'POST /api/chat/messages': (body) => ({ id: '2', ...body }),
      },
      delay: 100,
    }));
  }
}

// Global mocks (for cross-cutting concerns)
apiRegistry.plugins.add(RestProtocol, new RestMockPlugin({
  mockMap: {
    'GET /api/health': () => ({ status: 'ok' }),
  },
  delay: 100,
}));
```

### Plugin System

Create plugins by extending ApiPluginBase or ApiPlugin<TConfig>:

```typescript
import { ApiPlugin, ApiPluginBase, ApiRequestContext, ApiResponseContext } from '@gears-frontx/api';

// Simple plugin (no config)
class LoggingPlugin extends ApiPluginBase {
  onRequest(ctx: ApiRequestContext) {
    console.log(`[${ctx.method}] ${ctx.url}`);
    return ctx;
  }

  onResponse(response: ApiResponseContext, request: ApiRequestContext) {
    console.log(`[${response.status}] ${request.url}`);
    return response;
  }
}

// Plugin with config
class AuthPlugin extends ApiPlugin<{ getToken: () => string | null }> {
  onRequest(ctx: ApiRequestContext) {
    const token = this.config.getToken();
    if (!token) return ctx;
    return {
      ...ctx,
      headers: { ...ctx.headers, Authorization: `Bearer ${token}` }
    };
  }
}

// Register on service
service.plugins.add(new LoggingPlugin());
service.plugins.add(new AuthPlugin({ getToken: () => localStorage.getItem('token') }));

// Or register globally
apiRegistry.plugins.add(new LoggingPlugin());
```

## Protocol Support

### RestProtocol

HTTP REST API calls via axios:

```typescript
import { RestProtocol } from '@gears-frontx/api';

const restProtocol = new RestProtocol({
  timeout: 30000,
  withCredentials: true,
  contentType: 'application/json'
});
```

## Mock Mode

Mock mode is controlled centrally by the framework via the `toggleMockMode()` action. Services register mock plugins using `registerPlugin()`, and the framework activates/deactivates them based on mock mode state.

```typescript
// In @gears-frontx/framework - toggle mock mode (used by FrontX Studio)
import { toggleMockMode } from '@gears-frontx/framework';
toggleMockMode(true);  // Enable all mock plugins
toggleMockMode(false); // Disable all mock plugins

// Custom mock plugins must be marked with MOCK_PLUGIN symbol
import { ApiPluginBase, MOCK_PLUGIN } from '@gears-frontx/api';

class CustomMockPlugin extends ApiPluginBase {
  static readonly [MOCK_PLUGIN] = true;  // Required for framework to identify as mock plugin
  // ... implementation
}

// Check if a plugin is a mock plugin
import { isMockPlugin } from '@gears-frontx/api';
if (isMockPlugin(plugin)) {
  console.log('This is a mock plugin');
}
```

## Key Rules

1. **Services extend BaseApiService** - Use the base class for protocol management
2. **Register with class reference** - Call `apiRegistry.register(ServiceClass)`
3. **One service per domain** - Each bounded context gets one service
4. **Endpoints as descriptors** - Use explicit descriptor contracts: `RestEndpointProtocol.query()`, `queryWith()`, `mutation()` for REST; `SseStreamProtocol.stream()` for SSE
5. **Cache keys are automatic** - Derived from `[baseURL, method, path]` — never define manual key factories
6. **No standalone query factories** - The service IS the data layer; MFEs do not add parallel query-factory layers
7. **Mock plugins via registerPlugin()** - Use `this.registerPlugin(protocol, mockPlugin)` in constructor
8. **Mock mode via framework** - Framework controls mock plugin lifecycle via `toggleMockMode()`
9. **Plugin identification by class** - Use class references, not string names

## Retry Pattern

Plugins can retry failed requests with optional modifications using `ApiPluginErrorContext`:

```typescript
import { RestPluginWithConfig, ApiPluginErrorContext } from '@gears-frontx/api';

interface AuthConfig {
  getToken: () => string | null;
  refreshToken: () => Promise<string>;
}

class AuthPlugin extends RestPluginWithConfig<AuthConfig> {
  async onRequest(ctx: RestRequestContext): Promise<RestRequestContext> {
    const token = this.config.getToken();
    if (!token) return ctx;
    return {
      ...ctx,
      headers: { ...ctx.headers, Authorization: `Bearer ${token}` }
    };
  }

  async onError(context: ApiPluginErrorContext): Promise<Error | RestResponseContext> {
    // Check if error is 401 and this is the first attempt (not a retry)
    if (this.is401Error(context.error) && context.retryCount === 0) {
      try {
        // Refresh the token
        const newToken = await this.config.refreshToken();

        // Retry the request with the new token
        return context.retry({
          headers: { ...context.request.headers, Authorization: `Bearer ${newToken}` }
        });
      } catch (refreshError) {
        // If refresh fails, return original error
        return context.error;
      }
    }

    // Not a 401 or already retried - propagate error
    return context.error;
  }

  private is401Error(error: Error): boolean {
    return error.message.includes('401') || error.message.includes('Unauthorized');
  }
}
```

Key retry pattern guidelines:

1. **Always check `retryCount`** to prevent infinite retry loops
2. **Use `context.retry()`** to retry with optional request modifications
3. **Limit retries** - typically retry once (`retryCount === 0`)
4. **Return error** if retry should not happen or max attempts reached
5. **Safety net** - `maxRetryDepth` config (default: 10) prevents infinite loops

```typescript
// Configure max retry depth (default: 10)
const restProtocol = new RestProtocol({ maxRetryDepth: 5 });
```

## Exports

- `BaseApiService` - Abstract base class for protocol registration and plugin lifecycle
- `EndpointDescriptor` - Read endpoint descriptor type (key + fetch + cache options)
- `ParameterizedEndpointDescriptor` - Parameterized read endpoint descriptor type
- `MutationDescriptor` - Write endpoint descriptor type
- `StreamDescriptor` - SSE stream descriptor type (key + connect + disconnect)
- `StreamStatus` - Stream connection status type (`'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'`)
- `RestProtocol` - REST API protocol
- `SseProtocol` - SSE protocol
- `RestEndpointProtocol` - Declarative REST endpoint descriptor contract
- `SseStreamProtocol` - Declarative SSE stream descriptor contract
- `ApiPluginBase` - Abstract base class for plugins (no config)
- `ApiPlugin` - Abstract generic class for plugins with config
- `RestPlugin` - REST protocol plugin base class
- `RestPluginWithConfig` - REST protocol plugin with config
- `SsePlugin` - SSE protocol plugin base class
- `SsePluginWithConfig` - SSE protocol plugin with config
- `RestMockPlugin` - REST mock data plugin
- `SseMockPlugin` - SSE mock data plugin
- `apiRegistry` - Singleton registry
- `MOCK_PLUGIN` - Symbol for marking mock plugins
- `isMockPlugin` - Type guard for identifying mock plugins
- `ApiPluginErrorContext` - Error context with retry support
- `ApiRequestContext` - Plugin request context type
- `ApiResponseContext` - Plugin response context type
- `RestRequestContext` - REST request context type
- `RestResponseContext` - REST response context type
- `SseConnectContext` - SSE connection context type
- `ShortCircuitResponse` - Short-circuit response wrapper
- `RestShortCircuitResponse` - REST short-circuit response
- `SseShortCircuitResponse` - SSE short-circuit response
- `PluginType` - Type for plugin references
- `ProtocolType` - Type for protocol references
- `ProtocolPluginType` - Type mapping for protocol plugins
- `isShortCircuit` - Type guard for short-circuit responses
- `isRestShortCircuit` - Type guard for REST short-circuit responses
- `isSseShortCircuit` - Type guard for SSE short-circuit responses
- `MockMap` - Mock response map type
