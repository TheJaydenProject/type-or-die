-- Remove room from IP tracking
-- Returns: 1 if removed, 0 if not found

local ip_rooms_key = KEYS[1]
local room_code = ARGV[1]
local room_ttl = tonumber(ARGV[2])

local current = redis.call('GET', ip_rooms_key)
if not current then return 0 end

local rooms = cjson.decode(current)
local new_rooms = {}
local removed = 0

for i, code in ipairs(rooms) do
  if code ~= room_code then
    table.insert(new_rooms, code)
  else
    removed = 1
  end
end

if #new_rooms == 0 then
  redis.call('DEL', ip_rooms_key)
else
  redis.call('SET', ip_rooms_key, cjson.encode(new_rooms), 'EX', room_ttl)
end

return removed