// src/cli/actions/trading.js
const { ethers } = require('ethers');
const blockchain = require('../../services/blockchain');
const prompts = require('../prompts');
const logger = require('../../utils/logger');
const { ABIS, CONTRACT_ADDRESSES } = require('../../utils/config');

let volumeBotInterval = null;
let snipeListener = null;

async function handleTrade(action) {
  // 1. Tanya dompet mana
  const { walletChoice } = await prompts.walletChoicePrompt();
  
  let signers = [];
  if (walletChoice === 'main') {
    signers.push(await blockchain.getMainWalletSigner());
  } else {
    signers = await blockchain.getMultiWalletSigners();
  }

  if (signers.length === 0) {
    logger.warning(`Tidak ada ${walletChoice === 'main' ? 'dompet utama' : 'multi-dompet'} untuk trading.`);
    return;
  }
  
  // 2. Tanya token dan jumlah
  const { tokenAddress, amount } = await prompts.tradeTokenPrompts(action);
  
  let amountInWei = '0';
  let fundsInWei = '0';
  let amountDisplay = "";

  if (action === 'buy') {
    fundsInWei = ethers.utils.parseEther(amount); // 'amount' adalah string BNB, e.g., "0.01"
    amountDisplay = `${amount} BNB`;
  } else {
    // Asumsikan token punya 18 desimal jika 'sell'.
    // TODO: Bisa dipercanggih dengan mengambil 'decimals' dari kontrak ERC20
    amountInWei = ethers.utils.parseEther(amount); // 'amount' adalah string token, e.g., "1000.5"
    amountDisplay = `${amount} Token`;
  }
  
  // 3. Konfirmasi
  logger.info(`\n--- KONFIRMASI ${action.toUpperCase()} ---`);
  logger.info(` Aksi: ${action.toUpperCase()}`);
  logger.info(` Token: ${tokenAddress}`);
  logger.info(` Jumlah: ${amountDisplay}`);
  logger.info(` Dompet: ${walletChoice} (${signers.length} dompet)`);
  logger.info('-------------------------');
  
  const { confirm } = await prompts.confirmActionPrompt('Lanjutkan transaksi ini?');
  if (!confirm) {
    logger.warning('Transaksi dibatalkan.');
    return;
  }

  logger.info(`Memulai ${action} untuk ${tokenAddress} dengan ${signers.length} dompet...`);

  // 4. Eksekusi
  // Menggunakan Promise.all untuk eksekusi "simultan"
  // isBot di-set FALSE karena ini adalah handleTrade manual
  const tradePromises = signers.map(signer => 
    blockchain.tradeToken(action, signer, tokenAddress, amountInWei, fundsInWei, false)
      .then(receipt => logger.success(`[${signer.address}] Transaksi ${action} berhasil: ${receipt.transactionHash}`))
      .catch(e => logger.error(`[${signer.address}] Transaksi ${action} gagal: ${e.message}`))
  );
  
  await Promise.all(tradePromises);
  logger.success(`Semua ${action} selesai diproses.`);
}

async function handleSnipeToken() {
  if (snipeListener) {
    logger.warning('Sniper sudah berjalan. Hentikan dulu jika ingin memulai yang baru.');
    return;
  }
  
  const { symbol, buyAmountEth } = await prompts.snipePrompts();
  const fundsInWei = ethers.utils.parseEther(buyAmountEth);
  const multiSigners = await blockchain.getMultiWalletSigners();

  if (multiSigners.length === 0) {
    logger.warning('Tidak ada multi-dompet untuk snipe.');
    return;
  }

  // Konfirmasi
  const { confirm } = await prompts.confirmActionPrompt(
    `Sniper akan memantau simbol "${symbol}" & membeli ${buyAmountEth} BNB per dompet (${multiSigners.length} dompet). Lanjutkan?`
  );
  if (!confirm) {
    logger.warning('Snipe dibatalkan.');
    return;
  }

  const provider = blockchain.getProvider();
  const iface = new ethers.utils.Interface(ABIS.TOKEN_MANAGER_V2);
  
  // Filter untuk event TokenCreate di TokenManagerV2
  const filter = {
    address: CONTRACT_ADDRESSES.TOKEN_MANAGER_V2,
    topics: [
      ethers.utils.id("TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)")
    ]
  };
  
  logger.info(`Sniper diaktifkan. Memantau event TokenCreate untuk simbol: "${symbol}"`);
  
  snipeListener = (log) => {
    try {
      const parsedLog = iface.parseLog(log);
      const { token, symbol: eventSymbol } = parsedLog.args;

      logger.info(`Event TokenCreate terdeteksi: ${eventSymbol} (${token})`);
      
      if (eventSymbol === symbol) {
        logger.success(`TARGET DITEMUKAN: ${symbol} di ${token}`);
        
        // Hentikan listener
        provider.removeListener(filter, snipeListener);
        snipeListener = null;
        logger.info('Sniper dihentikan. Memulai pembelian...');
        
        // Eksekusi pembelian dengan semua dompet
        // isBot di-set FALSE karena ini adalah snipe yang seharusnya cepat (menggunakan AGGRESSIVE_GAS_PRICE)
        const buyPromises = multiSigners.map(signer => 
          blockchain.tradeToken('buy', signer, token, '0', fundsInWei, false)
            .then(receipt => logger.success(`[${signer.address}] SNIPE BERHASIL: ${receipt.transactionHash}`))
            .catch(e => logger.error(`[${signer.address}] SNIPE GAGAL: ${e.message}`))
        );
        
        Promise.all(buyPromises).then(() => logger.success('Semua proses snipe selesai.'));
      }
    } catch (e) {
      // Abaikan
    }
  };

  provider.on(filter, snipeListener);
  logger.log('Tekan Enter untuk kembali ke menu utama. Sniper akan tetap berjalan di background.');
  logger.log('Untuk menghentikan sniper, restart aplikasi ini.');
}

