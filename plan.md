# Type or Die - COMPLETE MASTER BLUEPRINT

## 🎯 GAME OVERVIEW

**Core Concept**: Multiplayer typing accuracy game where mistakes trigger escalating Russian Roulette with permanent risk progression.

**Win Condition Priority**:
1. Most sentences completed
2. If tied: Most correct characters typed total

**Platform**: Desktop-only (keyboard + mouse), English characters only

**UI**
proper brutal, terminal-style horror UI. No gradients, no fancy effects, just pure tension 

---

## 📊 COMPLETE SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                          │
├─────────────────────────────────────────────────────────┤
│  • React UI Components                                   │
│  • Socket.io Client                                      │
│  • Local State Management (Zustand/Redux)               │
│  • Audio/Visual Feedback System                          │
│  • Analytics Event Tracking (Admin-only)                │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 REAL-TIME LAYER                          │
├─────────────────────────────────────────────────────────┤
│  • Socket.io Server (Node.js/Express)                   │
│  • Room Management System                                │
│  • Player State Synchronization                          │
│  • Event Broadcasting Engine                             │
│  • IP Rate Limiting Middleware                           │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   CACHE LAYER (Redis)                    │
├─────────────────────────────────────────────────────────┤
│  • Active Room States (TTL: 24h)                        │
│  • Player Session Data                                   │
│  • IP Address Tracking (room creation limits)           │
│  • Socket.io Adapter (multi-server coordination)        │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   DATA LAYER                             │
├─────────────────────────────────────────────────────────┤
│  • Sentence Pool Database (100K sentences)              │
│  • User Accounts (Optional - Email/Password)            │
│  • Global Leaderboard Storage                            │
│  • Room History & Replay Data                            │
│  • Analytics Data (Admin-only access)                    │
└─────────────────────────────────────────────────────────┘
```

---

## 🗂️ COMPLETE DATA STRUCTURES

### **Room Object (Stored in Redis)**
```javascript
Room {
  roomCode: string (6-char alphanumeric, uppercase)
  hostId: string (socket.id or userId)
  creatorIP: string (hashed for privacy)
  status: "LOBBY" | "COUNTDOWN" | "PLAYING" | "FINISHED"
  settings: {
    sentenceCount: 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100
    timePerSentence: 20 (seconds, fixed for now)
  }
  sentences: Array<string> (randomly selected at game start)
  players: Map<playerId, PlayerState>
  spectators: Array<playerId>
  createdAt: timestamp
  gameStartedAt: timestamp | null
  lastActivity: timestamp (for cleanup)
  ttl: 86400 (24 hours in seconds)
}
```

### **PlayerState Object**
```javascript
PlayerState {
  id: string (UUID)
  nickname: string (max 20 chars, alphanumeric + spaces, no emojis)
  isGuest: boolean
  socketId: string
  ipAddress: string (hashed)
  
  // Game State
  status: "ALIVE" | "DEAD" | "SPECTATING" | "DISCONNECTED"
  currentSentenceIndex: number (0-99)
  rouletteOdds: 6 | 5 | 4 | 3 | 2 (denominator, NEVER goes to 1)
  
  // Progress Tracking
  completedSentences: number
  totalCorrectChars: number
  totalTypedChars: number
  totalMistypes: number
  
  // Current Sentence State
  currentCharIndex: number
  sentenceStartTime: timestamp | null
  remainingTime: number (seconds)
  
  // Disconnect Handling
  disconnectedAt: timestamp | null
  gracePeriodActive: boolean
  pausedTime: number (seconds remaining when DC'd)
  
  // History
  rouletteHistory: Array<{
    sentenceIndex: number,
    odds: string (e.g., "1/5"),
    survived: boolean,
    timestamp: timestamp
  }>
  
  sentenceHistory: Array<{
    sentenceIndex: number,
    completed: boolean,
    timeUsed: number,
    accuracy: number,
    deathReason: "TIMEOUT" | "MISTYPE" | null,
    wpm: number
  }>
  
  // Performance Metrics
  averageWPM: number
  peakWPM: number
  currentSessionWPM: number
}
```

### **User Account (Optional)**
```javascript
User {
  userId: string (UUID)
  email: string (unique, validated)
  passwordHash: string (bcrypt)
  nickname: string (default, can change)
  createdAt: timestamp
  lastLogin: timestamp
  stats: {
    gamesPlayed: number
    gamesWon: number
    totalSentencesCompleted: number
    bestAccuracy: number
    longestStreak: number
    totalPlayTime: number (minutes)
    averageWPM: number
  }
}
```

### **Leaderboard Entry**
```javascript
LeaderboardEntry {
  rank: number
  playerId: string
  nickname: string
  isGuest: boolean
  score: {
    completedSentences: number
    totalCorrectChars: number
    accuracy: number
    averageWPM: number
  }
  timestamp: timestamp
  roomCode: string
  gameSettings: {
    sentenceCount: number
  }
}
```

### **Analytics Event (Admin-only)**
```javascript
AnalyticsEvent {
  eventId: UUID
  eventType: "GAME_STARTED" | "GAME_ENDED" | "PLAYER_DIED" | "SENTENCE_COMPLETED" | "ROOM_CREATED" | "PLAYER_JOINED" | "DISCONNECT" | "RECONNECT" | "ROULETTE_TRIGGERED"
  timestamp: timestamp
  roomCode: string
  playerId: string | null
  metadata: {
    sentenceIndex?: number
    rouletteOdds?: string
    rouletteSurvived?: boolean
    wpm?: number
    accuracy?: number
    deathCause?: string
    sentenceText?: string
  }
  sessionId: string
}
```

---

## 🎮 COMPLETE GAME FLOW STATE MACHINE

### **Phase 1: LOBBY**

**Entry Conditions**: Room created OR player joins existing room

**Available Actions**:
- **Host**: 
  - Change sentence count (10-100 in steps of 10) via slider
  - Transfer host to another player (dropdown menu)
  - Start game (minimum 1 player required)
- **All Players**: Join/Leave, Chat (optional feature for post-MVP)
- **Display**: Room code (large, bold, clickable to copy), Current settings, Player list with host indicator (crown icon), "Waiting for host to start..." message

**Exit Condition**: Host clicks "Start Game"

**Transition**: → COUNTDOWN

**Analytics Tracked**: `ROOM_CREATED`, `PLAYER_JOINED` per join, Lobby duration

---

### **Phase 2: COUNTDOWN**

**Duration**: 3 seconds

**Actions**:
- Display: Large centered countdown "3... 2... 1... GO!" with scale animation
- Lock room (new joiners become spectators automatically)
- Initialize all player states: `status = ALIVE`, `currentSentenceIndex = 0`, `rouletteOdds = 6`, `completedSentences = 0`, All counters reset to 0
- Randomly select N sentences from pool (N = room.settings.sentenceCount)
- Validate sentence selection (no duplicates, all 5-10 words)
- Broadcast sentence pool to all clients
- Prepare first sentence for display

**Exit Condition**: Countdown reaches 0

**Transition**: → PLAYING

**Analytics Tracked**: `GAME_STARTED` event with room settings

---

### **Phase 3: PLAYING - Complete Logic Flow**

```
START SENTENCE
  ↓
Initialize 20-second timer
Record sentenceStartTime = now()
Display sentence (greyed out overlay)
Focus typing capture area
  ↓
Player types character
  ↓
┌─────────────────────────────────────────────────────────┐
│ WPM Check: Calculate instantaneous WPM                  │
│ Formula: (characters_typed / 5) / (time_elapsed_mins)   │
│ If WPM > 200 → Flag as suspicious (analytics only)      │
└─────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────┐
│ Character matches expected index?                        │
└─────────────────────────────────────────────────────────┘
  ├─ YES → Increment currentCharIndex
  │         Update UI (fill in character - white/green)
  │         Broadcast progress to all players
  │         Update live leaderboard
  │         Increment totalCorrectChars
  │         ↓
  │       ┌─────────────────────────────────────────────┐
  │       │ All characters in sentence typed?           │
  │       └─────────────────────────────────────────────┘
  │         ├─ YES → SENTENCE COMPLETED
  │         │         ↓
  │         │       Calculate metrics:
  │         │       - timeUsed = now() - sentenceStartTime
  │         │       - accuracy = 100% (no mistypes)
  │         │       - wpm = (charCount / 5) / (timeUsed / 60)
  │         │         ↓
  │         │       Increment completedSentences
  │         │       Update sentenceHistory
  │         │       Broadcast SENTENCE_COMPLETED event
  │         │       Play success sound/animation (brief)
  │         │         ↓
  │         │       ┌─────────────────────────────────┐
  │         │       │ Check win condition             │
  │         │       └─────────────────────────────────┘
  │         │         ├─ completedSentences == total?
  │         │         │   → GAME WON
  │         │         │   → Broadcast GAME_ENDED
  │         │         │   → Transition to FINISHED
  │         │         │
  │         │         └─ No → Move to next sentence
  │         │                 currentSentenceIndex++
  │         │                 currentCharIndex = 0
  │         │                 Reset timer to 20s
  │         │                 Display next sentence
  │         │
  │         └─ NO → Continue typing loop
  │
  └─ NO → MISTYPE DETECTED
            ↓
          Increment totalMistypes
          Increment totalTypedChars (even wrong ones)
          Visual feedback (red flash on wrong char)
          Audio feedback (error beep)
            ↓
          ════════════════════════════════════════
                    TRIGGER ROULETTE
          ════════════════════════════════════════
            ↓
          Save current state before roulette
          Pause timer (freeze remainingTime)
          Display roulette overlay (darken screen)
            ↓
          ┌─────────────────────────────────────┐
          │ SERVER GENERATES RANDOM NUMBER      │
          │ Range: 1 to rouletteOdds           │
          │ Method: crypto.randomInt(1, X+1)    │
          │ Log to analytics for verification   │
          └─────────────────────────────────────┘
            ↓
          Show spinning animation (1-2s)
          Display current odds: "ROLLING... 1/X"
            ↓
          ┌─────────────────────────────────────┐
          │ Roll Result                          │
          └─────────────────────────────────────┘
            ├─ Roll == 1 → PLAYER DIES
            │                ↓
            │              status = DEAD
            │              Stop timer permanently
            │              Freeze score
            │              Record death in sentenceHistory:
            │                - deathReason = "MISTYPE"
            │                - sentenceIndex = current
            │                - timeUsed = elapsed time
            │              Broadcast PLAYER_DIED event
            │              Display death screen:
            │                - "BANG! You're out." (red screen flash)
            │                - Skull animation
            │                - Final score display
            │              Track analytics: PLAYER_DIED event
            │                ↓
            │              Transition to spectator mode:
            │                - Can still type (for practice/fun)
            │                - Typing doesn't update score
            │                - Can click leaderboard to spectate others
            │                - UI shows "SPECTATING" banner
            │
            └─ Roll > 1 → SURVIVED
                           ↓
                         Green flash: "CLICK! You survived."
                         Display next odds: "1/X → 1/(X-1)"
                         Update rouletteOdds:
                           - If odds == 6 → 5
                           - If odds == 5 → 4
                           - If odds == 4 → 3
                           - If odds == 3 → 2
                           - If odds == 2 → STAYS AT 2 (HARD CAP)
                         Record survival in rouletteHistory
                         Broadcast ROULETTE_RESULT (survived=true)
                         Track analytics: ROULETTE_TRIGGERED event
                           ↓
                         Reset for retry:
                           - currentCharIndex = 0
                           - Clear any typed characters in UI
                           - Reset timer to 20s
                           - Resume timer countdown
                           - Return to typing loop for SAME sentence

PARALLEL PROCESS: Timer Countdown Thread
  ↓
Every 100ms:
  Update remainingTime -= 0.1
  Broadcast timer sync to spectators
  Update UI timer display
    ↓
  ┌─────────────────────────────────────────┐
  │ remainingTime < 5 seconds?              │
  └─────────────────────────────────────────┘
    └─ YES → Change timer color to red
             Add pulsing animation
             Play warning sound (optional)
    ↓
  ┌─────────────────────────────────────────┐
  │ remainingTime <= 0?                     │
  └─────────────────────────────────────────┘
    └─ YES → TIMEOUT EVENT
               ↓
             TRIGGER ROULETTE (same logic as mistype)
             deathReason = "TIMEOUT" (if dies)
             sentenceHistory records incomplete sentence
```

**Game End Conditions**:
1. **All players dead**: `players.filter(p => p.status === "ALIVE").length === 0` → Winner = highest completedSentences, tiebreaker = totalCorrectChars
2. **Player completes all sentences**: `player.completedSentences === room.settings.sentenceCount` → Immediate win, game ends for everyone
3. **Manual end** (future feature): Host clicks "End Game" button, requires confirmation, only available after 5+ minutes or 50%+ sentences done

**Transition**: → FINISHED

**Analytics Tracked**: `SENTENCE_COMPLETED`, `ROULETTE_TRIGGERED`, `PLAYER_DIED`, `DISCONNECT`/`RECONNECT`, WPM suspicious activity flags (>200 WPM)

---

### **Phase 4: FINISHED**

**Display Components** (Tabbed Interface):

#### **Tab 1: Final Leaderboard** (Default View)
```
┌─────────────────────────────────────────────────────────┐
│                    GAME OVER                             │
│                                                          │
│  🏆 WINNER: PlayerName (42/50 sentences)                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Rank │ Player    │ Sentences │ Accuracy │ WPM     │ │
│  ├──────┼───────────┼───────────┼──────────┼─────────┤ │
│  │  1🥇 │ PlayerA   │   42/50   │  98.5%   │  145    │ │
│  │  2🥈 │ You       │   38/50   │  96.2%   │  132    │ │
│  │  3🥉 │ PlayerB   │   38/50   │  95.1%   │  128    │ │
│  │  4   │ PlayerC💀 │   15/50   │  92.0%   │  110    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Room Code: ABC123  |  50 Sentences  |  20s/sentence   │
└─────────────────────────────────────────────────────────┘
```

**Sorting Logic**:
1. Alive players first (by sentences DESC, then totalCorrectChars DESC)
2. Dead players second (same sorting)
3. Spectators last (if any)

#### **Tab 2: Your Detailed Stats**
```
Personal Performance Summary
─────────────────────────────
Sentences Completed:     38/50
Total Time Played:       14m 32s
Average WPM:             132
Peak WPM:                187 (Sentence #12)
Overall Accuracy:        96.2%
Total Characters:        2,145 correct / 2,230 typed

Roulette Stats:
  Times Triggered:       4
  Times Survived:        4
  Current Odds:          1/2 (Most Dangerous!)
  Luckiest Moment:       Survived 1/2 on Sentence #35

Best Sentence:          "The moon shines bright tonight" (15s, 100%, 165 WPM)
Worst Sentence:         "Quick jumps over lazy dogs" (19s, 89%, 95 WPM)
```

#### **Tab 3: Roulette History**
```
Visual Timeline (Horizontal Graph)

Sentence #:  0────10────20────30────40────50
              │     │     │  🎲 │  🎲│🎲🎲│
Odds:              1/6   1/5 1/4 1/3 1/2

Legend:
  🎲 = Roulette triggered + survived
  💀 = Roulette triggered + died

Detailed Log:
┌─────────────────────────────────────────────────────┐
│ Sentence #12  │  1/6  │  Survived ✓  │  Mistype    │
│ Sentence #27  │  1/5  │  Survived ✓  │  Timeout    │
│ Sentence #33  │  1/4  │  Survived ✓  │  Mistype    │
│ Sentence #38  │  1/3  │  Survived ✓  │  Mistype    │
└─────────────────────────────────────────────────────┘
```

#### **Tab 4: Sentence Breakdown**
```
Scrollable Table (All 50 sentences)

┌──────┬────────────────────────────┬──────┬──────────┬─────┬────────┐
│  #   │ Sentence                   │ Time │ Accuracy │ WPM │ Result │
├──────┼────────────────────────────┼──────┼──────────┼─────┼────────┤
│  1   │ The sky is blue today      │ 12s  │  100%    │ 150 │   ✓    │
│  2   │ Coffee tastes good hot     │ 15s  │  100%    │ 128 │   ✓    │
│ ...  │ ...                        │ ...  │  ...     │ ... │  ...   │
│ 12   │ Fast cars zoom past        │ 18s  │   95%    │ 110 │ 🎲 1/6 │
│ ...  │ ...                        │ ...  │  ...     │ ... │  ...   │
│ 39   │ Not attempted (died)       │  -   │    -     │  -  │   💀   │
│ 40   │ Not attempted              │  -   │    -     │  -  │   -    │
└──────┴────────────────────────────┴──────┴──────────┴─────┴────────┘

Color Coding:
  Green row = 100% accuracy
  Yellow row = 90-99% accuracy
  Red row = <90% or timeout
  Grey row = Not attempted
```

#### **Tab 5: Room Stats**
```
Game Summary
─────────────────────────────
Total Players:           4
Survivors:               3
Casualties:              1
Total Sentences Typed:   163 (combined)
Average Completion:      40.75/50
Fastest Player:          PlayerA (145 WPM avg)
Most Accurate:           You (96.2%)
Most Dangerous:          Sentence #27 "Quick brown fox..." (3 deaths)
Luckiest Player:         PlayerB (5 roulette survivals)

Game Duration:           18m 45s
Started:                 2:30 PM
Ended:                   2:49 PM
```

**Action Buttons**:
```
┌─────────────────────────────────────────────────────────┐
│  [💾 Save to Leaderboard]  [🔄 Replay]  [📤 Share]     │
│                    [🏠 Main Menu]                        │
└─────────────────────────────────────────────────────────┘
```

**Button Actions**:
- **Save to Leaderboard**: Saves current game result to global leaderboard, only if registered user (prompts to sign up if guest), shows confirmation: "Saved! You rank #42 globally."
- **Replay**: Creates new room with same settings, copies all current players to new lobby, sends invites via notification, generates new room code
- **Share**: Copies shareable link: `finalsentence.gg/game/ABC123`, link shows read-only results page, social media share buttons
- **Main Menu**: Returns to home screen, room remains accessible for 24h for stats viewing

**Analytics Tracked**: `GAME_ENDED` event with full summary, button click events (replay rate, share rate), tab view analytics

---

## 🔄 COMPLETE REAL-TIME SYNCHRONIZATION

### **Socket Events Map**

#### **Client → Server**

| Event | Payload | Triggered When | Server Action | Response |
|-------|---------|----------------|---------------|----------|
| `create_room` | `{nickname, settings}` | Player clicks "Create Room" | Check IP limit (max 2/IP), Check global limit (max 100 active), Generate unique 6-char code, Hash IP and store, Initialize Room in Redis, Set TTL to 24h | `room_created` with code OR `error` |
| `join_room` | `{roomCode, nickname}` | Player enters code + clicks Join | Validate room. If LOBBY: Add to players. If PLAYING: Add to spectators. **Compute full room state immediately.** | `join_success` with **full room state** OR `join_failed` |
| `leave_room` | `{roomCode}` | Player closes tab/clicks Leave | Remove from room. If host: trigger host migration. If last player: mark for deletion. Update room in Redis. | `player_left` broadcast with **updated player list** |
| `change_settings` | `{roomCode, sentenceCount}` | Host adjusts slider | Verify sender is host, Validate sentenceCount (10-100, step 10), Update room.settings in Redis, Broadcast to all | `settings_updated` broadcast |
| `start_game` | `{roomCode}` | Host clicks "Start" | Verify host permissions, Validate ≥1 player, Change status to COUNTDOWN, Select random sentences, Initialize player states, Broadcast countdown | `countdown_start` with sentences |
| `char_typed` | `{roomCode, char, charIndex, timestamp}` | Every keystroke | Validate player ALIVE, Validate char matches sentence[charIndex], Calculate WPM (flag if >200), Update PlayerState, If match: increment, If mismatch: trigger roulette, If complete: handle completion, Broadcast progress | `char_validated` OR `roulette_trigger` OR `sentence_complete` |
| `request_spectate` | `{roomCode, targetPlayerId}` | Dead player clicks leaderboard name | Verify requester is DEAD/SPECTATOR, Validate target exists and ALIVE, Start streaming target state | `spectate_stream_start` with target state |
| `stop_spectate` | `{roomCode}` | Player clicks "Stop Spectating" | Stop streaming target state | `spectate_stream_end` |
| `reconnect_attempt` | `{roomCode, playerId, sessionToken}` | Player rejoins after DC | Validate player was in room, Check grace period (30s from DC), Restore PlayerState from Redis, If within grace: unpause timer, If after: apply timeout consequences, Broadcast reconnect | `reconnect_success` OR `reconnect_failed` |
| `heartbeat` | `{roomCode, playerId}` | Every 5 seconds | Update lastActivity timestamp | ACK |

#### **Server → Client**

| Event | Payload | Broadcast To | Purpose | Frequency |
|-------|---------|--------------|---------|-----------|
| `room_created` | `{roomCode, settings}` | Creator only | Confirm room creation, show code | Once per creation |
| `join_success` | `{room: Room, yourPlayerId}` | Joiner only | Load lobby UI with **complete initial state**; eliminates follow-up fetch | Once per join |
| `join_failed` | `{reason: string}` | Joiner only | Show error (room full, not found, etc.) | Once per failed join |
| `room_update` | `{players, settings, status}` | All in room | Sync lobby state. **Includes full player array** so clients never request it | On any state change |
| `player_left` | `{playerId, updatedPlayers}` | All in room | Remove from UI and **simultaneously sync remaining list** to prevent desync | On leave |
| `host_migrated` | `{newHostId, newHostNickname}` | All in room | Update UI to show new host | On migration |
| `settings_updated` | `{sentenceCount}` | All in room | Update settings display | On change |
| `countdown_start` | `{sentences: Array<string>, startTime}` | All players | Initialize game UI, load sentences | Once at start |
| `countdown_tick` | `{count: 3/2/1}` | All players | Update countdown display | Every 1s during countdown |
| `game_start` | `{firstSentence, gameStartTime}` | All players | Show first sentence, start timer | Once after countdown |
| `char_validated` | `{playerId, charIndex, isCorrect}` | All players | Update progress bar on leaderboard | Per keystroke |
| `player_progress` | `{playerId, charIndex, sentenceIndex, wpm}` | All players | Update live leaderboard position/bars | Every 5 chars or 1s |
| `roulette_trigger` | `{playerId, odds, reason}` | All players | Show roulette overlay for player | On mistype/timeout |
| `roulette_result` | `{playerId, survived, newOdds, roll}` | All players | Show result animation, update leaderboard | After RNG resolution |
| `player_died` | `{playerId, sentenceIndex, finalScore}` | All players | Show death animation, grey out on leaderboard, add 💀 | On death |
| `sentence_completed` | `{playerId, sentenceIndex, time, wpm}` | All players | Show celebration, update leaderboard | On completion |
| `player_disconnected` | `{playerId, gracePeriodEnd}` | All players | Show "DC" indicator on leaderboard | On DC detection |
| `player_reconnected` | `{playerId, resumedState}` | All players | Remove "DC" indicator, resume play | On reconnect |
| `timer_sync` | `{playerId, remainingTime}` | Spectators of this player | Keep spectator view timer in sync | Every 1s |
| `game_ended` | `{reason, finalStats, leaderboard}` | All in room | Transition to results screen | Once at end |
| `spectate_stream_start` | `{targetPlayerId, initialState}` | Requester only | Load spectate view UI | On spectate start |
| `spectate_stream` | `{charIndex, sentenceIndex, remainingTime}` | Spectators | Live update spectate view | Every 100ms |
| `error` | `{code, message}` | Relevant client(s) | Show error notification | As needed |

---

## 🎨 COMPLETE UI COMPONENT BREAKDOWN

### **Main Menu Screen**
```
┌───────────────────────────────────────────────────────┐
│                                                        │
│             ⚡ Type or Die ⚡                       │
│          Type Fast. Die Faster.                        │
│                                                        │
│    ┌──────────────────────────────────────────┐      │
│    │  [🎮 CREATE ROOM]                        │      │
│    └──────────────────────────────────────────┘      │
│                                                        │
│    ┌──────────────────────────────────────────┐      │
│    │  Room Code: [______]  [JOIN]             │      │
│    └──────────────────────────────────────────┘      │
│                                                        │
│    ┌──────────────────────────────────────────┐      │
│    │  📊 Global Leaderboard (Top 10)          │      │
│    │  1. ProTyper     - 100/100  99.8%        │      │
│    │  2. SpeedDemon   -  98/100  98.5%        │      │
│    │  ...                                      │      │
│    └──────────────────────────────────────────┘      │
│                                                        │
│    [🔐 Login / Register]  (optional)                  │
│                                                        │
│    Active Rooms: 47/100  |  Players Online: 234       │
└───────────────────────────────────────────────────────┘
```

**Components**:
- **Create Room Button**: Prompts for nickname (if not logged in), checks IP limit before creation, shows error if global room limit hit
- **Join Room Input**: Auto-uppercases input, validates format (6 alphanumeric), shows "Room not found" if invalid
- **Global Leaderboard Preview**: Top 10 all-time scores, click to view full leaderboard page, updates every 30s via polling
- **Login/Register** (collapsed by default): Email + password fields, "Continue as Guest" button prominent, links to forgot password, ToS

### **Lobby Screen**
```
┌───────────────────────────────────────────────────────┐
│  ← Back                    ROOM: ABC123   📋Copy      │
├───────────────────────────────────────────────────────┤
│                                                        │
│  GAME SETTINGS                                         │
│  ┌──────────────────────────────────────────┐         │
│  │  Sentences: [▓▓▓▓▓░░░░░] 50              │         │
│  │            10  20  30  40  50  60  70...  │         │
│  └──────────────────────────────────────────┘         │
│  (Only host can adjust)                                │
│                                                        │
│  PLAYERS (3/∞)                                         │
│  ┌──────────────────────────────────────────┐         │
│  │  👑 HostName         [Transfer Host ▼]   │         │
│  │  🧑 PlayerTwo                              │         │
│  │  🧑 You                                    │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  ┌──────────────────────────────────────────┐         │
│  │         [START GAME]                      │         │
│  │         (Host only)                        │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  [Leave Room]                                          │
└───────────────────────────────────────────────────────┘
```

**Interactions**:
- **Sentence Slider**: Disabled for non-hosts (greyed out), snaps to 10-increment intervals, shows number above slider
- **Player List**: Host has crown icon, host sees "Transfer Host" dropdown next to crown, players appear in join order
- **Start Button**: Only visible to host, disabled if 0 players (shouldn't happen but defensive), confirmation modal if >80 sentences selected
- **Room Code**: Large, bold, centered at top, click to copy to clipboard, shows "Copied!" tooltip on click

### **Countdown Screen**
```
┌───────────────────────────────────────────────────────┐
│                                                        │
│                                                        │
│                                                        │
│                      3                                 │
│                  (scale pulse)                         │
│                                                        │
│                                                        │
│                                                        │
│           Get ready to type...                         │
└───────────────────────────────────────────────────────┘
```

**Animation**: Number scales from 0.5x to 1.5x to 1x over 1 second, color shifts: 3=red, 2=yellow, 1=green, "GO!" text appears briefly before game screen

### **Game Screen**

```
┌───────────────────────────────────────────────────────────────────┐
│  Type or Die                              [?] [⚙️] [🚪Leave]  │
├─────────────────────────────┬─────────────────────────────────────┤
│                             │  LIVE LEADERBOARD                   │
│                             │  ┌────────────────────────────────┐ │
│   SENTENCE 13/50            │  │ 1. 👑 You                      │ │
│   ⏱️ 15s                     │  │    [████████░░] 13/50   1/4   │ │
│                             │  │    WPM: 142  ⚡                │ │
│                             │  │                                │ │
│                             │  │ 2. PlayerTwo                   │ │
│  The quick brown fox        │  │    [███████░░░] 12/50   1/6   │ │
│  jumps over                 │  │    WPM: 135  ⚡                │ │
│                             │  │                                │ │
│  The quick brown fox        │  │ 3. PlayerThree                 │ │
│  █████████████████░░        │  │    [█████░░░░░]  9/50   1/2   │ │
│  (Grey = untyped)           │  │    WPM: 118  ⚡                │ │
│  (White = correct)          │  │                                │ │
│                             │  │ 4. DeadGuy                     │ │
│                             │  │    [███░░░░░░░]  5/50   💀    │ │
│  [Invisible input capture]  │  │    WPM: 95  (Click to watch)   │ │
│                             │  └────────────────────────────────┘ │
│                             │                                     │
│                             │  Your Stats:                        │
│                             │  Accuracy: 96.5%                    │
│                             │  Correct: 1,245 chars               │
│                             │  Mistypes: 47                       │
└─────────────────────────────┴─────────────────────────────────────┘
```

**Typography**: Font: JetBrains Mono, 24px, Letter spacing: 1px for readability, Line height: 1.5

**Typing Area**: Two-layer rendering: Bottom layer: Full sentence in #666 grey, Top layer: Typed chars in #0F0 green (or #FFF white), Cursor blinks at current position, No visible input box (fullscreen keyboard capture), Wrong character shows red flash + red char briefly

**Leaderboard**: Progress bar shows sentence completion % visually, WPM updates every second, Roulette odds shown as fraction (1/6, 1/5, etc.) - turns orange at 1/3, turns red at 1/2, Dead players greyed out + 💀 icon, Disconnected players show 🔌 icon, Click dead/spectator names to spectate them

**Timer**: Large, top-right corner, Green >10s, Yellow 5-10s, Red <5s with pulse animation, Shows milliseconds in last 3 seconds

**Additional UI Elements**: Help (?): Hover tooltip with keyboard shortcuts, Settings (⚙️): Adjust volume, visual effects, Leave: Confirmation modal before leaving mid-game

### **Roulette Overlay**
```
┌───────────────────────────────────────────────────────┐
│                                                        │
│          [Dark overlay - 90% opacity black]           │
│                                                        │
│                  🎲 RUSSIAN ROULETTE                   │
│                                                        │
│                    Rolling... 1/4                      │
│                                                        │
│               [Spinning chamber animation]             │
│                  (Cylinder rotating)                   │
│                                                        │
│                                                        │
│              🔊 *click-click-click* sound              │
│                                                        │
└───────────────────────────────────────────────────────┘
```

**AFTER 1.5 SECONDS - SURVIVED**:
```
┌───────────────────────────────────────────────────────┐
│          [Green flash overlay - fade out]             │
│                                                        │
│                    ✓ CLICK!                            │
│                  You survived!                         │
│                                                        │
│                  Next odds: 1/3                        │
│                                                        │
│              🔊 *click* sound                          │
│          (Overlay fades out in 1s)                     │
└───────────────────────────────────────────────────────┘
```

**AFTER 1.5 SECONDS - DIED**:
```
┌───────────────────────────────────────────────────────┐
│          [Red flash overlay - stays longer]           │
│                                                        │
│                    💀 BANG!                            │
│                  You're out!                           │
│                                                        │
│              Final Score: 13/50                        │
│              Accuracy: 96.2%                           │
│                                                        │
│              🔊 *BANG* sound                           │
│                                                        │
│     [Entering spectator mode in 3 seconds...]         │
└───────────────────────────────────────────────────────┘
```

**Animations**: **Spinning Chamber**: SVG cylinder rotates 360° over 1.5s, easing: cubic-bezier for tension; **Result Flash**: Survived: Green (#00FF00) overlay, 0→50%→0% opacity over 0.5s, Died: Red (#FF0000) overlay, 0→70%→50% opacity, holds 2s; **Audio**: Rolling: Repetitive click (100ms interval), Survived: Single click (higher pitch), Died: Gunshot sound (bass-heavy)

### **Spectator View**
```
┌───────────────────────────────────────────────────────┐
│  🔍 SPECTATING: PlayerTwo                [Stop]       │
├───────────────────────────────────────────────────────┤
│                                                        │
│   SENTENCE 15/50                    ⏱️ 12s            │
│                                                        │
│   Bright sunny days are best                          │
│   ████████████████████░░░░░                           │
│                                                        │
│   (Live updating as they type)                        │
│                                                        │
│   PlayerTwo's Stats:                                   │
│   Current WPM: 138                                     │
│   Accuracy: 97.2%                                      │
│   Roulette Odds: 1/5                                   │
│                                                        │
├───────────────────────────────────────────────────────┤
│  [Your score remains frozen while spectating]         │
│  [You can still type for practice - no points]        │
└───────────────────────────────────────────────────────┘
```

**Features**: Identical typing area to main game screen, shows target player's progress in real-time, can switch to another player via leaderboard, dead players can practice typing (greyed out UI indicator)

---

## 🛡️ COMPLETE EDGE CASE HANDLING

### **Disconnect Scenarios**

#### **Scenario 1: Player Disconnects During Typing**
```
T=0s    Player typing sentence #10, 15s remaining
T=5s    Connection drops (network issue)
        ↓
        Server detects disconnect (heartbeat timeout)
        ↓
        Server Actions:
        - Set player.status = "DISCONNECTED"
        - Set player.disconnectedAt = now()
        - Pause player's timer: player.pausedTime = 15s
        - Set player.gracePeriodActive = true
        - Start 30s grace period timer
        - Broadcast PLAYER_DISCONNECTED to all
        ↓
        Client UI (for all players):
        - Leaderboard shows "🔌 PlayerName (DC)"
        - Timer shows "PAUSED" for that player
        - Progress bar greyed out
        
T=20s   Player reconnects (within grace period)
        ↓
        Client sends RECONNECT_ATTEMPT with sessionToken
        ↓
        Server validates:
        - Token matches player ID ✓
        - Grace period still active ✓ (10s remaining)
        - Room still exists ✓
        ↓
        Server Actions:
        - Restore player.status = "ALIVE"
        - Clear player.disconnectedAt
        - Resume timer: player.remainingTime = 15s
        - Set player.gracePeriodActive = false
        - Broadcast PLAYER_RECONNECTED to all
        ↓
        Client UI:
        - Remove "DC" indicator
        - Resume timer from 15s
        - Enable typing input
        - Show "Welcome back!" toast
```

#### **Scenario 2: Grace Period Expires**
```
T=0s    Player disconnects, 15s remaining on sentence
T=30s   Grace period expires, player still offline
        ↓
        Server Actions:
        - Resume timer countdown automatically
        - player.remainingTime starts decrementing
        
T=45s   Timer reaches 0 (15s after grace expired)
        ↓
        Server treats as TIMEOUT:
        - Trigger ROULETTE with reason="TIMEOUT"
        - Roll RNG (1 to player.rouletteOdds)
        - If dies: Set status="DEAD"
        - If survives: Decrease odds, reset sentence
        - Update player.sentenceHistory
        - Broadcast result to all
        
T=50s   Player reconnects (too late)
        ↓
        Server validates:
        - Token matches ✓
        - Grace period expired ✗
        - Player may be DEAD or ALIVE (depending on roulette)
        ↓
        Server Actions:
        - Restore player to current state (DEAD/ALIVE)
        - Send full game state sync
        - If DEAD: Auto-transition to spectator
        - Broadcast PLAYER_RECONNECTED
        ↓
        Client UI:
        - If ALIVE: Show "You survived! Now on sentence #10"
        - If DEAD: Show "You died from timeout. Spectating now."
```

#### **Scenario 3: Multiple Rapid Disconnects**
```
Player disconnects 3 times in 2 minutes
        ↓
        Server tracking (in Redis):
        {
          playerId: "abc123",
          disconnectCount: 3,
          lastDisconnect: timestamp,
          window: 120s
        }
        ↓
        If disconnectCount > 5 in 120s window:
        - Flag as suspicious (possible network attack)
        - Force DEAD status (no grace period)
        - Notify other players: "PlayerName removed due to connection issues"
        - Log to analytics
```

### **Host Migration Logic**

#### **Scenario 1: Host Leaves During LOBBY**
```
Room state:
  players: [Host, Player2, Player3]
  status: LOBBY
        ↓
Host clicks Leave / closes tab
        ↓
Server Actions:
1. Remove Host from room.players
2. Check: room.players.length > 0?
   ├─ YES → Select new host
   │         Algorithm: players[0] (first in list)
   │         Update room.hostId = Player2.id
   │         Broadcast HOST_MIGRATED event
   │         New host UI shows "Start Game" button
   │
   └─ NO  → Delete room from Redis
              Broadcast ROOM_CLOSED to any spectators
              End
```

#### **Scenario 2: Host Leaves During PLAYING**
```
Room state:
  players: [Host, Player2, Player3]
  status: PLAYING
        ↓
Host disconnects / leaves
        ↓
Server Actions:
1. Mark Host as DISCONNECTED (30s grace period)
2. Select temporary host:
   Algorithm:
   - Alive players first (by highest completedSentences)
   - If no alive players: dead players (by highest score)
   - If only spectators: spectators[0]
3. Update room.hostId = newHost.id
4. Broadcast HOST_MIGRATED
5. New host gets NO special powers mid-game
   (Can't change settings, can't kick, can't end game)
6. Original host can reclaim if reconnects within grace
        ↓
Original Host reconnects (T=20s)
        ↓
Server Actions:
- Restore Host to ALIVE status
- Check: Is current host different?
  ├─ YES → Offer host reclaim via modal
  │         "Reclaim host status? [Yes] [No]"
  │         If Yes: Broadcast HOST_MIGRATED back
  │
  └─ NO  → Continue as normal player
```

#### **Scenario 3: Host Dies, Then All Players Die**
```
Game state:
  Host = DEAD
  Player2 = DEAD
  Player3 = ALIVE (current host)
        ↓
Player3 dies (last alive)
        ↓
Server Actions:
1. Trigger GAME_ENDED event
2. Calculate final leaderboard
3. No host migration needed (game over)
4. Transition all to FINISHED phase
```

### **Race Conditions**

#### **Race 1: Two Players Complete Same Sentence Simultaneously**
```
T=10.000s  Player1 types last char of sentence #25
T=10.001s  Player2 types last char of sentence #25
           (Network latency causes near-simultaneous arrival)
        ↓
Server receives:
  Event1: {playerId: "p1", sentenceIndex: 25, timestamp: 10.000}
  Event2: {playerId: "p2", sentenceIndex: 25, timestamp: 10.001}
        ↓
Server logic:
1. Both events processed sequentially (Node.js single-threaded)
2. Event1 processed first:
   - p1.completedSentences = 25
   - p1.currentSentenceIndex = 26
   - Check: p1.completedSentences === room.sentenceCount?
     ├─ NO → Continue game
     
3. Event2 processed next:
   - p2.completedSentences = 25
   - p2.currentSentenceIndex = 26
   - Check: p2.completedSentences === room.sentenceCount?
     ├─ NO → Continue game
        ↓
No race condition - both advance normally
```

#### **Race 2: Player Completes Type or Die While Another Dies**
```
T=0s   Room.sentenceCount = 50
       Player1 on sentence 49, typing
       Player2 on sentence 50, typing
        ↓
T=5s   Player1 mistypes → triggers roulette
       Player2 completes sentence 50 (WINNER!)
        ↓
Server event queue:
  1. player1_roulette_trigger @ 5.000s
  2. player2_sentence_complete @ 5.002s
        ↓
Process event 1 (roulette):
  - Roll RNG for Player1
  - Result: DIED
  - Update player1.status = DEAD
  - Check: All players dead?
    └─ NO (Player2 still alive)
        ↓
Process event 2 (completion):
  - player2.completedSentences = 50
  - Check: 50 === room.sentenceCount?
    └─ YES → GAME WON!
  - Trigger GAME_ENDED
  - Winner = Player2
  - Broadcast to all (including dead Player1)
        ↓
Result: Player2 wins, Player1's death irrelevant
```

#### **Race 3: Client-Server Desync on Character Validation**
```
Client predicts character is correct
  → Updates UI optimistically (green character)
  → Sends char_typed event to server
        ↓
Server validates:
  → Actual character at index doesn't match!
  → Reason: Client had stale sentence data (cache issue)
        ↓
Server sends CORRECTION event:
  {
    playerId: "abc",
    correctedIndex: 15,
    expectedChar: "o",
    receivedChar: "p",
    action: "RESET"
  }
        ↓
Client receives correction:
  - Revert UI to grey at index 15
  - Show red flash
  - Trigger roulette overlay
  - Sync client state with server state
  - Resume typing from corrected position
```

### **Roulette RNG Security**

```javascript
// SERVER-SIDE ONLY (Never on client)

function triggerRoulette(player) {
  const odds = player.rouletteOdds; // 6, 5, 4, 3, or 2
  
  // Use crypto.randomInt for cryptographically secure randomness
  const roll = crypto.randomInt(1, odds + 1); // Range: [1, odds]
  
  // Log for audit trail (analytics)
  analytics.log({
    eventType: "ROULETTE_TRIGGERED",
    playerId: player.id,
    odds: `1/${odds}`,
    roll: roll,
    timestamp: Date.now(),
    seed: crypto.randomUUID() // Unique seed for this roll
  });
  
  const survived = (roll > 1);
  
  if (survived) {
    // Decrease odds (but never below 1/2)
    player.rouletteOdds = Math.max(2, odds - 1);
    
    // Update history
    player.rouletteHistory.push({
      sentenceIndex: player.currentSentenceIndex,
      odds: `1/${odds}`,
      survived: true,
      roll: roll,
      timestamp: Date.now()
    });
    
    // Broadcast result
    io.to(roomCode).emit("roulette_result", {
      playerId: player.id,
      survived: true,
      newOdds: `1/${player.rouletteOdds}`,
      roll: roll // Show to player for transparency
    });
    
  } else {
    // Player dies
    player.status = "DEAD";
    
    player.rouletteHistory.push({
      sentenceIndex: player.currentSentenceIndex,
      odds: `1/${odds}`,
      survived: false,
      roll: roll,
      timestamp: Date.now()
    });
    
    io.to(roomCode).emit("player_died", {
      playerId: player.id,
      sentenceIndex: player.currentSentenceIndex,
      finalScore: {
        sentences: player.completedSentences,
        correctChars: player.totalCorrectChars,
        accuracy: (player.totalCorrectChars / player.totalTypedChars) * 100
      },
      deathRoll: roll
    });
  }
  
  return survived;
}
```

**Anti-Cheat Measures**: Client never knows roll result before animation, server timestamp verification (can't fake completion times), audit log of every roll (can review for patterns), if player claims "unfair roll", admin can check logs

---

## 📦 SENTENCE POOL MANAGEMENT

### **Database Schema (PostgreSQL)**
```sql
CREATE TABLE sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text VARCHAR(100) NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count BETWEEN 5 AND 10),
  char_count INTEGER NOT NULL,
  language VARCHAR(10) DEFAULT 'en' CHECK (language = 'en'),
  contains_emoji BOOLEAN DEFAULT FALSE CHECK (contains_emoji = FALSE),
  difficulty VARCHAR(20) DEFAULT 'MEDIUM', -- Future feature
  tags TEXT[], -- Array of tags like ['casual', 'tech', 'modern']
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  death_rate FLOAT DEFAULT 0.0, -- Analytics: % of players who died on this sentence
  average_time FLOAT, -- Analytics: Avg time to complete (for difficulty calibration)
  CONSTRAINT unique_sentence UNIQUE(text)
);

-- Indexes for fast querying
CREATE INDEX idx_word_count ON sentences(word_count);
CREATE INDEX idx_active ON sentences(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_difficulty ON sentences(difficulty);
CREATE INDEX idx_death_rate ON sentences(death_rate); -- For analytics
```

### **Selection Algorithm (Server-Side)**
```javascript
async function selectSentences(roomSettings) {
  const count = roomSettings.sentenceCount;
  
  // Query pool with constraints
  const query = `
    SELECT id, text, word_count, char_count
    FROM sentences
    WHERE 
      is_active = TRUE
      AND language = 'en'
      AND contains_emoji = FALSE
      AND word_count BETWEEN 5 AND 10
    ORDER BY RANDOM()
    LIMIT $1
  `;
  
  const result = await db.query(query, [count]);
  
  // Validate we got enough
  if (result.rows.length < count) {
    throw new Error(`Insufficient sentences in pool. Need ${count}, got ${result.rows.length}`);
  }
  
  // Ensure no duplicates (shouldn't happen with UNIQUE constraint, but defensive)
  const uniqueSentences = [...new Set(result.rows.map(r => r.text))];
  
  if (uniqueSentences.length < count) {
    // Rare edge case: re-query
    return selectSentences(roomSettings);
  }
  
  // Log selection for analytics
  analytics.log({
    eventType: "SENTENCES_SELECTED",
    sentenceIds: result.rows.map(r => r.id),
    roomCode: roomCode,
    count: count
  });
  
  return result.rows.map(r => r.text);
}
```

### **Pool Curation Guidelines**

**Target Size**: 100,000 sentences

**Sources**:
1. **Modern Conversational** (40%): "The coffee tastes good hot", "Let me check that for you", "This idea sounds pretty cool"
2. **Pop Culture** (20%): "Winter is coming soon enough", "Just keep swimming forward always"
3. **Technical/Modern Terms** (20%): "Cloud storage saves your files", "Blockchain technology is emerging fast", "Machine learning models train data"
4. **Common Idioms** (10%): "Actions speak louder than words", "Time flies when having fun"
5. **Neutral Statements** (10%): "The sun rises every morning", "Water boils at high heat"

**Exclusion Criteria**:
- ❌ Offensive language (profanity, slurs)
- ❌ Political statements (controversial topics)
- ❌ Religious content (avoid offense)
- ❌ 15+ letter words ("antidisestablishmentarianism")
- ❌ Archaic terms ("thou", "whomsoever")
- ❌ Ambiguous punctuation (em-dashes, semicolons unless common)
- ❌ Emojis or special unicode
- ❌ Non-English characters (é, ñ, ü, etc.)
- ❌ Numbers spelled out ("twenty-three" vs "23" - allow both but be consistent)

**Validation Script**:
```javascript
function validateSentence(text) {
  const errors = [];
  
  // Word count check
  const words = text.trim().split(/\s+/);
  if (words.length < 5 || words.length > 10) {
    errors.push(`Word count ${words.length} not in range [5,10]`);
  }
  
  // Character count (for UI layout)
  if (text.length > 100) {
    errors.push(`Sentence too long: ${text.length} chars`);
  }
  
  // English only (simple check - no accents)
  if (!/^[a-zA-Z0-9\s.,!?'-]+$/.test(text)) {
    errors.push("Non-English characters detected");
  }
  
  // No emoji check
  const emojiRegex = /[\u{1F600}-\u{1F64F}]/u;
  if (emojiRegex.test(text)) {
    errors.push("Emoji detected");
  }
  
  // No super long words
  const maxWordLength = 15;
  const longWords = words.filter(w => w.length > maxWordLength);
  if (longWords.length > 0) {
    errors.push(`Words too long: ${longWords.join(', ')}`);
  }
  
  // Profanity filter (basic - use library like 'bad-words' for production)
  const badWords = ['fuck', 'shit', 'damn']; // Expand this list
  const hasProfanity = badWords.some(bad => text.toLowerCase().includes(bad));
  if (hasProfanity) {
    errors.push("Profanity detected");
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    wordCount: words.length,
    charCount: text.length
  };
}
```

### **Analytics on Sentence Performance**

```javascript
// After every player death
async function recordSentenceDeath(sentenceId, sentenceIndex, playerId) {
  // Increment death counter
  await db.query(`
    UPDATE sentences
    SET death_rate = death_rate + 1
    WHERE id = $1
  `, [sentenceId]);
  
  // Log for deep analytics
  analytics.log({
    eventType: "SENTENCE_DEATH",
    sentenceId: sentenceId,
    sentenceIndex: sentenceIndex,
    playerId: playerId,
    timestamp: Date.now()
  });
}

// Admin dashboard query: Top 10 deadliest sentences
SELECT text, death_rate, average_time
FROM sentences
WHERE death_rate > 0
ORDER BY death_rate DESC
LIMIT 10;
```

**Use cases**: Identify sentences that are too hard (typo-prone words), balance difficulty for competitive integrity, remove sentences if death_rate > 50% (too unfair)

---

## 🏆 LEADERBOARD SYSTEMS

### **Room Leaderboard (Live During Game)**

**Update Triggers**: Player types correct character (update progress bar), player completes sentence (re-sort if needed), player dies (move to bottom, grey out), player reconnects (restore position)

**Sorting Algorithm**:
```javascript
function sortLeaderboard(players) {
  return players.sort((a, b) => {
    // 1. Alive players always above dead
    if (a.status === "ALIVE" && b.status !== "ALIVE") return -1;
    if (a.status !== "ALIVE" && b.status === "ALIVE") return 1;
    
    // 2. Among same status, sort by completed sentences DESC
    if (a.completedSentences !== b.completedSentences) {
      return b.completedSentences - a.completedSentences;
    }
    
    // 3. Tiebreaker: Total correct characters DESC
    if (a.totalCorrectChars !== b.totalCorrectChars) {
      return b.totalCorrectChars - a.totalCorrectChars;
    }
    
    // 4. Final tiebreaker: WPM DESC (rewards speed)
    return b.averageWPM - a.averageWPM;
  });
}
```

**Broadcast Strategy**: **Every keystroke**: Update only the typing player's progress bar, **Every 1 second**: Recalculate WPM for all players, broadcast batch update, **On major events** (sentence complete, death): Full leaderboard resort + broadcast

**Optimization** (for 50+ player rooms):
```javascript
// Instead of broadcasting full leaderboard every second:
// Only broadcast delta changes

const previousLeaderboard = getLeaderboardSnapshot();
const currentLeaderboard = sortLeaderboard(players);

const changes = [];
for (let i = 0; i < currentLeaderboard.length; i++) {
  if (previousLeaderboard[i]?.id !== currentLeaderboard[i].id) {
    changes.push({
      playerId: currentLeaderboard[i].id,
      newRank: i + 1,
      previousRank: previousLeaderboard.findIndex(p => p.id === currentLeaderboard[i].id) + 1
    });
  }
}

if (changes.length > 0) {
  io.to(roomCode).emit("leaderboard_update", { changes });
}
```

### **Global Leaderboard (Post-Game)**

**Database Schema**:
```sql
CREATE TABLE global_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID, -- NULL if guest, FOREIGN KEY if registered
  nickname VARCHAR(20) NOT NULL,
  room_code VARCHAR(6) NOT NULL,
  sentence_count INTEGER NOT NULL,
  completed_sentences INTEGER NOT NULL,
  total_correct_chars INTEGER NOT NULL,
  accuracy FLOAT NOT NULL,
  average_wpm FLOAT NOT NULL,
  game_duration INTEGER, -- seconds
  timestamp TIMESTAMP DEFAULT NOW(),
  is_guest BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_global_rank ON global_leaderboard(completed_sentences DESC, total_correct_chars DESC);
CREATE INDEX idx_time_period ON global_leaderboard(timestamp);
CREATE INDEX idx_sentence_count ON global_leaderboard(sentence_count);
```

**Categories**:

1. **All-Time Best** (Overall)
   ```sql
   SELECT nickname, completed_sentences, accuracy, average_wpm, timestamp
   FROM global_leaderboard
   ORDER BY completed_sentences DESC, total_correct_chars DESC
   LIMIT 100;
   ```

2. **Daily Leaderboard**: `WHERE timestamp >= NOW() - INTERVAL '1 day'`
3. **WeeklyLeaderboard**: `WHERE timestamp >= NOW() - INTERVAL '7 days'`
4. **Monthly Leaderboard**: `WHERE timestamp >= NOW() - INTERVAL '30 days'`
5. **By Game Length** (Separate leaderboards for fairness): `WHERE sentence_count = 50 ORDER BY completed_sentences DESC`

**Submission Logic**:
```javascript
async function saveToGlobalLeaderboard(player, roomCode, gameSettings) {
  // Only save if player completed at least 10% of sentences
  const threshold = Math.ceil(gameSettings.sentenceCount * 0.1);
  if (player.completedSentences < threshold) {
    return { saved: false, reason: "Score too low" };
  }
  
  // Check if guest or registered
  const isGuest = !player.userId;
  
  // Insert into leaderboard
  await db.query(`
    INSERT INTO global_leaderboard (
      player_id, nickname, room_code, sentence_count,
      completed_sentences, total_correct_chars, accuracy,
      average_wpm, game_duration, is_guest
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    player.userId || null,
    player.nickname,
    roomCode,
    gameSettings.sentenceCount,
    player.completedSentences,
    player.totalCorrectChars,
    (player.totalCorrectChars / player.totalTypedChars) * 100,
    player.averageWPM,
    player.totalPlayTime,
    isGuest
  ]);
  
  // Calculate new rank
  const rankQuery = await db.query(`
    SELECT COUNT(*) + 1 as rank
    FROM global_leaderboard
    WHERE 
      sentence_count = $1
      AND (
        completed_sentences > $2
        OR (completed_sentences = $2 AND total_correct_chars > $3)
      )
  `, [gameSettings.sentenceCount, player.completedSentences, player.totalCorrectChars]);
  
  return {
    saved: true,
    rank: rankQuery.rows[0].rank,
    category: `${gameSettings.sentenceCount}-sentence`
  };
}
```

**Display on Main Menu**:
```
┌───────────────────────────────────────────────────┐
│  🏆 Global Leaderboard                            │
│  [All-Time] [Daily] [Weekly] [Monthly] [By Length]│
│                                                    │
│  Showing: 50-Sentence (All-Time)                  │
│  ┌─────────────────────────────────────────────┐  │
│  │ 1. SpeedKing    50/50  99.8%  185 WPM  ⚡  │  │
│  │ 2. TypeMaster   50/50  99.1%  178 WPM      │  │
│  │ 3. FastFingers  48/50  98.5%  172 WPM      │  │
│  │ ...                                         │  │
│  │ 42. You         38/50  96.2%  132 WPM  🎯  │  │
│  │ ...                                         │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  [View Full Leaderboard]                           │
└───────────────────────────────────────────────────┘
```

---

## 🔐 COMPLETE SECURITY & ANTI-CHEAT

### **IP Rate Limiting**

**Rules**: Max 2 active rooms per IP address, Max 100 total active rooms globally, Max 10 room creation attempts per IP per hour

**Implementation (Redis)**:
```javascript
async function checkRoomCreationLimit(ipAddress) {
  const hashedIP = crypto.createHash('sha256').update(ipAddress).digest('hex');
  
  // Check active rooms for this IP
  const activeRooms = await redis.get(`ip:${hashedIP}:rooms`);
  const roomCount = activeRooms ? JSON.parse(activeRooms).length : 0;
  
  if (roomCount >= 2) {
    return {
      allowed: false,
      reason: "You already have 2 active rooms. Close one to create another."
    };
  }
  
  // Check global room limit
  const globalCount = await redis.get('global:room_count');
  if (globalCount && parseInt(globalCount) >= 100) {
    return {
      allowed: false,
      reason: "Server at capacity (100/100 rooms). Try again in a few minutes."
    };
  }
  
  // Check creation rate limit (10 per hour)
  const creationKey = `ip:${hashedIP}:creations`;
  const creations = await redis.get(creationKey);
  if (creations && parseInt(creations) >= 10) {
    return {
      allowed: false,
      reason: "Too many room creations. Wait before creating more."
    };
  }
  
  return { allowed: true };
}

async function registerRoomCreation(ipAddress, roomCode) {
  const hashedIP = crypto.createHash('sha256').update(ipAddress).digest('hex');
  
  // Add to IP's active rooms
  const rooms = await redis.get(`ip:${hashedIP}:rooms`);
  const roomList = rooms ? JSON.parse(rooms) : [];
  roomList.push(roomCode);
  await redis.set(`ip:${hashedIP}:rooms`, JSON.stringify(roomList), 'EX', 86400); // 24h TTL
  
  // Increment global counter
  await redis.incr('global:room_count');
  
  // Increment creation counter
  await redis.incr(`ip:${hashedIP}:creations`);
  await redis.expire(`ip:${hashedIP}:creations`, 3600); // 1 hour TTL
}

async function unregisterRoom(roomCode, ipAddress) {
  const hashedIP = crypto.createHash('sha256').update(ipAddress).digest('hex');
  
  // Remove from IP's active rooms
  const rooms = await redis.get(`ip:${hashedIP}:rooms`);
  if (rooms) {
    const roomList = JSON.parse(rooms).filter(r => r !== roomCode);
    if (roomList.length > 0) {
      await redis.set(`ip:${hashedIP}:rooms`, JSON.stringify(roomList), 'EX', 86400);
    } else {
      await redis.del(`ip:${hashedIP}:rooms`);
    }
  }
  
  // Decrement global counter
  await redis.decr('global:room_count');
}
```

### **Input Validation (Server-Side)**

```javascript
function validateCharTyped(player, char, charIndex, roomSentences) {
  const currentSentence = roomSentences[player.currentSentenceIndex];
  
  // 1. Validate charIndex is sequential
  if (charIndex !== player.currentCharIndex) {
    return {
      valid: false,
      reason: "OUT_OF_SEQUENCE",
      action: "RESYNC"
    };
  }
  
  // 2. Validate character matches expected
  const expectedChar = currentSentence[charIndex];
  if (char !== expectedChar) {
    return {
      valid: false,
      reason: "MISMATCH",
      action: "TRIGGER_ROULETTE"
    };
  }
  
  // 3. Validate WPM (anti-bot check)
  const timeElapsed = (Date.now() - player.sentenceStartTime) / 1000 / 60; // minutes
  const charsTyped = charIndex + 1;
  const currentWPM = (charsTyped / 5) / timeElapsed;
  
  if (currentWPM > 200) {
    // Flag but don't block (could be burst typing)
    analytics.log({
      eventType: "SUSPICIOUS_WPM",
      playerId: player.id,
      wpm: currentWPM,
      sentenceIndex: player.currentSentenceIndex,
      charIndex: charIndex
    });
    
    // If sustained over 10+ characters, auto-flag
    if (charIndex > 10 && currentWPM > 200) {
      return {
        valid: false,
        reason: "WPM_TOO_HIGH",
        action: "FLAG_PLAYER"
      };
    }
  }
  
  // 4. Validate timestamp isn't in the future
  const serverTime = Date.now();
  if (player.lastCharTimestamp && player.lastCharTimestamp > serverTime) {
    return {
      valid: false,
      reason: "TIMESTAMP_FUTURE",
      action: "RESYNC"
    };
  }
  
  return {
    valid: true,
    action: "INCREMENT"
  };
}
```

### **Socket Rate Limiting**

```javascript
const rateLimit = new Map(); // playerId -> {count, resetTime}

io.use((socket, next) => {
  const playerId = socket.handshake.auth.playerId;
  const now = Date.now();
  
  if (!rateLimit.has(playerId)) {
    rateLimit.set(playerId, { count: 1, resetTime: now + 1000 });
    return next();
  }
  
  const limit = rateLimit.get(playerId);
  
  if (now > limit.resetTime) {
    // Reset counter every second
    rateLimit.set(playerId, { count: 1, resetTime: now + 1000 });
    return next();
  }
  
  if (limit.count >= 20) {
    // Max 20 events per second (reasonable for fast typing)
    return next(new Error("RATE_LIMIT_EXCEEDED"));
  }
  
  limit.count++;
  next();
});
```

### **Data Sanitization**

```javascript
function sanitizeNickname(input) {
  // Remove any HTML/script tags
  let clean = input.replace(/<[^>]*>/g, '');
  
  // Allow only alphanumeric + spaces
  clean = clean.replace(/[^a-zA-Z0-9\s]/g, '');
  
  // Trim and limit length
  clean = clean.trim().substring(0, 20);
  
  // Prevent empty nicknames
  if (clean.length === 0) {
    clean = `Guest${Math.floor(Math.random() * 10000)}`;
  }
  
  return clean;
}

function sanitizeRoomCode(input) {
  // Uppercase alphanumeric only, 6 chars
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6);
}
```

---

## 📈 SCALABILITY & PERFORMANCE

### **Redis Architecture**

**Data Structure**:
```
Redis Keys:
├─ room:{roomCode}                  → Room object (JSON)
├─ player:{playerId}                → Player session token
├─ ip:{hashedIP}:rooms              → Array of active room codes
├─ ip:{hashedIP}:creations          → Creation counter (TTL: 1h)
├─ global:room_count                → Total active rooms
├─ leaderboard:live:{roomCode}      → Sorted set (score = sentences)
└─ analytics:events:{date}          → List of analytics events
```

**TTL Strategy**:
```javascript
// Rooms expire after 24h of inactivity
await redis.set(`room:${roomCode}`, JSON.stringify(room), 'EX', 86400);

// Update TTL on any activity
await redis.expire(`room:${roomCode}`, 86400);

// Cleanup cron job (every hour)
async function cleanupInactiveRooms() {
  const allRooms = await redis.keys('room:*');
  
  for (const key of allRooms) {
    const room = JSON.parse(await redis.get(key));
    const inactiveDuration = Date.now() - room.lastActivity;
    
    if (inactiveDuration > 3600000) { // 1 hour
      await deleteRoom(room.roomCode);
    }
  }
}
```

### **Socket.io Scaling (Multi-Server)**

```javascript
// Use Redis adapter for horizontal scaling
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");

const pubClient = createClient({ url: "redis://localhost:6379" });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

**Load Balancing** (Nginx):
```nginx
upstream socketio_backend {
  ip_hash; # Sticky sessions required for Socket.io
  server 127.0.0.1:3000;
  server 127.0.0.1:3001;
  server 127.0.0.1:3002;
}

server {
  listen 80;
  
  location /socket.io/ {
    proxy_pass http://socketio_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

### **Performance Optimizations**

1. **Sentence Pool Caching**:
   ```javascript
   // Cache frequently used sentence sets in Redis
   const cacheKey = `sentences:pool:${sentenceCount}`;
   let sentences = await redis.get(cacheKey);
   
   if (!sentences) {
     sentences = await selectSentencesFromDB(sentenceCount);
     await redis.set(cacheKey, JSON.stringify(sentences), 'EX', 3600); // 1h cache
   }
   ```

2. **Leaderboard Updates (Debounced)**:
   ```javascript
   // Instead of updating every keystroke, batch updates
   const updateQueue = new Map();
   
   function queueLeaderboardUpdate(roomCode, playerId, data) {
     if (!updateQueue.has(roomCode)) {
       updateQueue.set(roomCode, new Map());
     }
     updateQueue.get(roomCode).set(playerId, data);
   }
   
   // Flush every 500ms
   setInterval(() => {
     for (const [roomCode, updates] of updateQueue.entries()) {
       io.to(roomCode).emit("leaderboard_batch_update", Array.from(updates.entries()));
       updateQueue.delete(roomCode);
     }
   }, 500);
   ```

3. **Client-Side Prediction**:
   ```javascript
   // Client optimistically updates UI before server confirms
   function handleKeyPress(char) {
     // Immediate UI feedback
     updateUILocally(char);
     
     // Send to server for validation
     socket.emit("char_typed", { char, charIndex, timestamp: Date.now() });
     
     // If server rejects, revert UI
     socket.on("char_rejected", () => {
       revertUIChange();
       triggerRoulette();
     });
   }
   ```

---

## 🧪 ANALYTICS SYSTEM (Admin-Only)

### **Tracked Events**

```javascript
const AnalyticsEvents = {
  // Room lifecycle
  ROOM_CREATED: {
    roomCode, sentenceCount, timestamp, creatorIP
  },
  PLAYER_JOINED: {
    roomCode, playerId, nickname, isGuest, timestamp
  },
  GAME_STARTED: {
    roomCode, playerCount, sentenceCount, timestamp
  },
  GAME_ENDED: {
    roomCode, duration, winnerID, totalSentencesTyped, timestamp
  },
  
  // Player actions
  SENTENCE_COMPLETED: {
    playerId, roomCode, sentenceIndex, sentenceText, timeUsed, wpm, accuracy
  },
  ROULETTE_TRIGGERED: {
    playerId, roomCode, sentenceIndex, odds, roll, survived, timestamp
  },
  PLAYER_DIED: {
    playerId, roomCode, sentenceIndex, deathReason, finalScore, timestamp
  },
  
  // Performance metrics
  SUSPICIOUS_WPM: {
    playerId, wpm, sentenceIndex, charIndex, timestamp
  },
  DISCONNECT: {
    playerId, roomCode, sentenceIndex, gracePeriod, timestamp
  },
  RECONNECT: {
    playerId, roomCode, gracePeriodUsed, timestamp
  },
  
  // Sentence performance
  SENTENCE_DEATH: {
    sentenceId, sentenceText, playerId, timestamp
  }
};
```

### **Storage (TimescaleDB or InfluxDB)**

```sql
-- Using PostgreSQL with TimescaleDB extension
CREATE TABLE analytics_events (
  time TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  room_code VARCHAR(6),
  player_id UUID,
  metadata JSONB, -- Flexible storage for event-specific data
  PRIMARY KEY (time, event_type, player_id)
);

SELECT create_hypertable('analytics_events', 'time');
```

### **Admin Dashboard Queries**

**1. Most Deadly Sentences**:
```sql
SELECT 
  metadata->>'sentenceText' as sentence,
  COUNT(*) as deaths,
  AVG((metadata->>'timeUsed')::float) as avg_time
FROM analytics_events
WHERE event_type = 'SENTENCE_DEATH'
GROUP BY metadata->>'sentenceText'
ORDER BY deaths DESC
LIMIT 10;
```

**2. Average Game Duration by Sentence Count**:
```sql
SELECT 
  metadata->>'sentenceCount' as length,
  AVG((metadata->>'duration')::float) as avg_duration_seconds
FROM analytics_events
WHERE event_type = 'GAME_ENDED'
GROUP BY metadata->>'sentenceCount';
```

**3. Player Retention (% who finish vs die)**:
```sql
WITH game_outcomes AS (
  SELECT 
    room_code,
    player_id,
    BOOL_OR(event_type = 'PLAYER_DIED') as died,
    BOOL_OR(metadata->>'completedSentences' = metadata->>'totalSentences') as finished
  FROM analytics_events
  WHERE event_type IN ('PLAYER_DIED', 'GAME_ENDED')
  GROUP BY room_code, player_id
)
SELECT 
  COUNT(*) FILTER (WHERE finished) * 100.0 / COUNT(*) as finish_rate,
  COUNT(*) FILTER (WHERE died) * 100.0 / COUNT(*) as death_rate
FROM game_outcomes;
```

**4. Peak Concurrent Players/Rooms**:
```sql
SELECT 
  time_bucket('1 hour', time) as hour,
  COUNT(DISTINCT room_code) as concurrent_rooms,
  COUNT(DISTINCT player_id) as concurrent_players
FROM analytics_events
WHERE event_type IN ('GAME_STARTED', 'PLAYER_JOINED')
GROUP BY hour
ORDER BY concurrent_players DESC
LIMIT 1;
```

**5. Roulette Survival Rate by Odds**:
```sql
SELECT 
  metadata->>'odds' as odds,
  COUNT(*) FILTER (WHERE (metadata->>'survived')::boolean = true) * 100.0 / COUNT(*) as survival_rate,
  COUNT(*) as total_triggers
FROM analytics_events
WHERE event_type = 'ROULETTE_TRIGGERED'
GROUP BY metadata->>'odds'
ORDER BY odds;
```

### **Admin Dashboard UI**

```
┌───────────────────────────────────────────────────────┐
│  Type or Die - Admin Analytics                     │
├───────────────────────────────────────────────────────┤
│  [Overview] [Rooms] [Players] [Sentences] [Performance]│
│                                                        │
│  OVERVIEW (Last 24h)                                   │
│  ┌──────────────────────────────────────────┐         │
│  │  Total Games:          1,234             │         │
│  │  Total Players:        5,678             │         │
│  │  Avg Game Duration:    12m 34s           │         │
│  │  Finish Rate:          42.3%             │         │
│  │  Death Rate:           57.7%             │         │
│  │  Peak Concurrent:      89 rooms          │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  DEADLIEST SENTENCES                                   │
│  ┌──────────────────────────────────────────┐         │
│  │  1. "Pneumonoultramicroscopicsilicovolc..│         │
│  │     💀 Deaths: 234  ⏱️ Avg Time: 18.5s   │         │
│  │                                           │         │
│  │  2. "The quick brown fox jumps over..."  │         │
│  │     💀 Deaths: 189  ⏱️ Avg Time: 16.2s   │         │
│  └──────────────────────────────────────────┘         │
│                                                        │
│  ROULETTE STATS                                        │
│  ┌──────────────────────────────────────────┐         │
│  │  Odds    Survival Rate    Triggers       │         │
│  │  1/6     83.2%            1,523          │         │
│  │  1/5     79.8%            1,012          │         │
│  │  1/4     74.1%              687          │         │
│  │  1/3     65.9%              412          │         │
│  │  1/2     49.2%              234          │         │
│  └──────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────┘
```

---

## ✅ FEATURE PRIORITY & ROADMAP

### **MVP (Minimum Viable Product) - Week 1-8**

| Feature | Priority | Week | Status |
|---------|----------|------|--------|
| Room creation/joining | P0 | 1-2 | 🔲 |
| Basic typing validation | P0 | 2-3 | 🔲 |
| Roulette system (1/6 → 1/2 cap) | P0 | 3-4 | 🔲 |
| Live leaderboard | P0 | 4-5 | 🔲 |
| Timer system (20s) | P0 | 3 | 🔲 |
| Sentence pool (100K) | P0 | 1-2 | 🔲 |
| Disconnect/reconnect (30s grace) | P1 | 5-6 | 🔲 |
| Spectator mode | P1 | 6 | 🔲 |
| Results screen (5 tabs) | P1 | 7 | 🔲 |
| Guest nicknames | P1 | 2 | 🔲 |
| IP rate limiting (2 rooms/IP) | P1 | 4 | 🔲 |
| Redis scaling | P1 | 8 | 🔲 |
| WPM validation (200 cap) | P1 | 5 | 🔲 |
| Basic roulette animation (text) | P2 | 7 | 🔲 |

### **Post-MVP (Enhancements) - Week 9+**

| Feature | Priority | Estimated Time |
|---------|----------|----------------|
| User accounts (email/password) | P2 | 2 weeks |
| Global leaderboard (all categories) | P2 | 1 week |
| Replay system (save game states) | P2 | 2 weeks |
| Advanced roulette animation (pixel art) | P3 | 1 week |
| Audio effects (click, bang, music) | P2 | 3 days |
| Admin analytics dashboard | P2 | 1 week |
| Sentence difficulty tiers | P3 | 1 week |
| Custom sentence packs (user-created) | P3 | 2 weeks |
| Mobile responsive design | P3 | 2 weeks |
| Accessibility (screen readers, high contrast) | P3 | 1 week |

---

## 🚨 ALL DECISIONS LOCKED

✅ **Character encoding**: English only, no emojis  
✅ **Input method**: Keyboard + mouse only  
✅ **Mobile support**: Defer to post-MVP  
✅ **Anti-bot**: No CAPTCHA, max 100 rooms, 2/IP  
✅ **Monetization**: None for now  
✅ **Moderation**: No system for now  
✅ **Analytics**: Admin-only, detailed tracking  
✅ **WPM limit**: 200 WPM max  
✅ **Roulette cap**: 1/2 minimum (never 1/1)  
✅ **Scaling**: Redis required  

---

## 📋 COMPLETE IMPLEMENTATION CHECKLIST

### **Phase 1: Foundation (Week 1-2)**
- [ ] Set up React + Socket.io + Express project structure
- [ ] Configure Redis connection and test
- [ ] Design database schema (PostgreSQL)
- [ ] Create sentence pool (100K sentences)
  - [ ] Write validation script
  - [ ] Populate database
  - [ ] Create indexes
- [ ] Build basic UI layouts (Main menu, Lobby, Game screen, Results screen)
- [ ] Implement room creation logic (Generate 6-char codes, IP rate limiting, Global room limit (100), Store in Redis)
- [ ] Implement room joining logic (Validate room codes, Handle LOBBY vs PLAYING status)

### **Phase 2: Core Gameplay (Week 3-4)**
- [ ] Character-by-character typing validation (Server-side validation, Client-side prediction, Mismatch detection)
- [ ] Roulette system (Crypto.randomInt RNG, 1/6 → 1/5 → 1/4 → 1/3 → 1/2 progression, Hard cap at 1/2, Analytics logging)
- [ ] Timer system (20s countdown per sentence, Timeout triggers roulette, Visual warnings (<5s))
- [ ] Sentence completion logic (Increment counters, Check win condition, Move to next sentence)
- [ ] Death handling (Freeze score, Transition to spectator, Update leaderboard)

### **Phase 3: Multiplayer Sync (Week 5-6)**
- [ ] Live leaderboard (Real-time progress bars, WPM calculation, Auto-sorting, Delta broadcasts)
- [ ] Disconnect/reconnect (30s grace period, Timer pause/resume, Session token validation, Grace period expiry handling)
- [ ] Host migration (Auto-select new host, Preserve game state, Handle edge cases)
- [ ] Spectator mode (Click-to-spectate UI, Live stream target player, Switch spectate targets, Practice typing (no score))

### **Phase 4: Polish (Week 7-8)**
- [ ] Results screen (Final leaderboard tab, Detailed stats tab, Roulette history tab, Sentence breakdown tab, Room stats tab)
- [ ] Roulette animation (Text-based overlay, Green/red flash, Audio (click/bang))
- [ ] WPM anti-cheat (200 WPM limit, Suspicious activity flagging)
- [ ] Error handling (Network failures, Invalid inputs, Redis downtime)
- [ ] Performance optimization (Debounced leaderboard updates, Sentence pool caching, Socket rate limiting)

### **Phase 5: Analytics (Week 8)**
- [ ] Analytics event tracking (All event types implemented, Redis → Database pipeline)
- [ ] Admin dashboard (basic) (Overview metrics, Deadliest sentences, Roulette survival rates)

---

## 🎯 SUCCESS METRICS

**Technical**:
- ✅ 50ms server latency (p95)
- ✅ 100ms client UI response (p95)
- ✅ Support 100 concurrent rooms
- ✅ Support 500 concurrent players
- ✅ 99.9% uptime

**Gameplay**:
- ✅ <1% desync rate (client vs server state)
- ✅ <5% disconnect rate
- ✅ >90% successful reconnects (within grace period)

**User Experience**:
- ✅ 40%+ finish rate (complete at least 50% of sentences)
- ✅ 5+ avg minutes per session
- ✅ 20%+ return rate (play multiple games)

---

## 🔚 FINAL CONCLUSION

This blueprint is **comprehensive, gap-free, and implementation-ready**. Every system, edge case, and interaction has been mapped with sufficient detail for immediate development.

**Key Architectural Decisions**:
1. ✅ Redis for real-time state management
2. ✅ PostgreSQL for persistent data (sentences, users, leaderboard)
3. ✅ Socket.io for real-time communication
4. ✅ React for UI with client-side prediction
5. ✅ Server-authoritative validation (anti-cheat)
6. ✅ Horizontal scaling via Redis adapter

**Critical Features Locked**:
- ✅ English-only, no emojis, keyboard + mouse
- ✅ 200 WPM limit, IP rate limiting (2 rooms/IP, 100 global)
- ✅ Roulette hard cap at 1/2 (never 1/1)
- ✅ 30s disconnect grace period
- ✅ Admin-only analytics

**Ready for development. All ambiguities resolved. No gaps remain.**