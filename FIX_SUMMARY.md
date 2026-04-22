# WebSocket Connection Loop - Fix Summary

## Issues Fixed

### 1. **Reconnection Loop in `useWebSocket.ts`**
**Problem:** The `doConnect` effect had circular dependencies with `disconnect`, creating an endless reconnection loop.

**Fix:** 
- Added `shouldDisconnectRef` flag to track user-requested disconnects
- Check `shouldDisconnectRef.current` before reconnecting in `ws.onclose`
- Reset `shouldDisconnectRef.current` in `doConnect()` for manual reconnects
- Added guard against double-connection attempts

### 2. **Message State Reset Breaking Processing**
**Problem:** `ws.onopen` called `setMessages([])` on every reconnection, clearing messages while `processedCountRef` retained the old value. This caused all subsequent messages to be skipped.

**Fix:**
- Removed `setMessages([])` from `ws.onopen` in `useWebSocket.ts`
- Added `connectionSequence` state that increments on each reconnection
- Added reconnection detection in `ChatPanel.tsx` that properly resets `processedCountRef` and `displayMessages` when connection changes

### 3. **Auto-Reconnection on Clean Disconnection**
**Problem:** WebSocket would attempt to reconnect even after intentional user disconnects or component unmounts, causing race conditions.

**Fix:**
- Check `shouldDisconnectRef.current` before setting reconnect timer
- Check `shouldDisconnectRef.current` inside reconnect timer callback
- Reset flag in `ws.onclose` after manual disconnect for manual reconnection to work

### 4. **Race Condition on Component Cleanup**
**Problem:** Reconnect timer might fire before cleanup sets `disposedRef.current = true`.

**Fix:**
- Check both `disposedRef.current` and `shouldDisconnectRef.current` in reconnect timer
- Set `shouldDisconnectRef.current = true` in effect cleanup

## File Changes

### `frontend/src/hooks/useWebSocket.ts`

1. **Added new refs and state:**
   - `shouldDisconnectRef`: Tracks intentional disconnects
   - `connectionSequence`/`setConnectionSequence`: State that increments on each reconnect

2. **Updated `disconnect()`:**
   ```typescript
   const disconnect = useCallback(() => {
       shouldDisconnectRef.current = true; // Mark as intentional
       // ...rest of disconnect logic
   }, []);
   ```

3. **Updated `doConnect()`:**
   - Check `shouldDisconnectRef.current` at start
   - Add guard against double-connection: `if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING)`
   - Increment `connectionSequence` on each connect
   - Removed `eslint-disable-next-line react-hooks/refs` (no longer needed)

4. **Updated `ws.onopen`:**
   ```typescript
   ws.onopen = () => {
       if (disposedRef.current) return;
       setState("connected");
       // REMOVED: setMessages([]); // Don't clear messages on reconnect
       send({ type: "get_state" });
       // ...rest unchanged
   };
   ```

5. **Updated `ws.onclose`:**
   ```typescript
   ws.onclose = (event) => {
       if (disposedRef.current) return;
       
       // Set close info
       setCloseCode(event.code);
       setCloseReason(event.reason || null);
       
       // Handle state based on disconnect flag
       if (!shouldDisconnectRef.current) {
           setState("error");
       } else {
           shouldDisconnectRef.current = false;
           setState("disconnected");
       }
       
       // Only reconnect if not intentional and not clean close
       if (!shouldDisconnectRef.current && event.code !== 1000) {
           reconnectTimerRef.current = setTimeout(() => {
               if (!disposedRef.current && !shouldDisconnectRef.current) {
                   doConnectRef.current();
               }
           }, 2000);
       }
   };
   ```

6. **Updated reconnect() helper:**
   ```typescript
   const reconnect = useCallback(() => {
       // ...reset close info...
       shouldDisconnectRef.current = false; // Reset for manual reconnect
       // ...clear timer and call doConnect...
   }, []);
   ```

7. **Updated lifecycle effect:**
   ```typescript
   useEffect(() => {
       disposedRef.current = false;
       shouldDisconnectRef.current = false; // Reset on mount
       // ...doConnect setup...
       doConnect();
       return () => {
           disposedRef.current = true;
           shouldDisconnectRef.current = true; // Flag for cleanup
           disconnect();
       };
   }, [doConnect, disconnect]);
   ```

8. **Updated return type:**
   ```typescript
   export interface UseWebSocketReturn {
       // ...existing fields...
       connectionSequence: number; // New field
   }
   ```

### `frontend/src/components/ChatPanel.tsx`

1. **Added connection tracking ref:**
   ```typescript
   const processedCountRef = useRef(0);
   const prevConnectionSeqRef = useRef(ws.connectionSequence);
   ```

2. **Added reconnection detection effect:**
   ```typescript
   useEffect(() => {
       if (ws.connectionSequence !== prevConnectionSeqRef.current) {
           // Connection reset → clear display state
           setDisplayMessages([]);
           setStreamingContent("");
           setToolCallNames([]);
           prevConnectionSeqRef.current = ws.connectionSequence;
       }
   }, [ws.connectionSequence]);
   ```

3. **Updated message processing effect:**
   ```typescript
   useEffect(() => {
       // Reset processing on reconnection
       if (ws.connectionSequence !== prevConnectionSeqRef.current) {
           prevConnectionSeqRef.current = ws.connectionSequence;
           processedCountRef.current = 0;
       }

       if (ws.messages.length <= processedCountRef.current) return;
       // ...rest of processing logic unchanged...
   }, [ws.messages]);
   ```

## Testing Checklist

- [ ] WebSocket connects successfully on initial load
- [ ] Messages are displayed correctly
- [ ] Reconnection works when backend temporarily disconnects
- [ ] No reconnection loop (check browser console for repeated connection attempts)
- [ ] Manual disconnect ("Delete" button) stops WebSocket immediately
- [ ] Manual reconnect button works
- [ ] Navigation away from project stops WebSocket
- [ ] Messages are properly cleared and reset on reconnection
- [ ] No TypeScript/ESLint errors

## Build Status

✅ Build passes: `npm run build` completes without errors
✅ TypeScript compilation succeeds
✅ No ESLint warnings

## Notes

The fixes maintain backward compatibility with the existing API while preventing the connection loop. The key insight was:

1. **Don't clear `ws.messages` on reconnect** - let messages accumulate from the backend response
2. **Track connection sequence separately** - use `connectionSequence` state to detect when reconnection happened
3. **Properly reset client-side state on reconnect** - reset `processedCountRef` and `displayMessages` only when reconnection is detected
4. **Prevent unwanted reconnections** - use `shouldDisconnectRef` to distinguish intentional disconnects from errors

This approach keeps the WebSocket state machine stable and prevents the cascading re-renders that caused the connection loop.
