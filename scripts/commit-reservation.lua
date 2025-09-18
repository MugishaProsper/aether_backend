-- Commit stock reservation (finalize the sale)
-- KEYS[1] = stock key (stock:sku:{sku})
-- KEYS[2] = reservation key (reservation:{orderId}:{sku})

local reservation = redis.call("GET", KEYS[2])

if reservation then
  -- Reservation exists, commit it (just delete the reservation)
  local qty = tonumber(reservation)
  redis.call("DEL", KEYS[2])
  
  local currentStock = tonumber(redis.call("GET", KEYS[1]) or "0")
  return { 1, qty, currentStock } -- Success, committed quantity, remaining stock
else
  -- No reservation found
  return { 0, 0, tonumber(redis.call("GET", KEYS[1]) or "0") } -- No reservation, current stock
end