// src/cli/main.js (Versi 2.1)
const prompts = require('./prompts');
const { handleCreateToken } = require('./actions/createToken');
const { 
  handleGenerateWallets, 
  handleFundWallets, 
  handleRefundWallets,
  handleDisplayBalances 
} = require('./actions/manageWallets');
const { 
  handleTrade, 
  handleSnipeToken, 
  handleVolumeBot,
  stopRunningBots
} = require('./actions/trading');
const logger = require('../utils/logger');
const { MAIN_WALLET_PK } = require('../utils/config');
const blockchain = require('../services/blockchain'); // Import blockchain untuk initProvider

async function mainLoop() {
  if (!MAIN_WALLET_PK) {
    logger.error('MAIN_WALLET_PRIVATE_KEY tidak ditemukan di file .env');
    logger.error('Harap isi file .env dan restart aplikasi.');
    return;
  }
  
  // --- BARU: PILIH MODE ---
  const { mode } = await prompts.initialModePrompt();
  const isTestMode = mode === 'test';

  // Inisialisasi provider berdasarkan mode yang dipilih
  try {
      blockchain.initProvider(isTestMode);
  } catch (e) {
      logger.error(`Error inisialisasi provider: ${e.message}`);
      return;
  }

  if (isTestMode) {
    logger.warning('MODE UJI COBA (TESTNET) AKTIF. Transaksi HANYA akan dieksekusi di BSC TESTNET!');
  } else {
    logger.success('MODE UTAMA (MAINNET) AKTIF. Transaksi akan dieksekusi di BSC MAINNET.');
  }
  
  let running = true;
  while (running) {
    try {
      // displayBalances tidak perlu tahu mode, dia hanya butuh signer
      await handleDisplayBalances();
      const { action } = await prompts.mainMenu();
      
      switch (action) {
        case 'create':
          await handleCreateToken(isTestMode);
          break;
        case 'generate':
          await handleGenerateWallets();
          break;
        case 'fund':
          await handleFundWallets(isTestMode);
          break;
        case 'snipe':
          await handleSnipeToken(isTestMode);
          break;
        case 'buy':
          await handleTrade('buy', isTestMode);
          break;
        case 'sell':
          await handleTrade('sell', isTestMode);
          break;
        case 'volume':
          await handleVolumeBot(isTestMode);
          break;
        case 'refund':
          await handleRefundWallets(isTestMode);
          break;
        case 'exit':
          running = false;
          break;
      }
    } catch (e) {
      logger.error(`Terjadi error di menu utama: ${e.message}`);
      if (e.stack) {
        logger.error(e.stack);
      }
    }
  }
  
  stopRunningBots();
  logger.log('Keluar dari aplikasi...');
  process.exit(0);
}

module.exports = {
  mainLoop,
};
