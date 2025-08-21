#!/usr/bin/env node

import { Command } from 'commander';
import Redis from 'ioredis';
import chalk from 'chalk';
import Table from 'cli-table3';

enum EventStreams {
  TRADES = 'trades',
  BALANCES = 'balances', 
  ORDERS = 'orders',
  DEPTH = 'depth',
  KLINES = 'klines',
  EXECUTION_REPORTS = 'execution_reports'
}

interface ConsumerGroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
  lag: number;
}

interface ConsumerInfo {
  name: string;
  pending: number;
  idle: number;
}

interface StreamStats {
  name: string;
  length: number;
  groups: ConsumerGroupInfo[];
  lastEntryId: string;
  firstEntryId: string;
}

class StreamMonitor {
  private redis: Redis;

  constructor(redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6380') {
    this.redis = new Redis(redisUrl);
  }

  async getStreamStats(streamName: string): Promise<StreamStats | null> {
    try {
      const streamInfo = await this.redis.xinfo('STREAM', streamName);
      const groupsInfo = await this.redis.xinfo('GROUPS', streamName);

      const groups: ConsumerGroupInfo[] = [];
      for (const groupInfo of groupsInfo) {
        // Find the lag field by looking for 'lag' key
        const lagIndex = groupInfo.indexOf('lag');
        const lagValue = lagIndex !== -1 ? groupInfo[lagIndex + 1] : 0;
        
        const group: ConsumerGroupInfo = {
          name: groupInfo[1],
          consumers: groupInfo[3],
          pending: groupInfo[5],
          lastDeliveredId: groupInfo[7],
          lag: lagValue || 0
        };
        
        groups.push(group);
      }

      return {
        name: streamName,
        length: streamInfo[1],
        groups,
        lastEntryId: streamInfo[5],
        firstEntryId: streamInfo[7]
      };
    } catch (error) {
      return null;
    }
  }

  async getConsumerStats(streamName: string, groupName: string): Promise<ConsumerInfo[]> {
    try {
      const consumersInfo = await this.redis.xinfo('CONSUMERS', streamName, groupName);
      const consumers: ConsumerInfo[] = [];

      for (const consumerInfo of consumersInfo) {
        consumers.push({
          name: consumerInfo[1],
          pending: consumerInfo[3],
          idle: consumerInfo[5]
        });
      }

      return consumers;
    } catch (error) {
      return [];
    }
  }

  async getPendingMessages(streamName: string, groupName: string, consumerName?: string) {
    try {
      if (consumerName) {
        return await this.redis.xpending(streamName, groupName, '-', '+', 10, consumerName);
      } else {
        return await this.redis.xpending(streamName, groupName, '-', '+', 10);
      }
    } catch (error) {
      return [];
    }
  }

  async showOverview(consumerGroupFilter?: string) {
    const filterText = consumerGroupFilter ? ` (${consumerGroupFilter} only)` : '';
    console.log(chalk.blue.bold(`\n📊 Redis Streams Overview${filterText}\n`));

    const table = new Table({
      head: [
        chalk.cyan('Stream'),
        chalk.cyan('Messages'),
        chalk.cyan('Groups'),
        chalk.cyan('Pending'),
        chalk.cyan('Lagging'),
        chalk.cyan('Status')
      ],
      colWidths: [20, 12, 8, 10, 10, 10]
    });

    let totalMessages = 0;
    let totalPending = 0;
    let totalLagging = 0;

    for (const streamName of Object.values(EventStreams)) {
      const stats = await this.getStreamStats(streamName);
      
      if (stats) {
        // Filter groups if consumerGroupFilter is provided
        const filteredGroups = consumerGroupFilter 
          ? stats.groups.filter(group => group.name === consumerGroupFilter)
          : stats.groups;

        const totalGroupPending = filteredGroups.reduce((sum, group) => sum + group.pending, 0);
        const totalGroupLagging = filteredGroups.reduce((sum, group) => sum + group.lag, 0);
        totalMessages += stats.length;
        totalPending += totalGroupPending;
        totalLagging += totalGroupLagging;

        const status = (totalGroupPending > 0 || totalGroupLagging > 0) ? 
          chalk.yellow('⚠️  LAG') : 
          chalk.green('✅ OK');

        const groupCount = consumerGroupFilter ? filteredGroups.length : stats.groups.length;

        table.push([
          streamName,
          stats.length.toLocaleString(),
          groupCount,
          totalGroupPending.toLocaleString(),
          totalGroupLagging.toLocaleString(),
          status
        ]);
      } else {
        table.push([
          streamName,
          chalk.red('N/A'),
          chalk.red('N/A'),
          chalk.red('N/A'),
          chalk.red('N/A'),
          chalk.red('❌ ERROR')
        ]);
      }
    }

    console.log(table.toString());
    
    console.log(chalk.green(`\n📈 Total Messages: ${totalMessages.toLocaleString()}`));
    console.log(chalk.yellow(`⏳ Total Pending: ${totalPending.toLocaleString()}`));
    console.log(chalk.red(`🚨 Total Lagging: ${totalLagging.toLocaleString()}`));
    console.log(chalk.blue(`📊 Processing Rate: ${((totalMessages - totalPending - totalLagging) / totalMessages * 100).toFixed(2)}%\n`));
  }

