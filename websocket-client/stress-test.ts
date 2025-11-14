import { WebSocket } from "ws";
import * as os from "os";

interface StressTestConfig {
  url: string;
  numClients: number;
  streams: string[];
  userAddresses?: string[];
  pingInterval: number;
  connectionDelay: number;
  duration?: number;
}

interface ClientStats {
  id: number;
  connected: boolean;
  messagesReceived: number;
  lastMessageTime: number;
  subscriptions: string[];
  userSocket?: boolean;
  latestMessages: Array<{ timestamp: number, data: any }>; // Store latest messages
}

interface SystemStats {
  timestamp: number;
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  systemMemory: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  networkConnections: number;
  uptime: number;
}

class StressTestClient {
  private ws: WebSocket | null = null;
  private userWs: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  public stats: ClientStats;
  private config: StressTestConfig;

  constructor(id: number, config: StressTestConfig) {
    this.config = config;
    this.stats = {
      id,
      connected: false,
      messagesReceived: 0,
      lastMessageTime: 0,
      subscriptions: [],
      userSocket: false,
      latestMessages: [] // Initialize empty array for latest messages
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.url);

      this.ws.on("open", () => {
        this.stats.connected = true;
        console.log(`[Client ${this.stats.id}] Connected`);

        // Start ping interval
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ method: "PING" }));
          }
        }, this.config.pingInterval);

        // Subscribe to streams
        this.subscribeToStreams();
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        this.stats.messagesReceived++;
        const timestamp = Date.now();
        this.stats.lastMessageTime = timestamp;

        try {
          const message = JSON.parse(data.toString());

          // Debug logging to understand message structure
          if (process.env.DEBUG_WS_MESSAGES === 'true') {
            console.log(`[Client ${this.stats.id}] Message:`, JSON.stringify(message, null, 2));
          }

          // Store the latest message with timestamp
          this.stats.latestMessages.push({
            timestamp,
            data: message
          });
          // Keep only the 5 most recent messages
          if (this.stats.latestMessages.length > 5) {
            this.stats.latestMessages.shift();
          }
        } catch (error) {
          console.error(`[Client ${this.stats.id}] Parse error:`, error);
        }
      });

      this.ws.on("close", () => {
        this.stats.connected = false;
        console.log(`[Client ${this.stats.id}] Disconnected`);
        if (this.pingInterval) clearInterval(this.pingInterval);
      });

      this.ws.on("error", (error) => {
        console.error(`[Client ${this.stats.id}] Error:`, error.message);
        this.stats.connected = false;
        reject(error);
      });
    });
  }

  async connectUser(address: string): Promise<void> {
    if (!address) return;

    return new Promise((resolve, reject) => {
      const url = `${this.config.url.replace(/\/$/, "")}/ws/${address.toLowerCase()}`;
      this.userWs = new WebSocket(url);
      this.stats.userSocket = true;

      this.userWs.on("open", () => {
        console.log(`[Client ${this.stats.id}] User socket connected for ${address}`);
        resolve();
      });

      this.userWs.on("message", (data: Buffer) => {
        this.stats.messagesReceived++;
        const timestamp = Date.now();
        this.stats.lastMessageTime = timestamp;

        try {
          const message = JSON.parse(data.toString());
          // Store the latest user message with timestamp
          this.stats.latestMessages.push({
            timestamp,
            data: message
          });
          // Keep only the 5 most recent messages
          if (this.stats.latestMessages.length > 5) {
            this.stats.latestMessages.shift();
          }
        } catch (error) {
          console.error(`[Client ${this.stats.id}] User parse error:`, error);
        }
      });

      this.userWs.on("close", () => {
        console.log(`[Client ${this.stats.id}] User socket closed`);
      });

      this.userWs.on("error", (error) => {
        console.error(`[Client ${this.stats.id}] User socket error:`, error.message);
        reject(error);
      });
    });
  }

  private subscribeToStreams(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.config.streams.forEach(stream => {
      this.ws!.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: [stream],
        id: Date.now() + Math.random()
      }));
      this.stats.subscriptions.push(stream);
      console.log(`[Client ${this.stats.id}] Subscribed to ${stream}`);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.userWs) {
      this.userWs.close();
      this.userWs = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.stats.connected = false;
  }
}

