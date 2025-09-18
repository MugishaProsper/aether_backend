-- Batch reserve stock for multiple items
-- KEYS = alternating stock keys and reservation keys [stock1, reservation1, stock2, reservation2, ...]
-- ARGV = alternating quantities and TTL [qty1, ttl, qty2, ttl, ...]

local keyCount = #KEYS
local results = {}
local allSuccess = true
local reservations = {}

-- First pass: check if all items have sufficient stock
for i = 1, keyCount, 2 do
  local stockKey = KEYS[i]
  local reservationKey = KEYS[i + 1]
  local qty = tonumber(ARGV[i])
  local stock = tonumber(redis.call("GET", stockKey) or "0")
  
  if stock < qty then
    allSuccess = false
    results[#results + 1] = { stockKey, 0, stock, qty } -- key, success, available, requested
  else
    results[#results + 1] = { stockKey, 1, stock, qty }
    reservations[#reservations + 1] = { stockKey, reservationKey, qty, ARGV[i + 1] }
  end
end

-- If all items have sufficient stock, make all reservations
if allSuccess then
  for _, reservation in ipairs(reservations) do
    local stockKey, reservationKey, qty, ttl = reservation[1], reservation[2], reservation[3], reservation[4]
    redis.call("DECRBY", stockKey, qty)
    redis.call("SET", reservationKey, qty, "EX", ttl)
  end
  return { 1, results } -- All reservations successful
else
  return { 0, results } -- Some reservations failed
end