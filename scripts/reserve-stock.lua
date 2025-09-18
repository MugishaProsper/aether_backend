-- Reserve stock inventory script
-- KEYS[1] = stock key (stock:sku:{sku})
-- KEYS[2] = reservation key (reservation:{orderId}:{sku})
-- ARGV[1] = quantity to reserve
-- ARGV[2] = TTL for reservation (seconds)

local stock = tonumber(redis.call("GET", KEYS[1]) or "0")
local qty = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

if stock >= qty then
  -- Sufficient stock available, make reservation
  redis.call("DECRBY", KEYS[1], qty)
  redis.call("SET", KEYS[2], qty, "EX", ttl)
  return { 1, stock - qty } -- Success, remaining stock
else
  -- Insufficient stock
  return { 0, stock } -- Failure, current stock
end