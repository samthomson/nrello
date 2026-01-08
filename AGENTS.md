# Project Overview


## Project Structure

- `/src/components/`: UI components including NostrProvider for Nostr integration
  - `/src/components/ui/`: shadcn/ui components (48+ components available)
  - `/src/components/auth/`: Authentication-related components (LoginArea, LoginDialog, etc.)
  - Zap components: `ZapButton`, `ZapDialog`, `WalletModal` for Lightning payments
- `/src/hooks/`: Custom hooks including:
  - `useNostr`: Core Nostr protocol integration
  - `useAuthor`: Fetch user profile data by pubkey
  - `useCurrentUser`: Get currently logged-in user
  - `useNostrPublish`: Publish events to Nostr
  - `useUploadFile`: Upload files via Blossom servers
  - `useAppContext`: Access global app configuration
  - `useTheme`: Theme management
  - `useToast`: Toast notifications
  - `useLocalStorage`: Persistent local storage
  - `useLoggedInAccounts`: Manage multiple accounts
  - `useLoginActions`: Authentication actions
  - `useIsMobile`: Responsive design helper
  - `useZaps`: Lightning zap functionality with payment processing
  - `useWallet`: Unified wallet detection (WebLN + NWC)
  - `useNWC`: Nostr Wallet Connect connection management
  - `useNWCContext`: Access NWC context provider
- `/src/pages/`: Page components used by React Router (Index, NotFound)
- `/src/lib/`: Utility functions and shared logic
- `/src/contexts/`: React context providers (AppContext, NWCContext)
- `/src/test/`: Testing utilities including TestApp component
- `/public/`: Static assets
- `App.tsx`: Main app component with provider setup
- `AppRouter.tsx`: React Router configuration

## UI Components

The project uses shadcn/ui components located in `@/components/ui`. These are unstyled, accessible components built with Radix UI and styled with Tailwind CSS. Components follow a consistent pattern using React's `forwardRef` and the `cn()` utility for class name merging.

### Nostr Implementation Guidelines

- Always check the full list of existing NIPs before implementing any Nostr features to see what kinds are currently in use across all NIPs.
- If any existing kind or NIP might offer the required functionality, read the relevant NIPs to investigate thoroughly. Several NIPs may need to be read before making a decision.
- Only generate new kind numbers if no existing suitable kinds are found after comprehensive research.

Knowing when to create a new kind versus reusing an existing kind requires careful judgement. Introducing new kinds means the project won't be interoperable with existing clients. But deviating too far from the schema of a particular kind can cause different interoperability issues.

#### Choosing Between Existing NIPs and Custom Kinds

When implementing features that could use existing NIPs, follow this decision framework:

1. **Thorough NIP Review**: Before considering a new kind, always perform a comprehensive review of existing NIPs and their associated kinds. Get an overview of all NIPs, and then read specific NIPs and kind documentation to investigate any potentially relevant NIPs or kinds in detail. The goal is to find the closest existing solution.

2. **Prioritize Existing NIPs**: Always prefer extending or using existing NIPs over creating custom kinds, even if they require minor compromises in functionality.

3. **Interoperability vs. Perfect Fit**: Consider the trade-off between:
   - **Interoperability**: Using existing kinds means compatibility with other Nostr clients
   - **Perfect Schema**: Custom kinds allow perfect data modeling but create ecosystem fragmentation

4. **Extension Strategy**: When existing NIPs are close but not perfect:
   - Use the existing kind as the base
   - Add domain-specific tags for additional metadata
   - Document the extensions in `NIP.md`

5. **When to Generate Custom Kinds**:
   - No existing NIP covers the core functionality
   - The data structure is fundamentally different from existing patterns
   - The use case requires different storage characteristics (regular vs replaceable vs addressable)

6. **Custom Kind Publishing**: When publishing events with custom generated kinds, always include a NIP-31 "alt" tag with a human-readable description of the event's purpose.

**Example Decision Process**:
```
Need: Equipment marketplace for farmers
Options:
1. NIP-15 (Marketplace) - Too structured for peer-to-peer sales
2. NIP-99 (Classified Listings) - Good fit, can extend with farming tags
3. Custom kind - Perfect fit but no interoperability

Decision: Use NIP-99 + farming-specific tags for best balance
```

