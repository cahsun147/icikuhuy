// index.js
require('dotenv').config();
const { mainLoop } = require('./src/cli/main');
const logger = require('./src/utils/logger');
const chalk = require('chalk');

// Tampilkan header
logger.log(chalk.bold.magentaBright(`
==================================
  Four.Meme CLI Bundler v1.0
==================================
`));

// Mulai aplikasi
mainLoop();