import readline from "readline";
import { WebSocket } from "ws";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_USER_ADDRESS = '0x77C037fbF42e85dB1487B390b08f58C00f438812';

const config = {
  url: process.env.WEBSOCKET_URL || 'ws://localhost:42080',
  autoReconnect: process.env.AUTO_RECONNECT === "true",
  reconnectInterval: Number(process.env.RECONNECT_INTERVAL) || 3000,
  pingInterval: Number(process.env.PING_INTERVAL) || 30000,
  useDefaultSubscriptions: process.env.NO_DEFAULT_SUBS !== "true",
  defaultSubscriptions: ['mwethmusdc@trade', 'mwethmusdc@kline_1m', 'mwethmusdc@depth', 'mwethmusdc@miniTicker'],
  defaultUserAddress: process.env.DEFAULT_USER_ADDRESS || DEFAULT_USER_ADDRESS,
  autoConnectUser: process.env.AUTO_CONNECT_USER !== "false",
};

type ServerMessage =
  | { id: number | null; result: any }
  | { stream: string; data: any }
  | { method: "PONG" };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let ws: WebSocket | null = null;
let userWs: WebSocket | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let userPingInterval: NodeJS.Timeout | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let isConnecting = false;

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(color: string, prefix: string, message: string): void {
  console.log(`${color}[${prefix}]${colors.reset} ${message}`);
}

function connect(): void {
  if (isConnecting) return;
  isConnecting = true;

  log(colors.blue, "SYSTEM", `Connecting to ${config.url}...`);

  ws = new WebSocket(config.url);

  ws.on("open", () => {
    isConnecting = false;
    log(colors.green, "SYSTEM", "Connected to WebSocket server");
    log(colors.cyan, "HELP", "Type \"commands\" to see available commands");

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: "PING" }));
        log(colors.blue, "PING", "Sent ping");
      }
    }, config.pingInterval);

    // Auto-subscribe to default streams if enabled
    if (config.useDefaultSubscriptions) {
      setTimeout(() => {
        subscribeToDefaultStreams();
      }, 100); // Small delay to ensure connection is stable
    }
  });

  ws.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString()) as ServerMessage;

      if ("stream" in message) {
        log(colors.yellow, "STREAM", JSON.stringify(message, null, 2));
      } else if ("result" in message) {
        log(colors.green, "ACK", JSON.stringify(message, null, 2));
      } else if ("method" in message && message.method === "PONG") {
        log(colors.blue, "PONG", "Received pong");
      } else {
        log(colors.red, "UNKWN", JSON.stringify(message, null, 2));
      }
    } catch (error) {
      log(colors.red, "ERROR", `Failed to parse message: ${(error as Error).message}`);
      console.log("Raw message:", data.toString());
    }
  });

  ws.on("close", () => {
    log(colors.red, "SYSTEM", "Disconnected from WebSocket server");
    if (pingInterval) clearInterval(pingInterval);
    isConnecting = false;

    if (config.autoReconnect) {
      log(colors.yellow, "SYSTEM", `Reconnecting in ${config.reconnectInterval / 1000} seconds...`);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connect, config.reconnectInterval);
    }
  });

  ws.on("error", (error) => {
    log(colors.red, "ERROR", `WebSocket error: ${error.message}`);
    isConnecting = false;
  });
}

