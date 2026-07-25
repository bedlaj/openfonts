'use strict'

// Run `fn(item, index)` over all items with at most `limit` in flight.
// Never rejects: each result slot is {ok: true, value} or {ok: false, error}.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = {ok: true, value: await fn(items[i], i)}
      } catch (error) {
        results[i] = {ok: false, error}
      }
    }
  }
  const workers = []
  for (let i = 0; i < Math.max(1, Math.min(limit, items.length)); i++) workers.push(worker())
  await Promise.all(workers)
  return results
}

module.exports = {mapLimit}
