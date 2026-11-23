-- Atomically change part of a room, so concurrent writers (other players' keystrokes
-- in atomicCharUpdate.lua) are never overwritten by a stale full-room write.
-- Returns 1 if applied, 0 if the room/player is gone or the status precondition failed.

local room_key = KEYS[1]
local player_id = ARGV[1]       -- '' for no player change
local player_patch = ARGV[2]    -- JSON object of fields to set on that player, or ''
local require_status = ARGV[3]  -- only apply when room.status equals this, or ''
local set_status = ARGV[4]      -- new room.status, or ''
local add_spectator = ARGV[5]   -- player id to append to room.spectators, or ''
local room_ttl = tonumber(ARGV[6])
local now = tonumber(ARGV[7])

local room_data = redis.call('GET', room_key)
if not room_data then return 0 end

local room = cjson.decode(room_data)

if require_status ~= '' and room.status ~= require_status then
    return 0
end

if player_id ~= '' then
    local player = room.players[player_id]
    if not player then return 0 end
    if player_patch ~= '' then
        for field, value in pairs(cjson.decode(player_patch)) do
            player[field] = value
        end
    end
end

if set_status ~= '' then
    room.status = set_status
end

if add_spectator ~= '' then
    if type(room.spectators) ~= 'table' then room.spectators = {} end
    table.insert(room.spectators, add_spectator)
end

room.lastActivity = now
redis.call('SET', room_key, cjson.encode(room), 'EX', room_ttl)
return 1