function connectUser(address: string): void {
  if (userWs && userWs.readyState === WebSocket.OPEN) {
    log(colors.yellow, "USER", "Closing previous user socket");
    userWs.close();
  }

  const normalizedAddress = address.toLowerCase();
  let baseUrl = config.url.replace(/\/$/, "");
  if (!baseUrl.endsWith("/ws")) {
    baseUrl += "/ws";
  }
  const url = `${baseUrl}/${normalizedAddress}`;
  log(colors.blue, "USER", `Connecting to ${url} ...`);
  log(colors.blue, "USER", `Normalized address: ${normalizedAddress}`);

  userWs = new WebSocket(url);

  userWs.on("open", () => {
    log(colors.green, "USER", "User socket connected");
    // Send a ping immediately to keep connection alive
    userWs.send(JSON.stringify({ method: "PING" }));
    log(colors.blue, "USER", "Sent initial ping");
    
    // Start regular ping interval for user connection
    if (userPingInterval) clearInterval(userPingInterval);
    userPingInterval = setInterval(() => {
      if (userWs && userWs.readyState === WebSocket.OPEN) {
        userWs.send(JSON.stringify({ method: "PING" }));
        log(colors.blue, "USER", "Sent ping");
      }
    }, config.pingInterval);
  });

  userWs.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      log(colors.cyan, "USRMSG", JSON.stringify(msg, null, 2));
    } catch {
      log(colors.red, "USRERR", buf.toString());
    }
  });

  userWs.on("close", (code, reason) => {
    log(colors.yellow, "USER", `User socket closed - Code: ${code}, Reason: ${reason.toString()}`);
    if (userPingInterval) {
      clearInterval(userPingInterval);
      userPingInterval = null;
    }
  });

  userWs.on("error", (err) => {
    log(colors.red, "USER", `User socket error: ${err.message}`);
  });
}

function processCommand(input: string): void {
  const command = input.trim();

  if (command === "commands" || command === "help") {
    log(colors.cyan, "HELP", "Available commands:");
    console.log(`
  ${colors.cyan}subscribe <stream>${colors.reset}    - Subscribe to a stream (e.g. mwethmusdc@trade)
  ${colors.cyan}unsubscribe <stream>${colors.reset}  - Unsubscribe from a stream
  ${colors.cyan}list${colors.reset}                  - List current subscriptions
  ${colors.cyan}ping${colors.reset}                  - Send a ping message
  ${colors.cyan}reconnect${colors.reset}             - Reconnect to the WebSocket server
  ${colors.cyan}defaults${colors.reset}               - Subscribe to default streams
  ${colors.cyan}exit${colors.reset}                  - Exit the application
  ${colors.cyan}user <wallet>${colors.reset}          - Open user-data socket for wallet
  ${colors.cyan}closeuser${colors.reset}              - Close user-data socket
    `);
    return;
  }

  if (command === "exit") {
    log(colors.yellow, "SYSTEM", "Exiting...");
    if (ws) ws.close();
    if (pingInterval) clearInterval(pingInterval);
    if (userPingInterval) clearInterval(userPingInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (userWs) userWs.close();
    rl.close();
    process.exit(0);
  }
  if (command.startsWith("user ")) {
    const addr = command.substring(5).trim();
    if (!addr) {
      log(colors.red, "ERROR", "Provide wallet address");
    } else {
      connectUser(addr);
    }
    return;
  }

  if (command === "closeuser") {
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      userWs.close();
    } else {
      log(colors.yellow, "USER", "No user socket open");
    }
    if (userPingInterval) {
      clearInterval(userPingInterval);
      userPingInterval = null;
    }
    return;
  }

  if (command === "reconnect") {
    log(colors.yellow, "SYSTEM", "Reconnecting...");
    if (ws) ws.close();
    if (pingInterval) clearInterval(pingInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    connect();
    return;
  }

  if (command === "defaults") {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log(colors.red, "ERROR", "Not connected to WebSocket server");
      return;
    }
    subscribeToDefaultStreams();
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log(colors.red, "ERROR", "Not connected to WebSocket server");
    return;
  }

  if (command === "ping") {
    ws.send(JSON.stringify({ method: "PING" }));
    log(colors.blue, "PING", "Sent ping");
    return;
  }

  if (command.startsWith("subscribe ")) {
    const stream = command.substring("subscribe ".length).trim();
    if (!stream) {
      log(colors.red, "ERROR", "Please provide a stream");
      return;
    }

    ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [stream], id: Date.now() }));
    log(colors.magenta, "SUBSCRIBE", `Subscribing to stream: ${stream}`);
    return;
  }

  if (command.startsWith("unsubscribe ")) {
    const stream = command.substring("unsubscribe ".length).trim();
    if (!stream) {
      log(colors.red, "ERROR", "Please provide a stream");
      return;
    }

    ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params: [stream], id: Date.now() }));
    log(colors.magenta, "UNSUBSCRIBE", `Unsubscribing from stream: ${stream}`);
    return;
  }

  if (command === "list") {
    ws.send(JSON.stringify({ method: "LIST_SUBSCRIPTIONS", id: Date.now() }));
    log(colors.magenta, "LIST", "Requested list of subscriptions");
    return;
  }

  log(colors.red, "ERROR", `Unknown command: ${command}. Type "commands" for help.`);
}

