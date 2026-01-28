-- Atomic character validation and room state update
-- Returns: JSON-encoded result or nil if validation fails

local room_key = KEYS[1]
local player_id = ARGV[1]
local char = ARGV[2]
local char_index = tonumber(ARGV[3])
local timestamp = tonumber(ARGV[4])
local room_ttl = tonumber(ARGV[5])

-- Fetch and parse room
local room_data = redis.call('GET', room_key)
if not room_data then return nil end

local room = cjson.decode(room_data)
if room.status ~= 'PLAYING' then return nil end

local player = room.players[player_id]
if not player or player.status ~= 'ALIVE' then return nil end

-- Parse current sentence into words
local sentence = room.sentences[player.currentSentenceIndex + 1]
if not sentence then return nil end

local words = {}
for word in sentence:gmatch("%S+") do
  table.insert(words, word)
end

-- Get target character
local current_word = words[player.currentWordIndex + 1]
if not current_word then return nil end

local target_char = current_word:sub(player.currentCharInWord + 1, player.currentCharInWord + 1)

-- Validate character
if char ~= target_char then return nil end

-- Update player state
player.currentCharInWord = player.currentCharInWord + 1
player.currentCharIndex = player.currentCharIndex + 1
player.totalTypedChars = player.totalTypedChars + 1
player.totalCorrectChars = player.totalCorrectChars + 1
player.sentenceCharCount = (player.sentenceCharCount or 0) + 1

-- Calculate WPM
if room.gameStartedAt then
  local total_minutes = (timestamp - room.gameStartedAt) / 1000 / 60
  if total_minutes > 0 then
    player.averageWPM = math.floor((player.totalCorrectChars / 5) / total_minutes)
  end
end

local time_elapsed = (timestamp - player.sentenceStartTime) / 1000 / 60
if time_elapsed > 0 then
  player.currentSessionWPM = math.floor((player.sentenceCharCount / 5) / time_elapsed)
end

local result_type = 'CORRECT'
local extra_data = {}

-- Check word completion
if player.currentCharInWord >= #current_word then
  if player.currentWordIndex >= #words - 1 then
    -- Sentence complete
    result_type = 'SENTENCE_COMPLETE'
    player.completedSentences = player.completedSentences + 1
    player.currentSentenceIndex = player.currentSentenceIndex + 1
    player.currentWordIndex = 0
    player.currentCharInWord = 0
    player.currentCharIndex = 0
    player.sentenceCharCount = 0
    
    extra_data.timeUsed = (timestamp - player.sentenceStartTime) / 1000
    player.sentenceStartTime = timestamp
    extra_data.newSentenceStartTime = timestamp
    
    table.insert(player.sentenceHistory, {
      sentenceIndex = player.currentSentenceIndex - 1,
      completed = true,
      wpm = player.currentSessionWPM,
      timeUsed = extra_data.timeUsed
    })
  else
    player.currentWordIndex = player.currentWordIndex + 1
    player.currentCharInWord = 0
  end
end

-- Update room activity and persist
room.lastActivity = timestamp
redis.call('SET', room_key, cjson.encode(room), 'EX', room_ttl)

-- Return result
return cjson.encode({
  type = result_type,
  player = player,
  wordIndex = player.currentWordIndex,
  charInWord = player.currentCharInWord,
  extraData = extra_data
})