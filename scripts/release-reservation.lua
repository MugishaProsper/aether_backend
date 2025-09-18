-- Release stock reservation script
-- KEYS[1] = stock key (stock:sku:{sku})
-- KEYS[2] = reservation key (reservation:{orderId}:{sku})

local reservation = redis.call("GET", KEYS[2])

if reservation then
  -- Reservation exists, release it
  local qty = tonumber(reservation)
  redis.call("INCRBY", KEYS[1], qty)
  redis.call("DEL", KEYS[2])
  
  local newStock = tonumber(redis.call("GET", KEYS[1]) or "0")
  return { 1, qty, newStock } -- Success, released quantity, new stock level
else
  -- No reservation found
  return { 0, 0, tonumber(redis.call("GET", KEYS[1]) or "0") } -- No reservation, current stock
end