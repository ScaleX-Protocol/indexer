#!/usr/bin/env tsx

import { spawn } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

interface MenuItem {
  name: string;
  value: string;
  description: string;
  command: string;
  dangerous?: boolean;
}

interface MenuCategory {
  title: string;
  emoji: string;
  items: MenuItem[];
}

const menuCategories: MenuCategory[] = [
  {
    title: 'Infrastructure Only',
    emoji: '🗄️',
    items: [
      {
        name: 'Start Core Infrastructure',
        value: 'infra-core',
        description: 'Start PostgreSQL and Redis only (minimal setup)',
        command: 'docker-compose -f ../docker-compose.microservices.yml up -d postgres redis'
      },
      {
        name: 'Start Full Infrastructure',
        value: 'infra-full',
        description: 'Start databases + monitoring (Prometheus, Grafana, Redis Commander)',
        command: 'docker-compose -f ../docker-compose.microservices.yml up -d postgres redis prometheus grafana redis-commander'
      },
      {
        name: 'Stop Infrastructure',
        value: 'infra-stop',
        description: 'Stop all infrastructure containers',
        command: 'docker-compose -f ../docker-compose.microservices.yml down'
      },
      {
        name: 'Infrastructure Status',
        value: 'infra-status',
        description: 'Check infrastructure container status',
        command: 'docker-compose -f ../docker-compose.microservices.yml ps postgres redis prometheus grafana redis-commander'
      },
      {
        name: 'Reset Databases (Dangerous)',
        value: 'infra-reset',
        description: 'Stop infrastructure and remove all data volumes',
        command: 'docker-compose -f ../docker-compose.microservices.yml down -v',
        dangerous: true
      }
    ]
  },
  {
    title: 'Local Services (Hybrid Dev)',
    emoji: '💻',
    items: [
      {
        name: 'Run All Services Locally',
        value: 'local-all',
        description: 'Run indexer, websocket, and analytics services locally in parallel',
        command: 'local-services-all'
      },
      {
        name: 'Run Indexer Only',
        value: 'local-indexer',
        description: 'Run the core CLOB indexer service locally',
        command: 'npm run dev'
      },
      {
        name: 'Run WebSocket Service',
        value: 'local-websocket',
        description: 'Run the WebSocket service locally',
        command: 'cd websocket-service && npm run dev'
      },
      {
        name: 'Run Analytics Service',
        value: 'local-analytics',
        description: 'Run the Analytics service locally',
        command: 'cd ../analytics-service && npm run dev'
      },
      {
        name: 'Install All Dependencies',
        value: 'local-install',
        description: 'Install dependencies for all services',
        command: 'npm install && cd ../websocket-service && npm install && cd ../analytics-service && npm install && cd ../scripts'
      }
    ]
  },
  {
    title: 'Microservices (Docker)',
    emoji: '🏗️',
    items: [
      {
        name: 'Setup Environment',
        value: 'ms-setup',
        description: 'Setup environment files and dependencies for all services',
        command: './scripts/microservices.sh setup'
      },
      {
        name: 'Build All Services',
        value: 'ms-build',
        description: 'Build all microservices (WebSocket, Analytics)',
        command: './scripts/microservices.sh build'
      },
      {
        name: 'Start All Services',
        value: 'ms-start',
        description: 'Start complete microservices stack',
        command: './scripts/microservices.sh start'
      },
      {
        name: 'Start Development Mode',
        value: 'ms-dev',
        description: 'Start all services with development tools (Redis Commander)',
        command: './scripts/microservices.sh dev'
      },
      {
        name: 'Stop All Services',
        value: 'ms-stop',
        description: 'Stop all microservices',
        command: './scripts/microservices.sh stop'
      },
      {
        name: 'Restart All Services',
        value: 'ms-restart',
        description: 'Restart all microservices',
        command: './scripts/microservices.sh restart'
      },
      {
        name: 'Service Status & Health',
        value: 'ms-status',
        description: 'Check status and health of all services',
        command: './scripts/microservices.sh status'
      },
      {
        name: 'View All Logs',
        value: 'ms-logs',
        description: 'View logs from all services',
        command: './scripts/microservices.sh logs'
      },
      {
        name: 'Clean Up (Dangerous)',
        value: 'ms-clean',
        description: 'Stop services and remove all volumes/containers',
        command: './scripts/microservices.sh clean',
        dangerous: true
      }
    ]
  },
  {
    title: 'Development',
    emoji: '🚀',
    items: [
      {
        name: 'Start Development Server',
        value: 'dev',
        description: 'Start Ponder in development mode with hot reload',
        command: 'pnpm dev'
      },
      {
        name: 'Start Production Server',
        value: 'start',
        description: 'Start Ponder in production mode',
        command: 'pnpm start'
      },
      {
        name: 'Generate Code',
        value: 'codegen',
        description: 'Generate TypeScript code from schema and config',
        command: 'pnpm codegen'
      }
    ]
  },
  {
    title: 'Database',
    emoji: '🗄️',
    items: [
      {
        name: 'Database Operations',
        value: 'db',
        description: 'Run Ponder database operations (migrate, reset, etc.)',
        command: 'pnpm db'
      }
    ]
  },
  {
    title: 'Code Quality',
    emoji: '✨',
    items: [
      {
        name: 'Lint Code',
        value: 'lint',
        description: 'Run ESLint to check for code quality issues',
        command: 'pnpm lint'
      },
      {
        name: 'Type Check',
        value: 'typecheck',
        description: 'Run TypeScript type checking',
        command: 'pnpm typecheck'
      }
    ]
  },
  {
    title: 'Monitoring & Debugging',
    emoji: '📊',
    items: [
      {
        name: 'Check Metrics',
        value: 'metrics',
        description: 'Check current system metrics',
        command: 'pnpm metrics'
      },
      {
        name: 'Start Metrics Monitor',
        value: 'metrics:start',
        description: 'Start the metrics monitoring system',
        command: 'pnpm metrics:start'
      },
      {
        name: 'Watch Metrics',
        value: 'metrics:watch',
        description: 'Watch metrics in real-time',
        command: 'pnpm metrics:watch'
      },
      {
        name: 'Metrics Dashboard',
        value: 'metrics:dashboard',
        description: 'Open the metrics dashboard',
        command: 'pnpm metrics:dashboard'
      },
      {
        name: 'System Monitor',
        value: 'monitor',
        description: 'Run system resource monitoring',
        command: 'pnpm monitor'
      },
      {
        name: 'Open Grafana Dashboard',
        value: 'open-grafana',
        description: 'Open Grafana monitoring dashboard (admin/admin)',
        command: 'open http://localhost:3000'
      },
      {
        name: 'Open Prometheus',
        value: 'open-prometheus',
        description: 'Open Prometheus metrics collection',
        command: 'open http://localhost:9090'
      },
      {
        name: 'Open Redis Commander',
        value: 'open-redis-commander',
        description: 'Open Redis Commander for debugging streams',
        command: 'open http://localhost:8081'
      },
      {
        name: 'Redis CLI Access',
        value: 'redis-cli',
        description: 'Access Redis CLI for debugging',
        command: 'docker-compose -f docker-compose.microservices.yml exec redis redis-cli'
      },
      {
        name: 'PostgreSQL CLI Access',
        value: 'postgres-cli',
        description: 'Access PostgreSQL CLI for database queries',
        command: 'docker-compose -f docker-compose.microservices.yml exec postgres psql -U postgres -d ponder'
      }
    ]
  },
  {
    title: 'API Testing',
    emoji: '🔌',
    items: [
      {
        name: 'Test WebSocket Health',
        value: 'test-ws-health',
        description: 'Test WebSocket service health endpoint',
        command: 'curl -s http://localhost:8080/health | jq'
      },
      {
        name: 'Test Analytics Health',
        value: 'test-analytics-health',
        description: 'Test Analytics service health endpoint',
        command: 'curl -s http://localhost:3001/health | jq'
      },
      {
        name: 'Test Market Overview',
        value: 'test-market-overview',
        description: 'Test market overview analytics API',
        command: 'curl -s http://localhost:3001/api/market/overview | jq'
      },
      {
        name: 'Test Portfolio API',
        value: 'test-portfolio',
        description: 'Test portfolio API (requires wallet address input)',
        command: 'echo "Usage: curl -s http://localhost:3001/api/portfolio/{address} | jq"'
      },
      {
        name: 'Test All Analytics APIs',
        value: 'test-all-analytics',
        description: 'Test all analytics API endpoints',
        command: 'echo "Testing all analytics endpoints..." && curl -s http://localhost:3001/api/market/overview | jq && curl -s http://localhost:3001/api/market/volume | jq && curl -s http://localhost:3001/api/market/liquidity | jq'
      }
    ]
  },
  {
    title: 'Simulation & Testing',
    emoji: '🧪',
    items: [
      {
        name: 'WebSocket Client',
        value: 'ws-client',
        description: 'Run the WebSocket client for testing connections',
        command: 'pnpm ws-client'
      },
      {
        name: 'WebSocket Stress Test',
        value: 'ws-stress-test',
        description: 'Run WebSocket stress testing with configurable parameters',
        command: 'pnpm ws-stress-test'
      },
      {
        name: 'Simulate Market Data',
        value: 'simulate-market',
        description: 'Run real trading simulation to generate WebSocket messages',
        command: 'pnpm simulate-market'
      }
    ]
  }
];