#### Tag Design Principles

When designing tags for Nostr events, follow these principles:

1. **Kind vs Tags Separation**:
   - **Kind** = Schema/structure (how the data is organized)
   - **Tags** = Semantics/categories (what the data represents)
   - Don't create different kinds for the same data structure

2. **Use Single-Letter Tags for Categories**:
   - **Relays only index single-letter tags** for efficient querying
   - Use `t` tags for categorization, not custom multi-letter tags
   - Multiple `t` tags allow items to belong to multiple categories

3. **Relay-Level Filtering**:
   - Design tags to enable efficient relay-level filtering with `#t: ["category"]`
   - Avoid client-side filtering when relay-level filtering is possible
   - Consider query patterns when designing tag structure

4. **Tag Examples**:
   ```json
   // ❌ Wrong: Multi-letter tag, not queryable at relay level
   ["product_type", "electronics"]

   // ✅ Correct: Single-letter tag, relay-indexed and queryable
   ["t", "electronics"]
   ["t", "smartphone"]
   ["t", "android"]
   ```

5. **Querying Best Practices**:
   ```typescript
   // ❌ Inefficient: Get all events, filter in JavaScript
   const events = await nostr.query([{ kinds: [30402] }]);
   const filtered = events.filter(e => hasTag(e, 'product_type', 'electronics'));

   // ✅ Efficient: Filter at relay level
   const events = await nostr.query([{ kinds: [30402], '#t': ['electronics'] }]);
   ```

#### `t` Tag Filtering for Community-Specific Content

For applications focused on a specific community or niche, you can use `t` tags to filter events for the target audience.

**When to Use:**
- ✅ Community apps: "farmers" → `t: "farming"`, "Poland" → `t: "poland"`
- ❌ Generic platforms: Twitter clones, general Nostr clients

**Implementation:**
```typescript
// Publishing with community tag
createEvent({
  kind: 1,
  content: data.content,
  tags: [['t', 'farming']]
});

// Querying community content
const events = await nostr.query([{
  kinds: [1],
  '#t': ['farming'],
  limit: 20
}], { signal });
```

### Kind Ranges

An event's kind number determines the event's behavior and storage characteristics:

- **Regular Events** (1000 ≤ kind < 10000): Expected to be stored by relays permanently. Used for persistent content like notes, articles, etc.
- **Replaceable Events** (10000 ≤ kind < 20000): Only the latest event per pubkey+kind combination is stored. Used for profile metadata, contact lists, etc.
- **Addressable Events** (30000 ≤ kind < 40000): Identified by pubkey+kind+d-tag combination, only latest per combination is stored. Used for articles, long-form content, etc.

Kinds below 1000 are considered "legacy" kinds, and may have different storage characteristics based on their kind definition. For example, kind 1 is regular, while kind 3 is replaceable.

### Content Field Design Principles

When designing new event kinds, the `content` field should be used for semantically important data that doesn't need to be queried by relays. **Structured JSON data generally shouldn't go in the content field** (kind 0 being an early exception).

#### Guidelines

- **Use content for**: Large text, freeform human-readable content, or existing industry-standard JSON formats (Tiled maps, FHIR, GeoJSON)
- **Use tags for**: Queryable metadata, structured data, anything that needs relay-level filtering
- **Empty content is valid**: Many events need only tags with `content: ""`
- **Relays only index tags**: If you need to filter by a field, it must be a tag

#### Example

**✅ Good - queryable data in tags:**
```json
{
  "kind": 30402,
  "content": "",
  "tags": [["d", "product-123"], ["title", "Camera"], ["price", "250"], ["t", "photography"]]
}
```

**❌ Bad - structured data in content:**
```json
{
  "kind": 30402,
  "content": "{\"title\":\"Camera\",\"price\":250,\"category\":\"photo\"}",
  "tags": [["d", "product-123"]]
}
```

### NIP.md

The file `NIP.md` is used by this project to define a custom Nostr protocol document. If the file doesn't exist, it means this project doesn't have any custom kinds associated with it.

