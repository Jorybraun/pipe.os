# {{Package/Module/Feature Name}}

{{Brief one-sentence description}}

## Overview

{{2-3 paragraph description of the package/module/feature explaining:

- What it does
- Why it exists
- How it fits into the Pipe platform
- Who the intended users are (developers, end-users, etc.)}}

## Key Features

- **{{Feature 1}}** - {{Description}}
- **{{Feature 2}}** - {{Description}}
- **{{Feature 3}}** - {{Description}}
- **{{Feature 4}}** - {{Description}}

## Folder Structure

```
{{package-name}}/
├── components/
│   ├── {{Component}}.tsx          # Main component
│   ├── {{Component}}.test.tsx     # Unit tests (Vitest)
│   └── {{Component}}.stories.tsx  # Storybook stories
├── hooks/
│   └── use{{Feature}}.ts          # Custom hook
├── lib/
│   └── {{feature}}/
│       └── index.ts               # Business logic
├── README.md                      # This file
└── index.ts                       # Public exports
```

## Installation and Setup

This module is internal to the Pipe platform and requires no external setup beyond the shared development dependencies.

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run Storybook for component development
npm run storybook
```

## Usage Examples

### Basic Usage

```typescript
import { {{functionName}} } from '@/lib/{{package-name}}';

// Example of basic usage
const result = {{functionName}}({{params}});
console.log(result); // {{expected output}}
```

### With React Components

```typescript
import { {{ComponentName}} } from '@/components/{{package-name}}';

const MyPage = () => {
  return (
    <{{ComponentName}}
      {{prop1}}="{{value1}}"
      {{prop2}}={{{value2}}}
    />
  );
};
```

### With Custom Hooks

```typescript
import { use{{Feature}} } from '@/hooks/use{{Feature}}';

const MyComponent = () => {
  const { data, isLoading, error } = use{{Feature}}();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>{data.name}</div>;
};
```

### With Amplify Data

```typescript
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const client = generateClient<Schema>();

// Query data
const { data: items, errors } = await client.models.{{Model}}.list();

// Create data
const { data: newItem, errors } = await client.models.{{Model}}.create({
  name: 'New Item',
});

// Real-time subscription
const subscription = client.models.{{Model}}.observeQuery().subscribe({
  next: ({ items }) => setItems([...items]),
});

// Cleanup
return () => subscription.unsubscribe();
```

## API Documentation

### Functions

#### `{{functionName}}()`

{{Brief description of what the function does}}

**Signature:**

```typescript
function {{functionName}}(
  {{param1}}: {{Type1}},
  {{param2}}: {{Type2}}
): {{ReturnType}}
```

**Parameters:**

- `{{param1}}` ({{Type1}}) - {{Description}}
- `{{param2}}` ({{Type2}}) - {{Description}}

**Returns:**

- {{ReturnType}} - {{Description}}

**Example:**

```typescript
const result = {{functionName}}({{example-params}});
// result: {{example-output}}
```

**Throws:**

- `{{ErrorType}}` - {{When this error occurs}}

---

### Components

#### `<{{ComponentName}} />`

{{Description of the component}}

**Props:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| {{prop1}} | {{Type1}} | Yes | - | {{Description}} |
| {{prop2}} | {{Type2}} | No | {{default}} | {{Description}} |

**Example:**

```tsx
<{{ComponentName}}
  {{prop1}}="value"
  {{prop2}}={123}
  on{{Event}}={(e) => console.log(e)}
/>
```

---

### Hooks

#### `use{{Feature}}()`

{{Description of the hook}}

**Signature:**

```typescript
function use{{Feature}}({{params}}): {
  data: {{DataType}} | null;
  isLoading: boolean;
  error: Error | null;
  {{action}}: ({{params}}) => Promise<void>;
}
```

**Returns:**

- `data` - The fetched data
- `isLoading` - Loading state
- `error` - Error object if request failed
- `{{action}}` - Function to trigger an action

**Example:**

```typescript
const { data, isLoading, error, {{action}} } = use{{Feature}}();
```

---

### Types and Interfaces

#### `{{TypeName}}`

{{Description of the type/interface}}

```typescript
type {{TypeName}} = {
  {{property1}}: {{Type1}};  // {{Description}}
  {{property2}}: {{Type2}};  // {{Description}}
  {{property3}}?: {{Type3}}; // {{Description}} (optional)
};
```

## Development

### Running Tests

```bash
# Run all tests (Vitest)
npm run test

# Run specific test file
npm run test {{file-name}}.test.ts

# Run tests in watch mode
npm run test -- --watch

# Run tests with coverage
npm run test -- --coverage
```

### Storybook Development

```bash
# Start Storybook
npm run storybook

# Build Storybook
npm run build-storybook
```

### Linting

```bash
# Check for linting errors
npm run lint

# Fix auto-fixable linting errors
npm run lint -- --fix
```

### Type Checking

```bash
# Check for type errors
npm run build
```

## Architecture and Design

### Design Decisions

- **{{Decision 1}}** - {{Rationale}}
- **{{Decision 2}}** - {{Rationale}}

### Amplify Integration

This module integrates with AWS Amplify Gen 2:

- **Data**: Uses Amplify Data client for CRUD operations
- **Auth**: Requires authenticated user for protected operations
- **Real-time**: Supports subscriptions via observeQuery

### Patterns Used

- **Hooks Pattern**: Business logic encapsulated in custom hooks
- **Component Composition**: UI built from composable components
- **Type Safety**: Full TypeScript with inferred Amplify types

## Integration Points

### Dependencies

This module depends on:

- `aws-amplify/data` - Amplify Data client for API operations
- `@aws-amplify/ui-react` - UI components (if used)

### Used By

This module is used by:

- `{{consumer-1}}` - {{How it's used}}
- `{{consumer-2}}` - {{How it's used}}

## Best Practices

1. **Always handle loading and error states** - Use the hook's return values
2. **Clean up subscriptions** - Always unsubscribe in useEffect cleanup
3. **Use TypeScript types** - Import types from Amplify schema
4. **Test with Storybook** - Create stories for all component states

### Common Pitfalls

- **Forgetting to unsubscribe** - Always return cleanup function from useEffect
- **Not handling errors** - Always destructure `errors` from Amplify responses
- **Missing authorization** - Ensure schema has proper auth rules

## Performance Considerations

- **Memoization** - Use useMemo/useCallback for expensive operations
- **Pagination** - Use nextToken for large datasets
- **Subscriptions** - Limit to necessary data to reduce bandwidth

## Security Considerations

- **Authorization** - All data access controlled by Amplify auth rules
- **Input validation** - Validate user input before API calls
- **No sensitive data in logs** - Avoid logging PII or credentials

## Troubleshooting

### {{Issue 1}}

**Problem:** {{Description of the problem}}

**Solution:** {{How to fix it}}

```typescript
// Code to resolve
{{solution-code}}
```

### {{Issue 2}}

**Problem:** {{Description}}

**Solution:** {{How to fix it}}

## Related Documentation

- [Pipe Platform README](/README.md)
- [AWS Amplify Gen 2 Docs](https://docs.amplify.aws)
- [Technical Specification](/docs/specs/{{spec-name}}.md)

## FAQ

**Q: {{Question}}**

A: {{Answer}}

**Q: {{Another question}}**

A: {{Answer}}

---

For more information about the Pipe platform, see the [main repository README](/README.md).