function subscribeToDefaultStreams(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  log(colors.magenta, "AUTO-SUB", "Subscribing to default streams...");
  config.defaultSubscriptions.forEach(stream => {
    ws!.send(JSON.stringify({ method: "SUBSCRIBE", params: [stream], id: Date.now() + Math.random() }));
    log(colors.magenta, "AUTO-SUB", `Subscribed to ${stream}`);
  });
}

function promptForDefaultSubscriptions(): Promise<boolean> {
  return new Promise((resolve) => {
    log(colors.cyan, "SYSTEM", "CLOB DEX WebSocket Test Client");
    log(colors.cyan, "SYSTEM", `Server URL: ${config.url}`);
    log(colors.cyan, "CONFIG", `Auto-reconnect: ${config.autoReconnect}`);
    log(colors.cyan, "CONFIG", `Reconnect interval: ${config.reconnectInterval}ms`);
    log(colors.cyan, "CONFIG", `Ping interval: ${config.pingInterval}ms`);
    
    console.log(`\n${colors.yellow}Default subscriptions available:${colors.reset}`);
    config.defaultSubscriptions.forEach((stream, index) => {
      console.log(`  ${index + 1}. ${stream}`);
    });
    
    rl.question(`\n${colors.cyan}Do you want to use default subscriptions? (y/N): ${colors.reset}`, (answer) => {
      const useDefaults = answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes';
      resolve(useDefaults);
    });
  });
}

async function startClient(): Promise<void> {
  // Check if default subscriptions should be used based on env var or user prompt
  if (process.env.NO_DEFAULT_SUBS === "true") {
    config.useDefaultSubscriptions = false;
    log(colors.cyan, "SYSTEM", "CLOB DEX WebSocket Test Client");
    log(colors.cyan, "SYSTEM", `Server URL: ${config.url}`);
    log(colors.cyan, "CONFIG", `Auto-reconnect: ${config.autoReconnect}`);
    log(colors.cyan, "CONFIG", `Reconnect interval: ${config.reconnectInterval}ms`);
    log(colors.cyan, "CONFIG", `Ping interval: ${config.pingInterval}ms`);
    log(colors.cyan, "CONFIG", "Default subscriptions: disabled (NO_DEFAULT_SUBS=true)");
  } else {
    config.useDefaultSubscriptions = await promptForDefaultSubscriptions();
  }
  
  if (config.useDefaultSubscriptions) {
    log(colors.cyan, "CONFIG", `Default subscriptions: enabled`);
  } else {
    log(colors.cyan, "CONFIG", "Default subscriptions: disabled");
  }
  
  log(colors.cyan, "CONFIG", `Auto-connect user: ${config.autoConnectUser}`);
  if (config.autoConnectUser) {
    log(colors.cyan, "CONFIG", `Default user address: ${config.defaultUserAddress}`);
  }
  
  connect();
  
  // Auto-connect to user websocket if enabled
  if (config.autoConnectUser) {
    setTimeout(() => {
      connectUser(config.defaultUserAddress);
    }, 500); // Small delay to ensure main connection is established
  }
}

startClient();

rl.on("line", processCommand);
rl.on("close", () => {
  if (ws) ws.close();
  if (pingInterval) clearInterval(pingInterval);
  if (userPingInterval) clearInterval(userPingInterval);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (userWs) userWs.close();
  process.exit(0);
});