Whenever new kinds are generated, the `NIP.md` file in the project must be created or updated to document the custom event schema. Whenever the schema of one of these custom events changes, `NIP.md` must also be updated accordingly.

### The `useNostr` Hook

The `useNostr` hook returns an object containing a `nostr` property, with `.query()` and `.event()` methods for querying and publishing Nostr events respectively.

```typescript
import { useNostr } from '@nostrify/react';

function useCustomHook() {
  const { nostr } = useNostr();

  // ...
}
```

### Connecting to Multiple Nostr Relays

By default, the `nostr` object from `useNostr` uses a pool configuration. For specific relays, use `nostr.relay(url)` or `nostr.group([url1, url2])`. These have the same API as the main `nostr` object (`.query()`, `.req()`, `.event()`).

### Query Nostr Data with `useNostr` and Tanstack Query

When querying Nostr, the best practice is to create custom hooks that combine `useNostr` and `useQuery` to get the required data.

```typescript
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/query';

function usePosts() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['posts'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{ kinds: [1], limit: 20 }], { signal });
      return events; // these events could be transformed into another format
    },
  });
}
```

### Infinite Scroll for Feeds

Use `useInfiniteQuery` with Nostr's timestamp-based pagination. Set `until` filter to `lastPage[lastPage.length - 1].created_at - 1` for `getNextPageParam`. Use `useInView` from `react-intersection-observer` to trigger loading.

#### Efficient Query Design

**Critical**: Always minimize the number of separate queries to avoid rate limiting and improve performance. Combine related queries whenever possible.

**✅ Efficient - Single query with multiple kinds:**
```typescript
// Query multiple event types in one request
const events = await nostr.query([
  {
    kinds: [1, 6, 16], // All repost kinds in one query
    '#e': [eventId],
    limit: 150,
  }
], { signal });

// Separate by type in JavaScript
const notes = events.filter((e) => e.kind === 1);
const reposts = events.filter((e) => e.kind === 6);
const genericReposts = events.filter((e) => e.kind === 16);
```

**❌ Inefficient - Multiple separate queries:**
```typescript
// This creates unnecessary load and can trigger rate limiting
const [notes, reposts, genericReposts] = await Promise.all([
  nostr.query([{ kinds: [1], '#e': [eventId] }], { signal }),
  nostr.query([{ kinds: [6], '#e': [eventId] }], { signal }),
  nostr.query([{ kinds: [16], '#e': [eventId] }], { signal }),
]);
```

**Query Optimization Guidelines:**
1. **Combine kinds**: Use `kinds: [1, 6, 16]` instead of separate queries
2. **Use multiple filters**: When you need different tag filters, use multiple filter objects in a single query
3. **Adjust limits**: When combining queries, increase the limit appropriately
4. **Filter in JavaScript**: Separate event types after receiving results rather than making multiple requests
5. **Consider relay capacity**: Each query consumes relay resources and may count against rate limits

The data may be transformed into a more appropriate format if needed, and multiple calls to `nostr.query()` may be made in a single queryFn.

#### Event Validation

For custom kinds with required tags or strict schemas, filter events through a validator function. Not needed for freeform kinds like kind 1.

### The `useAuthor` Hook

To display profile data for a user by their Nostr pubkey (such as an event author), use the `useAuthor` hook.

```tsx
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';

function Post({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const profileImage = metadata?.picture;

  // ...render elements with this data
}
```

#### `NostrMetadata` type

Import `NostrMetadata` from `@nostrify/nostrify` - it contains all kind 0 metadata fields (name, picture, about, nip05, etc.).

### The `useNostrPublish` Hook

To publish events, use the `useNostrPublish` hook in this project. This hook automatically adds a "client" tag to published events.

```tsx
import { useState } from 'react';

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from '@/hooks/useNostrPublish';

export function MyComponent() {
  const [ data, setData] = useState<Record<string, string>>({});

  const { user } = useCurrentUser();
  const { mutate: createEvent } = useNostrPublish();

  const handleSubmit = () => {
    createEvent({ kind: 1, content: data.content });
  };

  if (!user) {
    return <span>You must be logged in to use this form.</span>;
  }

  return (
    <form onSubmit={handleSubmit} disabled={!user}>
      {/* ...some input fields */}
    </form>
  );
}
```