async function handleVolumeBot() {
  if (volumeBotInterval) {
    logger.warning('Volume bot sudah berjalan. Menghentikan bot lama...');
    clearInterval(volumeBotInterval);
    volumeBotInterval = null;
  }

  const { tokenAddress, buyAmountEth, sellAmountToken, intervalSeconds } = await prompts.volumeBotPrompts();
  const multiSigners = await blockchain.getMultiWalletSigners();

  if (multiSigners.length < 2) {
    logger.error('Volume bot membutuhkan setidaknya 2 multi-dompet (1 pembeli, 1 penjual).');
    return;
  }
  
  const buyFundsInWei = ethers.utils.parseEther(buyAmountEth);
  const sellAmountInWei = ethers.utils.parseEther(sellAmountToken); // Asumsi 18 desimal

  // Konfirmasi
  const { confirm } = await prompts.confirmActionPrompt(
    `Bot volume akan trading ${tokenAddress} (Buy: ${buyAmountEth} BNB, Sell: ${sellAmountToken} Token) setiap ${intervalSeconds} detik. Lanjutkan?`
  );
  if (!confirm) {
    logger.warning('Volume bot dibatalkan.');
    return;
  }
  
  logger.info(`Volume bot dimulai untuk ${tokenAddress} setiap ${intervalSeconds} detik.`);
  logger.log('Tekan Enter untuk kembali ke menu. Bot akan berjalan di background.');
  logger.log('Untuk menghentikan bot, pilih "Keluar" dari menu utama.');

  volumeBotInterval = setInterval(async () => {
    try {
      // Pilih 2 dompet acak
      const [buyerSigner, sellerSigner] = multiSigners
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value)
        .slice(0, 2);

      logger.info(`[VolumeBot] Siklus dimulai: Buyer: ${buyerSigner.address}, Seller: ${sellerSigner.address}`);
      
      // Tambahkan parameter TRUE untuk mengaktifkan LOW_GAS_PRICE
      const isBot = true; 

      // Cek saldo seller
      const sellerBalance = await blockchain.getTokenBalance(tokenAddress, sellerSigner.address);
      if (sellerBalance.lt(sellAmountInWei)) {
        logger.warning(`[VolumeBot] Seller ${sellerSigner.address} tidak punya cukup token (${ethers.utils.formatEther(sellerBalance)}). Melewatkan...`);
        // Lakukan pembelian saja untuk mengisi saldo
        logger.info(`[VolumeBot] Membeli token untuk Seller ${sellerSigner.address}...`);
        await blockchain.tradeToken('buy', sellerSigner, tokenAddress, '0', buyFundsInWei, isBot)
          .catch(e => logger.error(`[VolumeBot] Top-up Gagal: ${e.message}`));
        return;
      }
      
      // Lakukan sell dan buy secara "bersamaan"
      const sellPromise = blockchain.tradeToken('sell', sellerSigner, tokenAddress, sellAmountInWei, '0', isBot)
        .then(receipt => logger.success(`[VolumeBot-SELL] ${sellerSigner.address} berhasil: ${receipt.transactionHash}`))
        .catch(e => logger.error(`[VolumeBot-SELL] Gagal: ${e.message}`));
        
      const buyPromise = blockchain.tradeToken('buy', buyerSigner, tokenAddress, '0', buyFundsInWei, isBot)
        .then(receipt => logger.success(`[VolumeBot-BUY] ${buyerSigner.address} berhasil: ${receipt.transactionHash}`))
        .catch(e => logger.error(`[VolumeBot-BUY] Gagal: ${e.message}`));
        
      await Promise.all([sellPromise, buyPromise]);
      logger.success('[VolumeBot] Siklus trade selesai.');

    } catch (e) {
      logger.error(`[VolumeBot] Error: ${e.message}`);
    }
  }, parseInt(intervalSeconds, 10) * 1000);
}

function stopRunningBots() {
  if (volumeBotInterval) {
    clearInterval(volumeBotInterval);
    logger.info('Volume bot dihentikan.');
  }
  if (snipeListener) {
    const provider = blockchain.getProvider();
    provider.removeListener('pending', snipeListener); // Hapus listener jika ada
    logger.info('Sniper dihentikan.');
  }
}

module.exports = {
  handleTrade,
  handleSnipeToken,
  handleVolumeBot,
  stopRunningBots,
};