# 📡 ScaleX WebSocket CLI

Tiny TypeScript console client for testing the ScaleX DEX real-time gateway.

---

## 🔰 Quick start
pnpm install
pnpm ts-node websocket-client.ts      # launches an interactive prompt



## 💻 Commands

help | commands            show this table
subscribe <stream>         add a stream  (e.g.  subscribe btcusdt@depth)
unsubscribe <stream>       remove a stream
list                       list current subscriptions on the server
ping                       send a PING (server replies PONG)
reconnect                  close + reopen the socket
exit                       quit the CLI

Stream suffixes
  <symbol>@depth               full order-book deltas
  <symbol>@depth5@100ms        top-5 book snapshot every 100 ms
  <symbol>@trade               live trades (tick-by-tick)
  <symbol>@kline_1m            1-minute candlesticks
  <symbol>@miniTicker          24 h mini-ticker (last / high / low / vol)


## 📈 Example session

> subscribe ethusdc@depth5@100ms
ACK   { id: 1, result: null }

STREAM ethusdc@depth5@100ms { e:'depthUpdate', b:[…], a:[…] }

> ping
PONG  { method:'PONG' }

> list
ACK   { id: 2, result: ['ethusdc@depth5@100ms'] }

> exit


## 🧩 Personal user streams

To receive your own order/trade and balance events, run:

> user 0xYourWalletAddress

This opens a second socket to:
  wss://core-devnet.scalex.money/ws/0xYourWalletAddress

No `subscribe` command is needed. Server pushes:
  • executionReport   (order status, fills)
  • balanceUpdate     (deposits, withdrawals, locks, unlocks)

Use `closeuser` to manually disconnect the user socket.

## Color legend

STREAM = yellow   ACK = green   PONG = blue   UNKWN = red

The CLI is ~120 LOC in `websocket-client.ts`; hack away as needed!