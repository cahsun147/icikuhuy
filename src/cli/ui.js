// src/cli/ui.js
const Table = require('cli-table3');
const { getBnbBalance } = require('../services/blockchain');
const logger = require('../utils/logger');
const chalk = require('chalk');

// Fungsi pembantu untuk menyingkat alamat
function shortenAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 5)}...${address.substring(address.length - 4)}`;
}

async function displayWalletBalances(mainWallet, multiWallets) {
  logger.log(chalk.cyan('\n--- Status Dompet ---'));

  // 1. Tampilan Dompet Utama (Disimpelkan)
  const mainBalance = await getBnbBalance(mainWallet.address);
  const mainTable = new Table({
    head: [chalk.yellow('Dompet Utama'), chalk.yellow('Alamat'), chalk.yellow('Saldo BNB')],
    colWidths: [20, 30, 20],
    style: { head: ['yellow'] }
  });

  const shortAddress = shortenAddress(mainWallet.address);
  mainTable.push(['MAIN', shortAddress, parseFloat(mainBalance).toFixed(5)]);
  logger.log(mainTable.toString());

  // 2. Tampilan Ringkasan Multi Wallets
  if (multiWallets.length > 0) {
    // Ambil saldo semua multi-wallet secara paralel
    const balancePromises = multiWallets.map(wallet => getBnbBalance(wallet.address));
    const balances = await Promise.all(balancePromises);
    
    let totalMultiBnb = 0;
    balances.forEach(balance => {
      totalMultiBnb += parseFloat(balance);
    });

    const multiSummaryTable = new Table({
      head: [chalk.yellow('Kategori'), chalk.yellow('Nilai')],
      colWidths: [20, 55],
      style: { head: ['yellow'] }
    });
    
    // Hanya menampilkan ringkasan
    multiSummaryTable.push(
      ['Total Dompet', `${multiWallets.length} dompet`],
      ['Total Saldo BNB', `${totalMultiBnb.toFixed(5)}`]
    );

    logger.log(multiSummaryTable.toString());
  } else {
    logger.warning('Tidak ada multi-dompet yang ditemukan. Buat beberapa melalui menu.');
  }
  logger.log(chalk.cyan('---------------------\n'));
}

module.exports = {
  displayWalletBalances,
};