The `useCurrentUser` hook should be used to ensure that the user is logged in before they are able to publish Nostr events.

### Nostr Login

To enable login with Nostr, simply use the `LoginArea` component already included in this project.

```tsx
import { LoginArea } from "@/components/auth/LoginArea";

function MyComponent() {
  return (
    <div>
      {/* other components ... */}

      <LoginArea className="max-w-60" />
    </div>
  );
}
```

The `LoginArea` component handles all the login-related UI and interactions, including displaying login dialogs, sign up functionality, and switching between accounts. It should not be wrapped in any conditional logic.

`LoginArea` displays both "Log in" and "Sign Up" buttons when the user is logged out, and changes to an account switcher once the user is logged in. It is an inline-flex element by default. To make it expand to the width of its container, you can pass a className like `flex` (to make it a block element) or `w-full`. If it is left as inline-flex, it's recommended to set a max width.

**Important**: Social applications should include a profile menu button in the main interface (typically in headers/navigation) to provide access to account settings, profile editing, and logout functionality. Don't only show `LoginArea` in logged-out states.

### NIP-19 Identifiers

**Critical**: Handle NIP-19 identifiers at the **root level** of URLs (`/:nip19`), not nested paths. The project includes a `NIP19Page` component that decodes identifiers using `nip19.decode()`.

**Key points:**
- Always decode NIP-19 identifiers before using in queries (filters require hex strings)
- `note1` = kind:1 events only; `nevent1` = any event kind with relay hints
- `npub1` = pubkey only; `nprofile1` = pubkey + relay hints
- `naddr1` = addressable events (includes author pubkey for security)
- Invalid/unsupported identifiers → 404 NotFound

### Nostr Edit Profile

To include an Edit Profile form, place the `EditProfileForm` component in the project:

```tsx
import { EditProfileForm } from "@/components/EditProfileForm";

function EditProfilePage() {
  return (
    <div>
      {/* you may want to wrap this in a layout or include other components depending on the project ... */}

      <EditProfileForm />
    </div>
  );
}
```

The `EditProfileForm` component displays just the form. It requires no props, and will "just work" automatically.

### Uploading Files on Nostr

Use the `useUploadFile` hook to upload files. This hook uses Blossom servers for file storage and returns NIP-94 compatible tags.

```tsx
import { useUploadFile } from "@/hooks/useUploadFile";

function MyComponent() {
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const handleUpload = async (file: File) => {
    try {
      // Provides an array of NIP-94 compatible tags
      // The first tag in the array contains the URL
      const [[_, url]] = await uploadFile(file);
      // ...use the url
    } catch (error) {
      // ...handle errors
    }
  };

  // ...rest of component
}
```

To attach files to kind 1 events, each file's URL should be appended to the event's `content`, and an `imeta` tag should be added for each file. For kind 0 events, the URL by itself can be used in relevant fields of the JSON content.

### Nostr Encryption and Decryption

The logged-in user has a `signer` object (matching the NIP-07 signer interface) that can be used for encryption and decryption. The signer's nip44 methods handle all cryptographic operations internally, including key derivation and conversation key management, so you never need direct access to private keys. Always use the signer interface for encryption rather than requesting private keys from users, as this maintains security and follows best practices.

```ts
// Get the current user
const { user } = useCurrentUser();

// Optional guard to check that nip44 is available
if (!user.signer.nip44) {
  throw new Error("Please upgrade your signer extension to a version that supports NIP-44 encryption");
}

// Encrypt message to self
const encrypted = await user.signer.nip44.encrypt(user.pubkey, "hello world");
// Decrypt message to self
const decrypted = await user.signer.nip44.decrypt(user.pubkey, encrypted) // "hello world"
```

### Rendering Rich Text Content

Nostr text notes (kind 1, 11, and 1111) have a plaintext `content` field that may contain URLs, hashtags, and Nostr URIs. These events should render their content using the `NoteContent` component:

