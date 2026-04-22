# Fix for Double WebSocket Connection Issue

## Problem Summary

The workspace was making a second connection to the session WebSocket. This occurred due to:

### Root Cause: React 18 StrictMode

In `frontend/src/main.tsx`, the application is wrapped in `StrictMode`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**React 18's StrictMode intentionally mounts components twice in development mode** to help detect side effects. This causes the `useEffect` hook in `useWebSocket` to run twice, attempting to create two WebSocket connections.

## The Fix

Added a check to prevent creating a duplicate connection when a WebSocket is already in the `OPEN` state:

**File: `frontend/src/hooks/useWebSocket.ts`**

**Before:**
```typescript
// Prevent double connection attempts
if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
    return;
}
```

**After:**
```typescript
// Prevent double connection attempts (StrictMode mounts twice in dev)
if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
    // Already connecting, don't create another one
    return;
}
if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
    // Already connected, don't create a duplicate connection
    return;
}
```

## WebSocket Ready States

- `WebSocket.CONNECTING (0)` - Connection is being established
- `WebSocket.OPEN (1)` - Connection is open and ready to communicate ✅ **Now checked**
- `WebSocket.CLOSING (2)` - Connection is closing
- `WebSocket.CLOSED (3)` - Connection is closed or couldn't be opened

## Impact

- **Development mode**: Prevents duplicate WebSocket connections when React StrictMode double-mounts components
- **Production mode**: Provides an additional safety check against accidental duplicate connections
- **User experience**: No change visible to users, but removes unnecessary network traffic and potential backend session issues

## Testing

To verify the fix works:

1. Start the development server
2. Open the application and navigate to a workspace
3. Check your browser's Network tab - should see only ONE WebSocket connection
4. Check browser console - should not see duplicate connection attempts
5. Verify backend logs don't show duplicate session creations

## Additional Notes

The existing code already had proper checks to prevent reconnection while a WebSocket is being recreated. This fix simply adds the missing check for already-established connections, which was the exact scenario caused by StrictMode's double mounting behavior.
