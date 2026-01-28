-- Safe lock release (only if lock value matches)
-- Returns: 1 if released, 0 if lock value mismatch

if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end