```tsx
import { NoteContent } from "@/components/NoteContent";

export function Post(/* ...props */) {
  // ...

  return (
    <CardContent className="pb-2">
      <div className="whitespace-pre-wrap break-words">
        <NoteContent event={post} className="text-sm" />
      </div>
    </CardContent>
  );
}
```

### Adding Comments Sections

The project includes a complete commenting system using NIP-22 (kind 1111) comments that can be added to any Nostr event or URL. The `CommentsSection` component provides a full-featured commenting interface with threaded replies, user authentication, and real-time updates.

#### Basic Usage

```tsx
import { CommentsSection } from "@/components/comments/CommentsSection";

function ArticlePage({ article }: { article: NostrEvent }) {
  return (
    <div className="space-y-6">
      {/* Your article content */}
      <div>{/* article content */}</div>

      {/* Comments section */}
      <CommentsSection root={article} />
    </div>
  );
}
```

#### Props and Customization

The `CommentsSection` component accepts the following props:

- **`root`** (required): The root event or URL to comment on. Can be a `NostrEvent` or `URL` object.
- **`title`**: Custom title for the comments section (default: "Comments")
- **`emptyStateMessage`**: Message shown when no comments exist (default: "No comments yet")
- **`emptyStateSubtitle`**: Subtitle for empty state (default: "Be the first to share your thoughts!")
- **`className`**: Additional CSS classes for styling
- **`limit`**: Maximum number of comments to load (default: 500)

```tsx
<CommentsSection
  root={event}
  title="Discussion"
  emptyStateMessage="Start the conversation"
  emptyStateSubtitle="Share your thoughts about this post"
  className="mt-8"
  limit={100}
/>
```

#### Commenting on URLs

The comments system also supports commenting on external URLs, making it useful for web pages, articles, or any online content:

```tsx
<CommentsSection
  root={new URL("https://example.com/article")}
  title="Comments on this article"
/>
```

## App Configuration

The project includes an `AppProvider` that manages global application state including theme and relay configuration. The default configuration includes:

```typescript
const defaultConfig: AppConfig = {
  theme: "light",
  relayUrl: "wss://relay.nostr.band",
};
```

Preset relays are available including Ditto, Nostr.Band, Damus, and Primal. The app uses local storage to persist user preferences.

## Routing

The project uses React Router with a centralized routing configuration in `AppRouter.tsx`. To add new routes:

1. Create your page component in `/src/pages/`
2. Import it in `AppRouter.tsx`
3. Add the route above the catch-all `*` route:

```tsx
<Route path="/your-path" element={<YourComponent />} />
```

The router includes automatic scroll-to-top functionality and a 404 NotFound page for unmatched routes.

## Development Practices

- Uses React Query for data fetching and caching
- Follows shadcn/ui component patterns
- Implements Path Aliases with `@/` prefix for cleaner imports
- Uses Vite for fast development and production builds
- Component-based architecture with React hooks
- Default connection to one Nostr relay for best performance
- Comprehensive provider setup with NostrLoginProvider, QueryClientProvider, and custom AppProvider
- **Never use the `any` type**: Always use proper TypeScript types for type safety

## Loading States

**Use skeleton loading** for structured content (feeds, profiles, forms). **Use spinners** only for buttons or short operations.

```tsx
// Skeleton example matching component structure
<Card>
  <CardHeader>
    <div className="flex items-center space-x-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="space-y-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  </CardContent>
</Card>
```

### Empty States and No Content Found

When no content is found (empty search results, no data available, etc.), display a minimalist empty state with the `RelaySelector` component. This allows users to easily switch relays to discover content from different sources.

```tsx
import { RelaySelector } from '@/components/RelaySelector';
import { Card, CardContent } from '@/components/ui/card';

// Empty state example
<div className="col-span-full">
  <Card className="border-dashed">
    <CardContent className="py-12 px-8 text-center">
      <div className="max-w-sm mx-auto space-y-6">
        <p className="text-muted-foreground">
          No results found. Try another relay?
        </p>
        <RelaySelector className="w-full" />
      </div>
    </CardContent>
  </Card>
</div>
```

## Design Customization

**Tailor the site's look and feel based on the user's specific request.** This includes:

