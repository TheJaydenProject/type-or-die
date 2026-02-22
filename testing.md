# Testing

## Load Test

Simulates 16 players joining a room and typing at ~140 WPM, with random disconnects injected every 5 seconds.

### Run (PowerShell)

```powershell
cd load-tests
$env:TARGET_URL="http://localhost:4900"; npx ts-node loadtest.ts
```

> Change `4900` to whatever port your backend is running on. For local Docker it is `4900`. You can check with `docker ps`.

Make sure Docker is running first: `docker compose -f docker-compose.local.yml up -d`

### Reading the output

Every 5 seconds:
```
[Telemetry] Emitted: 1200 | Acked: 1198 | Reconnects: 3 | Errors: 0
```

On finish:
```
[DONE] Game ended. Reason: COMPLETION | Winner: <playerId>
[Final Telemetry] Emitted: 4800 | Acked: 4791 | Reconnects: 12 | Errors: 2
```

### Pass criteria

- Game ends with `Reason: COMPLETION`
- Acked / Emitted ratio > 95%
- Errors = 0
- Backend still running: `docker ps`

### Config (top of `loadtest.ts`)

| Constant | Default | Description |
|---|---|---|
| `NUM_PLAYERS` | `16` | Simulated players |
| `EMITS_PER_SECOND` | `12` | Typing speed (~140 WPM) |
| `MISTYPE_RATE` | `0.01` | 1% intentional mistypes |