  async showStreamDetails(streamName: string) {
    const stats = await this.getStreamStats(streamName);
    
    if (!stats) {
      console.log(chalk.red(`❌ Stream '${streamName}' not found or error occurred\n`));
      return;
    }

    console.log(chalk.blue.bold(`\n📋 Stream Details: ${streamName}\n`));
    
    console.log(chalk.cyan('Stream Info:'));
    console.log(`  Length: ${stats.length.toLocaleString()} messages`);
    console.log(`  First Entry ID: ${stats.firstEntryId}`);
    console.log(`  Last Entry ID: ${stats.lastEntryId}\n`);

    if (stats.groups.length === 0) {
      console.log(chalk.yellow('⚠️  No consumer groups found\n'));
      return;
    }

    const groupTable = new Table({
      head: [
        chalk.cyan('Consumer Group'),
        chalk.cyan('Consumers'),
        chalk.cyan('Pending'),
        chalk.cyan('Lagging'),
        chalk.cyan('Last Delivered ID'),
        chalk.cyan('Status')
      ],
      colWidths: [25, 12, 10, 10, 20, 10]
    });

    for (const group of stats.groups) {
      const status = (group.pending > 0 || group.lag > 0) ? 
        chalk.yellow('⚠️  LAG') : 
        chalk.green('✅ OK');

      groupTable.push([
        group.name,
        group.consumers,
        group.pending.toLocaleString(),
        group.lag.toLocaleString(),
        group.lastDeliveredId,
        status
      ]);
    }

    console.log(groupTable.toString());
    console.log();
  }

  async showConsumerDetails(streamName: string, groupName: string) {
    const consumers = await this.getConsumerStats(streamName, groupName);
    
    if (consumers.length === 0) {
      console.log(chalk.red(`❌ No consumers found for group '${groupName}' in stream '${streamName}'\n`));
      return;
    }

    console.log(chalk.blue.bold(`\n👥 Consumer Details: ${streamName} -> ${groupName}\n`));

    const consumerTable = new Table({
      head: [
        chalk.cyan('Consumer Name'),
        chalk.cyan('Pending Messages'),
        chalk.cyan('Idle Time (ms)'),
        chalk.cyan('Status')
      ],
      colWidths: [30, 18, 15, 10]
    });

    for (const consumer of consumers) {
      const idleHours = Math.floor(consumer.idle / (1000 * 60 * 60));
      const idleDisplay = idleHours > 0 ? `${idleHours}h` : `${Math.floor(consumer.idle / 1000)}s`;
      
      const status = consumer.pending > 0 ? 
        chalk.yellow('⚠️  LAG') : 
        chalk.green('✅ OK');

      consumerTable.push([
        consumer.name,
        consumer.pending.toLocaleString(),
        idleDisplay,
        status
      ]);
    }

    console.log(consumerTable.toString());
    console.log();
  }

  async showPendingMessages(streamName: string, groupName: string, consumerName?: string) {
    const pending = await this.getPendingMessages(streamName, groupName, consumerName);
    
    if (pending.length === 0) {
      console.log(chalk.green(`✅ No pending messages found\n`));
      return;
    }

    const title = consumerName ? 
      `Pending Messages: ${streamName} -> ${groupName} -> ${consumerName}` :
      `Pending Messages: ${streamName} -> ${groupName}`;
    
    console.log(chalk.blue.bold(`\n⏳ ${title}\n`));

    const pendingTable = new Table({
      head: [
        chalk.cyan('Message ID'),
        chalk.cyan('Consumer'),
        chalk.cyan('Delivery Count'),
        chalk.cyan('Elapsed Time (ms)')
      ],
      colWidths: [25, 25, 15, 18]
    });

    for (const msg of pending) {
      const elapsedTime = Math.floor(msg[3] / 1000);
      const timeDisplay = elapsedTime > 3600 ? `${Math.floor(elapsedTime / 3600)}h` : `${elapsedTime}s`;
      
      pendingTable.push([
        msg[0],
        msg[1],
        msg[2],
        timeDisplay
      ]);
    }

    console.log(pendingTable.toString());
    console.log();
  }

