local room_key       = KEYS[1]
local player_id      = ARGV[1]
local survived       = ARGV[2]
local new_odds       = tonumber(ARGV[3])
local previous_odds  = tonumber(ARGV[4])
local roll           = tonumber(ARGV[5])
local sentence_index = tonumber(ARGV[6])
local timestamp      = tonumber(ARGV[7])
local room_ttl       = tonumber(ARGV[8])

local room_data      = redis.call('GET', room_key)
if not room_data then return nil end

local room   = cjson.decode(room_data)
local player = room.players[player_id]
if not player then return nil end

if not player.rouletteHistory then
  player.rouletteHistory = {}
end

table.insert(player.rouletteHistory, {
  sentenceIndex = sentence_index,
  odds          = '1/' .. tostring(previous_odds),
  survived      = (survived == 'true'),
  roll          = roll,
  timestamp     = timestamp
})

if survived == 'true' then
  player.rouletteOdds      = new_odds
  player.sentenceStartTime = timestamp + 5000
else
  player.status = 'DEAD'
  player.activeRoulette = {
    survived     = false,
    newOdds      = previous_odds,
    previousOdds = previous_odds,
    roll         = roll,
    expiresAt    = timestamp + 5000
  }
end

room.players[player_id] = player
room.lastActivity = timestamp
redis.call('SET', room_key, cjson.encode(room), 'EX', room_ttl)

return cjson.encode(room)