- **Color schemes**: Incorporate the user's color preferences when specified, and choose an appropriate scheme that matches the application's purpose and aesthetic
- **Typography**: Choose fonts that match the requested aesthetic (modern, elegant, playful, etc.)
- **Layout**: Follow the requested structure (3-column, sidebar, grid, etc.)
- **Component styling**: Use appropriate border radius, shadows, and spacing for the desired feel
- **Interactive elements**: Style buttons, forms, and hover states to match the theme

### Adding Fonts

To add custom fonts, follow these steps:

1. **Install a font package** using npm:

   **Any Google Font can be installed** using the @fontsource packages. Examples:
   - For Inter Variable: `@fontsource-variable/inter`
   - For Roboto: `@fontsource/roboto`
   - For Outfit Variable: `@fontsource-variable/outfit`
   - For Poppins: `@fontsource/poppins`
   - For Open Sans: `@fontsource/open-sans`

   **Format**: `@fontsource/[font-name]` or `@fontsource-variable/[font-name]` (for variable fonts)

2. **Import the font** in `src/main.tsx`:
   ```typescript
   import '@fontsource-variable/<font-name>';
   ```

3. **Update Tailwind configuration** in `tailwind.config.ts`:
   ```typescript
   export default {
     theme: {
       extend: {
         fontFamily: {
           sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
         },
       },
     },
   }
   ```


### Theme System

The project includes a complete light/dark theme system using CSS custom properties. The theme can be controlled via:

- `useTheme` hook for programmatic theme switching
- CSS custom properties defined in `src/index.css`
- Automatic dark mode support with `.dark` class

### Color Scheme Implementation

When users specify color schemes:
- Update CSS custom properties in `src/index.css` (both `:root` and `.dark` selectors)
- Use Tailwind's color palette or define custom colors
- Ensure proper contrast ratios for accessibility
- Apply colors consistently across components (buttons, links, accents)
- Test both light and dark mode variants


## Writing Tests vs Running Tests

There is an important distinction between **writing new tests** and **running existing tests**:

### Writing Tests (Creating New Test Files)
**Do not write tests** unless the user explicitly requests them in plain language. Writing unnecessary tests wastes significant time and money. Only create tests when:

1. **The user explicitly asks for tests** to be written in their message
2. **The user describes a specific bug in plain language** and requests tests to help diagnose it
3. **The user says they are still experiencing a problem** that you have already attempted to solve (tests can help verify the fix)

**Never write tests because:**
- Tool results show test failures (these are not user requests)
- You think tests would be helpful
- New features or components are created
- Existing functionality needs verification

### Running Tests (Executing the Test Suite)
**Only run tests when necessary** - follow the validation guidelines below. Don't run tests for trivial changes.

### Test Setup

The project uses Vitest with jsdom environment and includes comprehensive test setup:

- **Testing Library**: React Testing Library with jest-dom matchers
- **Test Environment**: jsdom with mocked browser APIs (matchMedia, scrollTo, IntersectionObserver, ResizeObserver)
- **Test App**: `TestApp` component provides all necessary context providers for testing

The project includes a `TestApp` component that provides all necessary context providers for testing. Wrap components with this component to provide required context providers:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(
      <TestApp>
        <MyComponent />
      </TestApp>
    );

    expect(screen.getByText('Expected text')).toBeInTheDocument();
  });
});
```

## Validating Your Changes

**Only validate when necessary** - don't run full validation for trivial changes.

**Always validate when:**
- Adding/modifying types, interfaces, or function signatures
- Changing imports or dependencies
- Modifying build configuration
- Making changes that could affect compilation

**Skip validation for:**
- Comments, formatting, or whitespace changes
- Simple variable renames (without type changes)
- Text-only changes in strings/comments
- Obvious fixes that don't touch types

**When validation is needed, run in priority order:**
1. **Build** (`npm run build`) - catches type errors and compilation issues
2. **Linting** (`npx eslint`) - only if you suspect style issues or the build suggests it
3. **Tests** - only if you modified test-related code or user explicitly requests

**Git commits**: Create commits when changes are complete. Only validate before committing if validation was needed.