  async watchStreams(interval: number = 5000, consumerGroupFilter?: string) {
    const filterText = consumerGroupFilter ? ` (${consumerGroupFilter} only)` : '';
    console.log(chalk.blue.bold(`🔄 Starting real-time monitoring${filterText} (Press Ctrl+C to stop)\n`));
    
    const monitor = async () => {
      console.clear();
      console.log(chalk.blue(`🕐 Last updated: ${new Date().toLocaleTimeString()}`));
      await this.showOverview(consumerGroupFilter);
      
      setTimeout(monitor, interval);
    };

    await monitor();
  }

  async close() {
    await this.redis.quit();
  }
}

const program = new Command();

program
  .name('stream-monitor')
  .description('Advanced Redis Streams monitoring CLI for CLOB Indexer')
  .version('1.0.0');

program
  .command('overview')
  .description('Show overview of all streams')
  .option('-g, --group <group-name>', 'Filter by consumer group (websocket-consumers, analytics-consumers)')
  .action(async (options) => {
    const monitor = new StreamMonitor();
    await monitor.showOverview(options.group);
    await monitor.close();
  });

program
  .command('stream')
  .description('Show detailed information about a specific stream')
  .argument('<stream-name>', 'Name of the stream (trades, balances, orders, depth, klines, execution_reports)')
  .action(async (streamName) => {
    const monitor = new StreamMonitor();
    await monitor.showStreamDetails(streamName);
    await monitor.close();
  });

program
  .command('consumers')
  .description('Show consumer details for a stream and group')
  .argument('<stream-name>', 'Name of the stream')
  .argument('<group-name>', 'Name of the consumer group')
  .action(async (streamName, groupName) => {
    const monitor = new StreamMonitor();
    await monitor.showConsumerDetails(streamName, groupName);
    await monitor.close();
  });

program
  .command('pending')
  .description('Show pending messages for a consumer group')
  .argument('<stream-name>', 'Name of the stream')
  .argument('<group-name>', 'Name of the consumer group')
  .option('-c, --consumer <consumer-name>', 'Specific consumer name')
  .action(async (streamName, groupName, options) => {
    const monitor = new StreamMonitor();
    await monitor.showPendingMessages(streamName, groupName, options.consumer);
    await monitor.close();
  });

program
  .command('watch')
  .description('Real-time monitoring of all streams')
  .option('-i, --interval <seconds>', 'Update interval in seconds', '5')
  .option('-g, --group <group-name>', 'Filter by consumer group (websocket-consumers, analytics-consumers)')
  .action(async (options) => {
    const monitor = new StreamMonitor();
    const interval = parseInt(options.interval) * 1000;
    
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\n👋 Stopping monitor...'));
      await monitor.close();
      process.exit(0);
    });
    
    await monitor.watchStreams(interval, options.group);
  });

program
  .command('websocket')
  .description('Monitor WebSocket service consumption only')
  .option('-i, --interval <seconds>', 'Update interval in seconds (for watch mode)', '5')
  .option('-w, --watch', 'Enable real-time monitoring')
  .action(async (options) => {
    const monitor = new StreamMonitor();
    
    if (options.watch) {
      const interval = parseInt(options.interval) * 1000;
      
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n👋 Stopping WebSocket monitor...'));
        await monitor.close();
        process.exit(0);
      });
      
      await monitor.watchStreams(interval, 'websocket-consumers');
    } else {
      await monitor.showOverview('websocket-consumers');
      await monitor.close();
    }
  });

program
  .command('analytics')
  .description('Monitor Analytics service consumption only')
  .option('-i, --interval <seconds>', 'Update interval in seconds (for watch mode)', '5')
  .option('-w, --watch', 'Enable real-time monitoring')
  .action(async (options) => {
    const monitor = new StreamMonitor();
    
    if (options.watch) {
      const interval = parseInt(options.interval) * 1000;
      
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n👋 Stopping Analytics monitor...'));
        await monitor.close();
        process.exit(0);
      });
      
      await monitor.watchStreams(interval, 'analytics-consumers');
    } else {
      await monitor.showOverview('analytics-consumers');
      await monitor.close();
    }
  });

program.parse();