class CLI {
  private currentCategory: MenuCategory | null = null;

  constructor() {
    this.setupExitHandlers();
  }

  private setupExitHandlers(): void {
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n👋 Goodbye!'));
      process.exit(0);
    });
  }

  private displayHeader(): void {
    console.clear();
    console.log(chalk.cyan.bold('╔══════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║') + '  ' + chalk.white.bold('GTX Indexer Development CLI') + '                 ' + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('╚══════════════════════════════════════════════╝'));
    console.log();
  }

  private async showMainMenu(): Promise<void> {
    this.displayHeader();
    
    const choices = menuCategories.map(category => ({
      name: `${category.emoji} ${category.title}`,
      value: category.title,
      short: category.title
    }));

    choices.push(
      { name: '───────────────────', value: 'separator', short: '' },
      { name: '🚪 Exit', value: 'exit', short: 'Exit' }
    );

    const { selectedCategory } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedCategory',
        message: 'Select a category:',
        choices,
        pageSize: 10
      }
    ]);

    if (selectedCategory === 'exit') {
      console.log(chalk.green('👋 Goodbye!'));
      process.exit(0);
    }

    if (selectedCategory === 'separator') {
      return this.showMainMenu();
    }

    const category = menuCategories.find(cat => cat.title === selectedCategory);
    if (category) {
      this.currentCategory = category;
      await this.showCategoryMenu(category);
    }
  }

  private async showCategoryMenu(category: MenuCategory): Promise<void> {
    this.displayHeader();
    console.log(chalk.blue.bold(`${category.emoji} ${category.title} Commands\n`));

    const choices = category.items.map(item => ({
      name: item.dangerous 
        ? chalk.red(`${item.name} - ${item.description}`)
        : `${item.name} - ${chalk.gray(item.description)}`,
      value: item.value,
      short: item.name
    }));

    choices.push(
      { name: '───────────────────', value: 'separator', short: '' },
      { name: '🔙 Back to Main Menu', value: 'back', short: 'Back' },
      { name: '🚪 Exit', value: 'exit', short: 'Exit' }
    );

    const { selectedCommand } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedCommand',
        message: 'Select a command:',
        choices,
        pageSize: 15
      }
    ]);

    if (selectedCommand === 'exit') {
      console.log(chalk.green('👋 Goodbye!'));
      process.exit(0);
    }

    if (selectedCommand === 'back') {
      return this.showMainMenu();
    }

    if (selectedCommand === 'separator') {
      return this.showCategoryMenu(category);
    }

    const menuItem = category.items.find(item => item.value === selectedCommand);
    if (menuItem) {
      await this.executeCommand(menuItem);
    }
  }

  private async executeCommand(menuItem: MenuItem): Promise<void> {
    // Special handling for WebSocket stress test
    if (menuItem.value === 'ws-stress-test') {
      await this.executeStressTest();
      return;
    }

    // Special handling for portfolio API test (requires user input)
    if (menuItem.value === 'test-portfolio') {
      await this.executePortfolioTest();
      return;
    }

    // Special handling for running all services locally
    if (menuItem.value === 'local-all') {
      await this.executeLocalServices();
      return;
    }

    // Show confirmation for dangerous commands
    if (menuItem.dangerous) {
      console.log(chalk.red.bold('\n⚠️  WARNING: This is a destructive operation!'));
      console.log(chalk.yellow(`Command: ${menuItem.command}`));
      console.log(chalk.yellow(`Description: ${menuItem.description}\n`));

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to proceed?',
          default: false
        }
      ]);

      if (!confirm) {
        console.log(chalk.yellow('Operation cancelled.\n'));
        await this.showPostCommandMenu();
        return;
      }
    }

    console.log(chalk.blue(`\n🚀 Executing: ${chalk.white.bold(menuItem.command)}\n`));

    // Handle microservices commands with flexible paths
    let command = menuItem.command;
    if (command.includes('./scripts/microservices.sh')) {
      // Detect if we're running from scripts directory or project root
      const fs = await import('fs');
      if (fs.existsSync('./microservices.sh')) {
        // Running from scripts directory
        command = command.replace('./scripts/microservices.sh', './microservices.sh');
      } else if (fs.existsSync('../scripts/microservices.sh')) {
        // Running from project root, but script is in scripts directory
        command = command.replace('./scripts/microservices.sh', './scripts/microservices.sh');
      }
    }

    const [cmd, ...args] = command.split(' ');
    
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: 'inherit',
        shell: true
      });

      child.on('close', (code) => {
        console.log();
        if (code === 0) {
          console.log(chalk.green('✅ Command completed successfully!'));
        } else {
          console.log(chalk.red(`❌ Command failed with exit code ${code}`));
        }
        console.log();
        resolve(this.showPostCommandMenu());
      });

      child.on('error', (error) => {
        console.log(chalk.red(`❌ Error executing command: ${error.message}`));
        resolve(this.showPostCommandMenu());
      });
    });
  }

  private async executeStressTest(): Promise<void> {
    console.log(chalk.blue.bold('\n🔌 WebSocket Stress Test Configuration\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'numClients',
        message: 'Number of concurrent clients:',
        default: '10',
        validate: (input: string) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1) {
            return 'Please enter a valid number greater than 0';
          }
          if (num > 1000) {
            return 'Warning: Values over 1000 may impact system performance. Continue? (y/N)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'url',
        message: 'WebSocket server URL:',
        default: 'ws://localhost:42080'
      },
      {
        type: 'checkbox',
        name: 'streams',
        message: 'Select streams to subscribe to:',
        choices: [
          { name: 'mwethmusdc@trade - Trade stream', value: 'mwethmusdc@trade', checked: true },
          { name: 'mwethmusdc@kline_1m - 1-minute kline', value: 'mwethmusdc@kline_1m', checked: true },
          { name: 'mwethmusdc@depth - Order book depth', value: 'mwethmusdc@depth', checked: true },
          { name: 'mwethmusdc@miniTicker - Mini ticker', value: 'mwethmusdc@miniTicker', checked: true }
        ],
        validate: (choices: string[]) => {
          if (choices.length === 0) {
            return 'Please select at least one stream';
          }
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'useUserSockets',
        message: 'Subscribe to user WebSocket connections as well?',
        default: true
      },
      {
        type: 'input',
        name: 'userFile',
        message: 'Path to user addresses file (one address per line):',
        default: './user-addresses.txt',
        when: (answers) => answers.useUserSockets,
        validate: async (input: string) => {
          try {
            const fs = await import('fs');
            if (!fs.existsSync(input)) {
              return `File ${input} does not exist. Please provide a valid file path.`;
            }
            return true;
          } catch {
            return 'Unable to validate file path';
          }
        }
      },
      {
        type: 'input',
        name: 'duration',
        message: 'Test duration in seconds (leave empty for unlimited):',
        default: '',
        validate: (input: string) => {
          if (input === '') return true;
          const num = parseInt(input);
          if (isNaN(num) || num < 1) {
            return 'Please enter a valid number greater than 0 or leave empty for unlimited';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'connectionDelay',
        message: 'Delay between client connections (ms):',
        default: '100',
        validate: (input: string) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 0) {
            return 'Please enter a valid number greater than or equal to 0';
          }
          return true;
        }
      }
    ]);

    // Build command arguments
    const args = [
      '--clients', answers.numClients,
      '--url', answers.url,
      '--streams', answers.streams.join(','),
      '--delay', answers.connectionDelay
    ];

    if (answers.duration) {
      args.push('--duration', answers.duration);
    }

    if (answers.useUserSockets && answers.userFile) {
      args.push('--users', answers.userFile);
    }

    const fullCommand = `tsx ./websocket-client/stress-test.ts ${args.join(' ')}`;

    console.log(chalk.blue(`\n🚀 Executing: ${chalk.white.bold(fullCommand)}\n`));
    console.log(chalk.yellow('💡 Press Ctrl+C to stop the stress test\n'));

    // Show summary
    console.log(chalk.cyan('📋 Configuration Summary:'));
    console.log(`   Clients: ${chalk.white(answers.numClients)}`);
    console.log(`   URL: ${chalk.white(answers.url)}`);
    console.log(`   Streams: ${chalk.white(answers.streams.join(', '))}`);
    if (answers.useUserSockets) {
      console.log(`   User sockets: ${chalk.white('Yes')} (${answers.userFile})`);
    } else {
      console.log(`   User sockets: ${chalk.white('No')}`);
    }
    if (answers.duration) {
      console.log(`   Duration: ${chalk.white(answers.duration)}s`);
    } else {
      console.log(`   Duration: ${chalk.white('Unlimited')}`);
    }
    console.log(`   Connection delay: ${chalk.white(answers.connectionDelay)}ms\n`);

    return new Promise((resolve) => {
      const child = spawn('tsx', ['./websocket-client/stress-test.ts', ...args], {
        stdio: 'inherit',
        shell: true
      });

      child.on('close', (code) => {
        console.log();
        if (code === 0) {
          console.log(chalk.green('✅ Stress test completed successfully!'));
        } else {
          console.log(chalk.red(`❌ Stress test failed with exit code ${code}`));
        }
        console.log();
        resolve(this.showPostCommandMenu());
      });

      child.on('error', (error) => {
        console.log(chalk.red(`❌ Error executing stress test: ${error.message}`));
        resolve(this.showPostCommandMenu());
      });
    });
  }

  private async executePortfolioTest(): Promise<void> {
    console.log(chalk.blue.bold('\n💼 Portfolio API Test\n'));

    const { address } = await inquirer.prompt([
      {
        type: 'input',
        name: 'address',
        message: 'Enter wallet address to test:',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Please enter a wallet address';
          }
          if (!input.startsWith('0x') || input.length !== 42) {
            return 'Please enter a valid Ethereum address (0x followed by 40 hex characters)';
          }
          return true;
        }
      }
    ]);

    const commands = [
      `curl -s http://localhost:3001/api/portfolio/${address} | jq`,
      `curl -s http://localhost:3001/api/portfolio/${address}/performance | jq`,
      `curl -s http://localhost:3001/api/portfolio/${address}/allocation | jq`,
      `curl -s http://localhost:3001/api/portfolio/${address}/history | jq`
    ];

    console.log(chalk.blue(`\n🚀 Testing Portfolio APIs for: ${chalk.white.bold(address)}\n`));

    for (const command of commands) {
      console.log(chalk.cyan(`➤ ${command}`));
      
      const [cmd, ...args] = command.split(' ');
      
      await new Promise<void>((resolve) => {
        const child = spawn(cmd, args, {
          stdio: 'inherit',
          shell: true
        });

        child.on('close', (code) => {
          console.log();
          if (code !== 0) {
            console.log(chalk.red(`❌ Command failed with exit code ${code}`));
          }
          resolve();
        });

        child.on('error', (error) => {
          console.log(chalk.red(`❌ Error executing command: ${error.message}`));
          resolve();
        });
      });
    }

    console.log(chalk.green('✅ Portfolio API tests completed!'));
    console.log();
    await this.showPostCommandMenu();
  }

  private async executeLocalServices(): Promise<void> {
    console.log(chalk.blue.bold('\n🚀 Starting All Local Services\n'));
    
    console.log(chalk.yellow('This will start 3 services in parallel:'));
    console.log('  • CLOB Indexer (Core)');
    console.log('  • WebSocket Service');
    console.log('  • Analytics Service\n');

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Make sure infrastructure is running. Continue?',
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Operation cancelled.\n'));
      await this.showPostCommandMenu();
      return;
    }

    console.log(chalk.green('\n✨ Starting services...\n'));
    console.log(chalk.gray('Press Ctrl+C to stop all services\n'));

    // Create child processes for each service
    const services = [
      {
        name: 'CLOB Indexer',
        command: 'npm',
        args: ['run', 'dev'],
        cwd: '..',
        color: chalk.cyan
      },
      {
        name: 'WebSocket Service',
        command: 'npm',
        args: ['run', 'dev'],
        cwd: '../websocket-service',
        color: chalk.green
      },
      {
        name: 'Analytics Service',
        command: 'npm',
        args: ['run', 'dev'],
        cwd: '../analytics-service',
        color: chalk.magenta
      }
    ];

    const children: any[] = [];

    // Start all services
    services.forEach(service => {
      console.log(service.color(`[${service.name}] Starting...`));
      
      const child = spawn(service.command, service.args, {
        cwd: service.cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: 'true' }
      });

      // Prefix output with service name
      child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
          console.log(service.color(`[${service.name}]`), line);
        });
      });

      child.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
          console.error(service.color(`[${service.name}]`), chalk.red(line));
        });
      });

      child.on('error', (error) => {
        console.error(service.color(`[${service.name}]`), chalk.red(`Failed to start: ${error.message}`));
      });

      child.on('exit', (code) => {
        console.log(service.color(`[${service.name}]`), chalk.yellow(`Exited with code ${code}`));
      });

      children.push(child);
    });

    // Handle graceful shutdown
    const cleanup = () => {
      console.log(chalk.yellow('\n\nShutting down services...'));
      children.forEach(child => {
        child.kill('SIGTERM');
      });
      setTimeout(() => {
        children.forEach(child => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        });
        process.exit(0);
      }, 5000);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Wait for all services to exit
    await Promise.all(children.map(child => 
      new Promise(resolve => child.on('exit', resolve))
    ));

    console.log(chalk.yellow('\nAll services stopped.'));
    await this.showPostCommandMenu();
  }

  private async showPostCommandMenu(): Promise<void> {
    const { nextAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'nextAction',
        message: 'What would you like to do next?',
        choices: [
          { name: '🔄 Run another command from this category', value: 'category' },
          { name: '🏠 Return to main menu', value: 'main' },
          { name: '🚪 Exit', value: 'exit' }
        ]
      }
    ]);

    switch (nextAction) {
      case 'category':
        if (this.currentCategory) {
          await this.showCategoryMenu(this.currentCategory);
        } else {
          await this.showMainMenu();
        }
        break;
      case 'main':
        await this.showMainMenu();
        break;
      case 'exit':
        console.log(chalk.green('👋 Goodbye!'));
        process.exit(0);
        break;
    }
  }

  public async start(): Promise<void> {
    try {
      await this.showMainMenu();
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'isTtyError' in error) {
        console.error(chalk.red('❌ This CLI requires an interactive terminal'));
      } else {
        console.error(chalk.red('❌ An unexpected error occurred:'), error);
      }
      process.exit(1);
    }
  }
}

// Start the CLI
const cli = new CLI();
cli.start().catch((error) => {
  console.error(chalk.red('❌ Failed to start CLI:'), error);
  process.exit(1);
});