// src/cli/main.js
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
const { MAIN_WALLET_PK, RPC_URL } = require('../utils/config');

async function mainLoop() {
  if (!MAIN_WALLET_PK || !RPC_URL) {
    logger.error('MAIN_WALLET_PRIVATE_KEY atau BSC_RPC_URL tidak ada di file .env');
    logger.error('Harap isi file .env dan restart aplikasi.');
    return;
  }
  
  let running = true;
  while (running) {
    try {
      await handleDisplayBalances();
      const { action } = await prompts.mainMenu();
      
      switch (action) {
        case 'create':
          await handleCreateToken();
          break;
        case 'generate':
          await handleGenerateWallets();
          break;
        case 'fund_main_to_multi':
          await handleFundWallets(false);
          break;
        case 'snipe':
          await handleSnipeToken();
          break;
        case 'buy':
          await handleTrade('buy');
          break;
        case 'sell':
          await handleTrade('sell');
          break;
        case 'volume':
          await handleVolumeBot();
          break;
        case 'fund_custom':
          await handleFundWallets(true);
          break;
        case 'refund':
          await handleRefundWallets();
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