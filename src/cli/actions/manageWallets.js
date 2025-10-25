// src/cli/actions/manageWallets.js
const blockchain = require('../../services/blockchain');
const wallet = require('../../services/wallet');
const prompts = require('../prompts');
const logger = require('../../utils/logger');
const { displayWalletBalances } = require('../ui');
const { ethers } = require('ethers');

async function handleGenerateWallets() {
  const { count } = await prompts.generateWalletPrompts();
  const provider = blockchain.getProvider();
  await wallet.generateWallets(parseInt(count, 10), provider);
  logger.success(`${count} dompet baru telah dibuat dan disimpan.`);
}

async function handleFundWallets(custom = false) {
  const action = custom ? 'fund_custom' : 'fund';
  const { amount } = await prompts.fundWalletsPrompts(action); // 'amount' adalah float string
  const mainSigner = await blockchain.getMainWalletSigner();
  const multiWallets = await wallet.loadMultiWallets(blockchain.getProvider());
  
  if (multiWallets.length === 0) {
    logger.warning('Tidak ada multi-dompet untuk didanai.');
    return;
  }

  const multiWalletAddresses = multiWallets.map(w => w.address);
  const totalCost = parseFloat(amount) * multiWalletAddresses.length;
  
  // Konfirmasi
  const { confirm } = await prompts.confirmActionPrompt(
    `Anda akan mengirim ${amount} BNB ke ${multiWalletAddresses.length} dompet. Total: ${totalCost} BNB. Lanjutkan?`
  );
  if (!confirm) {
    logger.warning('Pendanaan dibatalkan.');
    return;
  }
  
  try {
    // 'amount' (float string) diteruskan, blockchain.js akan mem-parse-nya
    await blockchain.fundWallets(mainSigner, multiWalletAddresses, amount); 
  } catch (e) {
    logger.error(`Gagal mendanai dompet: ${e.message}`);
  }
}

async function handleRefundWallets() {
  const mainSigner = await blockchain.getMainWalletSigner();
  const multiSigners = await blockchain.getMultiWalletSigners();
  
  if (multiSigners.length === 0) {
    logger.warning('Tidak ada multi-dompet untuk dikembalikan dananya.');
    return;
  }
  
  // Konfirmasi
  const { confirm } = await prompts.confirmActionPrompt(
    `Anda akan mengembalikan SEMUA sisa BNB dari ${multiSigners.length} dompet ke dompet utama ${mainSigner.address}. Lanjutkan?`
  );
  if (!confirm) {
    logger.warning('Refund dibatalkan.');
    return;
  }

  try {
    await blockchain.refundWallets(multiSigners, mainSigner.address);
  } catch (e) {
    logger.error(`Gagal mengembalikan dana: ${e.message}`);
  }
}

async function handleDisplayBalances() {
  const mainSigner = await blockchain.getMainWalletSigner();
  const multiWallets = await wallet.loadMultiWallets(blockchain.getProvider());
  await displayWalletBalances(mainSigner, multiWallets);
}

module.exports = {
  handleGenerateWallets,
  handleFundWallets,
  handleRefundWallets,
  handleDisplayBalances,
};