class StressTestRunner {
  private clients: StressTestClient[] = [];
  private config: StressTestConfig;
  private startTime: number = 0;
  private statsInterval: NodeJS.Timeout | null = null;
  private systemStatsHistory: SystemStats[] = [];
  private initialCpuUsage: NodeJS.CpuUsage | null = null;

  constructor(config: StressTestConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    console.log(`\n🚀 Starting stress test with ${this.config.numClients} clients`);
    console.log(`📡 Server: ${this.config.url}`);
    console.log(`📊 Streams: ${this.config.streams.join(", ")}`);
    if (this.config.userAddresses?.length) {
      console.log(`👤 User addresses: ${this.config.userAddresses.length} provided`);
    }
    console.log(`⏱️  Connection delay: ${this.config.connectionDelay}ms`);
    if (this.config.duration) {
      console.log(`⏰ Duration: ${this.config.duration} seconds`);
    }
    console.log("");

    this.startTime = Date.now();
    this.initialCpuUsage = process.cpuUsage();

    // Create clients
    for (let i = 0; i < this.config.numClients; i++) {
      const client = new StressTestClient(i + 1, this.config);
      this.clients.push(client);
    }

    // Connect clients with delay
    for (let i = 0; i < this.clients.length; i++) {
      try {
        const client = this.clients[i];
        if (client) {
          await client.connect();

          // Connect user socket if addresses provided - cycle through addresses if more clients than addresses
          if (this.config.userAddresses && this.config.userAddresses.length > 0) {
            const addressIndex = i % this.config.userAddresses.length;
            const address = this.config.userAddresses[addressIndex];
            if (address) {
              await client.connectUser(address);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to connect client ${i + 1}:`, error);
      }

      // Add delay between client connections if configured
      if (i < this.clients.length - 1 && this.config.connectionDelay) {
        const delay = this.config.connectionDelay;
        console.log(`Waiting ${delay}ms before connecting next client...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Start stats reporting
    this.startStatsReporting();

    // Run for specified duration or indefinitely
    if (this.config.duration) {
      setTimeout(() => {
        this.stop();
      }, this.config.duration * 1000);
    } else {
      console.log("Press Ctrl+C to stop the test");
    }
  }

  private startStatsReporting(): void {
    this.statsInterval = setInterval(() => {
      this.printStats();
    }, 5000); // Print stats every 5 seconds
  }

  private printStats(): void {
    const connectedClients = this.clients.filter(c => c.stats.connected).length;
    const totalMessages = this.clients.reduce((sum, c) => sum + c.stats.messagesReceived, 0);
    const avgMessagesPerClient = totalMessages / this.clients.length;
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const messagesPerSecond = totalMessages / elapsedSeconds;

    // Collect current system stats
    const systemStats = this.collectSystemStats();
    this.systemStatsHistory.push(systemStats);

    // Clear screen and draw htop-style dashboard
    this.clearScreen();
    this.drawHeader(elapsedSeconds);
    this.drawOverview(connectedClients, totalMessages, avgMessagesPerClient, messagesPerSecond);
    this.drawSystemStats(systemStats);
    this.drawConnectionDetails();
    this.drawClientStats();
    this.drawRecentMessages();
    this.drawFooter();
  }

  private clearScreen(): void {
    console.clear();
    // Move cursor to top-left
    process.stdout.write('\x1b[H');
  }

  private drawHeader(elapsedSeconds: number): void {
    const title = 'ScaleX WebSocket Stress Test Dashboard';
    const uptime = this.formatUptime(elapsedSeconds);
    const timestamp = new Date().toLocaleTimeString();

    const width = 78;
    console.log('┌' + '─'.repeat(width) + '┐');

    const titlePadding = width - 2 - title.length;
    console.log(`│ ${title}${' '.repeat(titlePadding)} │`);

    // Format second line with proper alignment
    const leftPart = `Uptime: ${uptime}`;
    const rightPart = `Time: ${timestamp}`;
    const middleSpaces = width - 2 - leftPart.length - rightPart.length;
    console.log(`│ ${leftPart}${' '.repeat(Math.max(0, middleSpaces))}${rightPart} │`);
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawOverview(connected: number, totalMsgs: number, avgMsgs: number, msgRate: number): void {
    const width = 78;
    const content = [
      `Clients: ${connected}/${this.config.numClients}`,
      `Messages: ${totalMsgs}`,
      `Avg/Client: ${avgMsgs.toFixed(1)}`,
      `Rate: ${msgRate.toFixed(2)}/s`
    ].join(' │ ');

    const overviewPadding = width - 2 - 8; // "Overview" = 8 chars
    console.log(`│ Overview${' '.repeat(overviewPadding)} │`);

    const contentPadding = width - 2 - content.length;
    console.log(`│ ${content}${' '.repeat(contentPadding)} │`);
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawSystemStats(systemStats: SystemStats): void {
    const width = 78;
    const memUsed = this.formatBytes(systemStats.memoryUsage.heapUsed);
    const memTotal = this.formatBytes(systemStats.memoryUsage.heapTotal);
    const rss = this.formatBytes(systemStats.memoryUsage.rss);
    const cpuUser = this.formatCpuTime(systemStats.cpuUsage.user);
    const cpuSys = this.formatCpuTime(systemStats.cpuUsage.system);

    const titlePadding = width - 2 - 16; // "System Resources" = 16 chars
    console.log(`│ System Resources${' '.repeat(titlePadding)} │`);

    const memPart = `Memory: ${memUsed}/${memTotal}`;
    const rssPart = `RSS: ${rss}`;
    const cpuPart = `CPU: ${cpuUser}+${cpuSys}`;
    const content = `${memPart} │ ${rssPart} │ ${cpuPart}`;

    const contentPadding = width - 2 - content.length;
    console.log(`│ ${content}${' '.repeat(contentPadding)} │`);
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawConnectionDetails(): void {
    const width = 78;
    const url = this.config.url;
    const streams = this.config.streams.join(', ');

    const titlePadding = width - 2 - 18; // "Connection Details" = 18 chars
    console.log(`│ Connection Details${' '.repeat(titlePadding)} │`);

    const urlContent = `URL: ${url}`;
    const urlPadding = width - 2 - urlContent.length;
    console.log(`│ ${urlContent}${' '.repeat(urlPadding)} │`);

    // Handle long stream names with proper wrapping
    const streamPrefix = 'Streams: ';
    const maxStreamWidth = width - 2 - streamPrefix.length;

    if (streams.length <= maxStreamWidth) {
      const streamContent = `${streamPrefix}${streams}`;
      const streamPadding = width - 2 - streamContent.length;
      console.log(`│ ${streamContent}${' '.repeat(streamPadding)} │`);
    } else {
      const firstLine = streams.substring(0, maxStreamWidth);
      const firstContent = `${streamPrefix}${firstLine}`;
      const firstPadding = width - 2 - firstContent.length;
      console.log(`│ ${firstContent}${' '.repeat(firstPadding)} │`);

      if (streams.substring(maxStreamWidth).length > 0) {
        const secondLine = streams.substring(maxStreamWidth);
        const maxSecondWidth = width - 2 - 9; // 9 spaces for continuation
        const continuation = `         ${secondLine.substring(0, maxSecondWidth)}`;
        const contPadding = width - 2 - continuation.length;
        console.log(`│ ${continuation}${' '.repeat(contPadding)} │`);
      }
    }
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawClientStats(): void {
    const width = 78;

    const titlePadding = width - 2 - 13; // "Client Status" = 13 chars
    console.log(`│ Client Status${' '.repeat(titlePadding)} │`);

    const headerContent = "ID │ Status │ Messages │ Subs │ Type │ Last Activity";
    const headerPadding = width - 2 - headerContent.length;
    console.log(`│ ${headerContent}${' '.repeat(headerPadding)} │`);
    console.log('├' + '─'.repeat(width) + '┤');

    // Show up to 10 clients in a compact table format
    this.clients.slice(0, 10).forEach(client => {
      const id = client.stats.id.toString().padStart(2);
      const status = client.stats.connected ? ' ✅   ' : ' ❌   '; // 6 chars to match "Status"
      const messages = client.stats.messagesReceived.toString().padStart(8); // 8 chars to match "Messages"
      const subs = client.stats.subscriptions.length.toString().padStart(4); // 4 chars to match "Subs"
      const type = client.stats.userSocket ? 'User' : 'Pub '; // 4 chars to match "Type"
      const lastActivity = client.stats.lastMessageTime > 0 ?
        `${((Date.now() - client.stats.lastMessageTime) / 1000).toFixed(0)}s ago`.padEnd(13) : // 13 chars to match "Last Activity"
        '     -      ';

      // Build the row with exact spacing to match header: "ID │ Status │ Messages │ Subs │ Type │ Last Activity"
      const row = `${id} │ ${status} │ ${messages} │ ${subs} │ ${type} │ ${lastActivity}`;
      const rowPadding = width - 2 - row.length;
      console.log(`│ ${row}${' '.repeat(rowPadding)} │`);
    });

    if (this.clients.length > 10) {
      const moreInfo = `... and ${this.clients.length - 10} more clients`;
      const morePadding = width - 2 - moreInfo.length;
      console.log(`│ ${moreInfo}${' '.repeat(morePadding)} │`);
    }
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawRecentMessages(): void {
    const width = 78;
    const titlePadding = width - 2 - 24; // "Recent Messages (Last 5)" = 24 chars
    console.log(`│ Recent Messages (Last 5)${' '.repeat(titlePadding)} │`);

    // Collect all recent messages from all clients
    const allMessages: Array<{ timestamp: number, clientId: number, data: any }> = [];
    this.clients.forEach(client => {
      client.stats.latestMessages.forEach(msg => {
        allMessages.push({
          timestamp: msg.timestamp,
          clientId: client.stats.id,
          data: msg.data
        });
      });
    });

    // Sort by timestamp (newest first) and take top 5
    const recentMessages = allMessages
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    if (recentMessages.length === 0) {
      const noPadding = width - 2 - 27; // "No messages received yet..." = 27 chars
      console.log(`│ No messages received yet...${' '.repeat(noPadding)} │`);
    } else {
      recentMessages.forEach(msg => {
        const timeAgo = `${((Date.now() - msg.timestamp) / 1000).toFixed(0)}s`;
        const clientId = `C${msg.clientId}`;
        // Comprehensive message type parsing covering all WebSocket server message types
        let eventType = 'unknown';
        let stream = 'system';

        if (msg.data) {
          // Check for subscription control messages (SUBSCRIBE, UNSUBSCRIBE, LIST_SUBSCRIPTIONS, PING, PONG)
          if (msg.data.method) {
            eventType = msg.data.method;
            stream = 'system';
          }
          // Check for market data stream events (pushTrade, pushDepth, pushKline, pushMiniTicker)
          else if (msg.data.data && msg.data.data.e) {
            eventType = msg.data.data.e;
            stream = msg.data.stream || 'market';
          }
          // Check for stream-based events by analyzing stream name
          else if (msg.data.stream) {
            stream = msg.data.stream;
            if (msg.data.stream.includes('@trade')) {
              eventType = 'trade';
            } else if (msg.data.stream.includes('@depth')) {
              eventType = 'depthUpdate';
            } else if (msg.data.stream.includes('@kline')) {
              eventType = 'kline';
            } else if (msg.data.stream.includes('@miniTicker')) {
              eventType = '24hrMiniTicker';
            } else {
              eventType = 'stream';
            }
          }
          // Check for user-specific messages (pushExecutionReport, pushBalanceUpdate)
          else if (msg.data.executionType || msg.data.orderId || msg.data.symbol) {
            eventType = 'executionReport';
            stream = 'user';
          }
          else if (msg.data.balanceUpdate || msg.data.asset || msg.data.wallet) {
            eventType = 'balanceUpdate';
            stream = 'user';
          }
          // Check for heartbeat/ping messages
          else if (msg.data.ping || msg.data.pong) {
            eventType = 'ping';
            stream = 'heartbeat';
          }
          // Check for error messages
          else if (msg.data.error) {
            eventType = 'error';
            stream = 'system';
          }
          // Check for result messages (subscription responses)
          else if (msg.data.result !== undefined) {
            eventType = 'result';
            stream = 'system';
          }
          // Check if it's a simple string message
          else if (typeof msg.data === 'string') {
            if (msg.data.toLowerCase().includes('pong')) {
              eventType = 'pong';
              stream = 'heartbeat';
            } else {
              eventType = 'message';
              stream = 'system';
            }
          }
          // Additional checks for direct event type in data
          else if (msg.data.e) {
            eventType = msg.data.e;
            if (msg.data.e === 'trade') stream = 'market';
            else if (msg.data.e === 'depthUpdate') stream = 'market';
            else if (msg.data.e === 'kline') stream = 'market';
            else if (msg.data.e === '24hrMiniTicker') stream = 'market';
            else stream = 'market';
          }
        }

        const line = `${timeAgo.padStart(3)} ago │ ${clientId.padEnd(3)} │ ${eventType.padEnd(12)} │ ${stream.substring(0, 20)}`;
        const linePadding = width - 2 - line.length;
        console.log(`│ ${line}${' '.repeat(linePadding)} │`);
      });
    }
    console.log('├' + '─'.repeat(width) + '┤');
  }

  private drawFooter(): void {
    const width = 78;
    const memGrowth = this.getMemoryGrowth();
    const pingInterval = `${this.config.pingInterval / 1000}s`;

    const titlePadding = width - 2 - 11; // "Performance" = 11 chars
    console.log(`│ Performance${' '.repeat(titlePadding)} │`);

    const leftPart = `PING Interval: ${pingInterval}`;
    const rightPart = `Memory Growth: ${memGrowth}`;
    const middleSpaces = width - 2 - leftPart.length - rightPart.length;
    console.log(`│ ${leftPart}${' '.repeat(Math.max(0, middleSpaces))}${rightPart} │`);

    console.log('└' + '─'.repeat(width) + '┘');
    console.log('\nPress Ctrl+C to stop the stress test');
  }

  private getMemoryGrowth(): string {
    if (this.systemStatsHistory.length < 2) return 'calculating...';

    const current = this.systemStatsHistory[this.systemStatsHistory.length - 1];
    const previous = this.systemStatsHistory[this.systemStatsHistory.length - 2];

    if (!current || !previous || !current.memoryUsage || !previous.memoryUsage) return 'N/A';

    const growth = current.memoryUsage.rss - previous.memoryUsage.rss;
    const growthPerSec = growth / 5; // 5 second intervals

    if (Math.abs(growth) < 1024 * 1024) return 'stable';

    const sign = growth > 0 ? '+' : '';
    return `${sign}${this.formatBytes(Math.abs(growthPerSec))}/s`;
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }


  private collectSystemStats(): SystemStats {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.initialCpuUsage || undefined);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      timestamp: Date.now(),
      memoryUsage: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      systemMemory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percentage: (usedMem / totalMem) * 100,
      },
      networkConnections: this.clients.filter(c => c.stats.connected).length +
        this.clients.filter(c => c.stats.userSocket).length,
      uptime: process.uptime(),
    };
  }

  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  private formatCpuTime(microseconds: number): string {
    const seconds = microseconds / 1000000;
    return seconds.toFixed(2) + 's';
  }

  stop(): void {
    console.log("\n🛑 Stopping stress test...");

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.clients.forEach(client => client.disconnect());

    // Final stats and performance summary
    setTimeout(() => {
      this.printStats();
      this.printPerformanceSummary();
      console.log("\n✅ Stress test completed");
      process.exit(0);
    }, 1000);
  }

  private printPerformanceSummary(): void {
    if (this.systemStatsHistory.length === 0) return;

    console.log("\n📊 PERFORMANCE SUMMARY & SERVER SIZING RECOMMENDATIONS");
    console.log("=" + "=".repeat(60));

    const firstStats = this.systemStatsHistory[0];
    const lastStats = this.systemStatsHistory[this.systemStatsHistory.length - 1];

    if (!firstStats || !lastStats) return;

    const testDurationSeconds = (lastStats.timestamp - firstStats.timestamp) / 1000;

    // Memory analysis
    const peakMemory = Math.max(...this.systemStatsHistory.map(s => s.memoryUsage.rss));
    const avgMemory = this.systemStatsHistory.reduce((sum, s) => sum + s.memoryUsage.rss, 0) / this.systemStatsHistory.length;
    const memoryGrowth = lastStats.memoryUsage.rss - firstStats.memoryUsage.rss;
    const memoryPerClient = peakMemory / this.config.numClients;

    console.log(`\n🧠 Memory Analysis:`);
    console.log(`   Clients tested: ${this.config.numClients}`);
    console.log(`   Peak memory: ${this.formatBytes(peakMemory)}`);
    console.log(`   Average memory: ${this.formatBytes(avgMemory)}`);
    console.log(`   Memory per client: ${this.formatBytes(memoryPerClient)}`);
    console.log(`   Total growth: ${this.formatBytes(memoryGrowth)}`);

    // Performance projections
    const memoryFor1000 = memoryPerClient * 1000;
    const memoryFor5000 = memoryPerClient * 5000;
    const memoryFor10000 = memoryPerClient * 10000;

    console.log(`\n📈 Scaling Projections:`);
    console.log(`   1,000 clients: ~${this.formatBytes(memoryFor1000)}`);
    console.log(`   5,000 clients: ~${this.formatBytes(memoryFor5000)}`);
    console.log(`   10,000 clients: ~${this.formatBytes(memoryFor10000)}`);

    // Server recommendations
    console.log(`\n🖥️  Server Sizing Recommendations:`);

    const recommendRAM = (clients: number) => {
      const estimatedMemory = memoryPerClient * clients;
      const osOverhead = 2 * 1024 * 1024 * 1024; // 2GB for OS
      const bufferMultiplier = 2; // 100% buffer
      return (estimatedMemory + osOverhead) * bufferMultiplier;
    };

    console.log(`   For 1,000 clients: ${this.formatBytes(recommendRAM(1000))} RAM minimum`);
    console.log(`   For 5,000 clients: ${this.formatBytes(recommendRAM(5000))} RAM minimum`);
    console.log(`   For 10,000 clients: ${this.formatBytes(recommendRAM(10000))} RAM minimum`);

    // Network analysis
    const totalConnections = this.config.numClients * 2; // public + user sockets
    console.log(`\n🌐 Network Analysis:`);
    console.log(`   Total connections: ${totalConnections} (${this.config.numClients} clients × 2 sockets)`);
    console.log(`   Connection overhead: ~${Math.round(totalConnections * 4)}KB (file descriptors)`);

    // CPU analysis
    const totalCpuTime = lastStats.cpuUsage.user + lastStats.cpuUsage.system;
    const cpuPerSecond = totalCpuTime / testDurationSeconds / 1000000; // convert to seconds
    console.log(`\n⚙️  CPU Analysis:`);
    console.log(`   Total CPU time: ${this.formatCpuTime(totalCpuTime)}`);
    console.log(`   CPU usage rate: ${cpuPerSecond.toFixed(2)}s/s (${(cpuPerSecond * 100).toFixed(1)}%)`);

    // Warnings
    console.log(`\n⚠️  Important Notes:`);
    console.log(`   • These estimates are for websocket clients only`);
    console.log(`   • Actual server load depends on message throughput`);
    console.log(`   • Add 50-100% buffer for production workloads`);
    console.log(`   • Monitor actual performance under realistic traffic patterns`);
    console.log(`   • Consider horizontal scaling for >10k concurrent connections`);

    console.log("\n" + "=".repeat(61));
  }
}

// Synchronized timing configuration
// Should align with system monitor timing for smooth metrics
const TIMING_SYNC = {
  baseUnit: 10, // 10 seconds base
  monitoringInterval: 30, // 3x base unit (matches system monitor default)
  pingInterval: 60, // 6x base unit (2x monitoring interval)
};

// Default configuration
const defaultConfig: StressTestConfig = {
  url: process.env.WEBSOCKET_URL || 'wss://core-devnet.scalex.money',
  numClients: 10,
  streams: ['gswethgsusdc@trade', 'gswethgsusdc@kline_1m', 'gswethgsusdc@depth', 'gswethgsusdc@miniTicker'],
  pingInterval: TIMING_SYNC.pingInterval * 1000, // 60 seconds in ms
  connectionDelay: 100, // 100ms between connections
  duration: undefined // Run indefinitely
};

// Parse command line arguments
async function parseArgs(): Promise<StressTestConfig> {
  const args = process.argv.slice(2);
  const config = { ...defaultConfig };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--clients':
      case '-c':
        config.numClients = parseInt(args[++i] || '10') || 10;
        break;
      case '--url':
      case '-u':
        config.url = args[++i] || config.url;
        break;
      case '--streams':
      case '-s':
        config.streams = args[++i]?.split(',') || config.streams;
        break;
      case '--duration':
      case '-d':
        config.duration = parseInt(args[++i] || '0');
        break;
      case '--delay':
        config.connectionDelay = parseInt(args[++i] || '100') || 100;
        break;
      case '--users':
        const userFile = args[++i];
        if (userFile) {
          try {
            const fs = await import('fs');
            const addresses = fs.readFileSync(userFile, 'utf8')
              .split('\n')
              .map((line: string) => line.trim())
              .filter((line: string) => line.length > 0);
            config.userAddresses = addresses;
          } catch (error) {
            console.error('Failed to read user addresses file:', error);
          }
        }
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: npm run stress-test [options]

Options:
  -c, --clients <n>      Number of concurrent clients (default: 10)
  -u, --url <url>        WebSocket server URL (default: wss://core-devnet.scalex.money)
  -s, --streams <list>   Comma-separated list of streams (default: gswethgsusdc@trade,gswethgsusdc@depth)
  -d, --duration <sec>   Test duration in seconds (default: unlimited)
  --delay <ms>           Delay between connections in ms (default: 100)
  --users <file>         File containing user addresses (one per line)
  -h, --help             Show this help

Examples:
  npm run stress-test -c 50 -d 60
  npm run stress-test --clients 100 --streams "gswethgsusdc@trade,gswethgsusdc@kline_1m"
  npm run stress-test --users ./user-addresses.txt -c 100
        `);
        process.exit(0);
    }
  }

  return config;
}

// Handle graceful shutdown
let globalRunner: StressTestRunner | null = null;

process.on('SIGINT', () => {
  console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
  if (globalRunner) {
    globalRunner.stop();
  } else {
    process.exit(0);
  }
});

// Main execution
(async () => {
  const config = await parseArgs();
  const runner = new StressTestRunner(config);
  globalRunner = runner;
  await runner.run().catch(console.error);
})();