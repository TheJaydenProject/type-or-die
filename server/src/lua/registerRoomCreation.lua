-- Atomic IP room registration with limit checking
-- Returns: 1 on success, 0 if limit reached

local ip_rooms_key = KEYS[1]
local max_rooms = tonumber(ARGV[1])
local room_code = ARGV[2]
local room_ttl = tonumber(ARGV[3])

local current = redis.call('GET', ip_rooms_key)
local rooms = {}

if current then
  rooms = cjson.decode(current)
end

if #rooms >= max_rooms then
  return 0
end

table.insert(rooms, room_code)
redis.call('SET', ip_rooms_key, cjson.encode(rooms), 'EX', room_ttl)
return 1