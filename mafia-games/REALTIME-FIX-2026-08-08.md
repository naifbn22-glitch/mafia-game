# Realtime synchronization fix

- Replaced SSE/local room synchronization with Socket.IO rooms.
- Host, player, and public live views subscribe to isolated realtime channels.
- Realtime UI listeners are persistent for the lifetime of the current room view rather than firing once.
- UI refreshes are coalesced with requestAnimationFrame to prevent duplicate redraws during bursts of events.
- Automatic Socket.IO reconnection resubscribes host/player/public views after connection loss.
- Server is authoritative for room creation, role distribution, role reveal, night targets, and action confirmation.
- Host receives private administrative projections. Public live view never receives secret role identities.
- Investigator result masks king and nurse as citizen according to the game rule.
- Redis adapter and PostgreSQL persistence hooks remain optional through REDIS_URL and DATABASE_URL.
