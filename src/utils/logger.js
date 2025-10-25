// src/utils/logger.js
const chalk = require('chalk');

const log = console.log;

module.exports = {
  info: (msg) => log(chalk.blue(`[INFO] ${msg}`)),
  success: (msg) => log(chalk.green(`[SUCCESS] ${msg}`)),
  warning: (msg) => log(chalk.yellow(`[WARN] ${msg}`)),
  error: (msg) => log(chalk.red(`[ERROR] ${msg}`)),
  log: (msg) => log(msg),
};