// src/cli/ui.js
const Table = require('cli-table3');
const { getBnbBalance } = require('../services/blockchain');
const logger = require('../utils/logger');
const chalk = require('chalk');

async function displayWalletBalances(mainWallet, multiWallets) {
  logger.log(chalk.cyan('\n--- Status Dompet ---'));

  // Main Wallet
  const mainBalance = await getBnbBalance(mainWallet.address);
  const mainTable = new Table({
    head: [chalk.yellow('Dompet Utama'), chalk.yellow('Alamat'), chalk.yellow('Saldo BNB')],
    colWidths: [20, 45, 20],
  });
  mainTable.push(['MAIN', mainWallet.address, parseFloat(mainBalance).toFixed(5)]);
  logger.log(mainTable.toString());

  // Multi Wallets
  if (multiWallets.length > 0) {
    const multiTable = new Table({
      head: [chalk.yellow('Multi-Dompet'), chalk.yellow('Alamat'), chalk.yellow('Saldo BNB')],
      colWidths: [20, 45, 20],
    });
    
    let totalMultiBnb = 0;
    
    // Ambil saldo secara paralel
    const balancePromises = multiWallets.map(wallet => getBnbBalance(wallet.address));
    const balances = await Promise.all(balancePromises);
    
    multiWallets.forEach((wallet, index) => {
      const balance = parseFloat(balances[index]);
      totalMultiBnb += balance;
      multiTable.push([`Wallet ${index + 1}`, wallet.address, balance.toFixed(5)]);
    });

    logger.log(multiTable.toString());
    logger.log(chalk.magenta(`Total Multi-Dompet: ${multiWallets.length} | Total Saldo BNB: ${totalMultiBnb.toFixed(5)}`));
  } else {
    logger.warning('Tidak ada multi-dompet yang ditemukan. Buat beberapa melalui menu.');
  }
  logger.log(chalk.cyan('---------------------\n'));
}

module.exports = {
  displayWalletBalances,
};