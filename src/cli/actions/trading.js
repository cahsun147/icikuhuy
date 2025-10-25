// src/cli/actions/trading.js (Versi 3.3)
const { ethers } = require('ethers');
const blockchain = require('../../services/blockchain');
const prompts = require('../prompts');
const logger = require('../../utils/logger');
const { ABIS, CONTRACT_ADDRESSES } = require('../../utils/config');
const { loadMultiWallets } = require('../../services/wallet');

// Versi skrip saat ini (dibuat untuk pelacakan)
const SCRIPT_VERSION = '3.3'; 

let volumeBotInterval = null;
let snipeListener = null;

async function handleTrade(action) {
  // Tambahkan info versi
  logger.info(`Menjalankan handleTrade v${SCRIPT_VERSION}`);
  
  // 1. Tanya dompet mana
  const { walletChoice } = await prompts.walletChoicePrompt(action);
  
  // 2. Tanya token address
  const { tokenAddress } = await prompts.tradeTokenAddressPrompt();

  let signers = [];
  let mainSigner = await blockchain.getMainWalletSigner();
  let multiSigners = await blockchain.getMultiWalletSigners();
  
  if (walletChoice === 'main') {
    signers.push(mainSigner);
  } else if (walletChoice === 'multi') {
    signers = multiSigners;
  } else if (walletChoice === 'all') {
    // Order: Main Wallet dulu, lalu Multi Wallets
    signers.push(mainSigner);
    signers = signers.concat(multiSigners);
  }

  if (signers.length === 0) {
    logger.warning(`Tidak ada dompet yang dipilih untuk trading.`);
    return;
  }
  
  // 3. Tentukan jumlah trade (logika kompleks untuk SELL/BUY)
  let amountInWei = ethers.BigNumber.from('0');
  let fundsInWei = ethers.BigNumber.from('0');
  let amountDisplay = "";
  let decimals = 18; // Default
  let sellPromptResult = {};

  if (action === 'sell') {
    // a. Dapatkan desimal & saldo total untuk semua signers
    decimals = await blockchain.getTokenDecimals(tokenAddress);
    let totalTokenBalance = ethers.BigNumber.from('0');

    for (const signer of signers) {
      const balance = await blockchain.getTokenBalance(tokenAddress, signer.address);
      totalTokenBalance = totalTokenBalance.add(balance);
    }
    
    const totalBalanceDisplay = ethers.utils.formatUnits(totalTokenBalance, decimals);
    
    // b. Tanya jumlah/persentase sell
    sellPromptResult = await prompts.sellAmountPrompt(totalBalanceDisplay, await getContractSymbol(tokenAddress));
    const { amountChoice, customAmount } = sellPromptResult;
    
    let sellAmountBase;
    
    if (amountChoice === 'custom') {
      sellAmountBase = customAmount;
    } else {
      // *** PERBAIKAN LOGIKA PRESISI FLOATING-POINT (Kasus Umum) ***
      if (amountChoice === '100') {
          // Jika 100%, gunakan totalBalanceDisplay string secara langsung (paling aman)
          sellAmountBase = totalBalanceDisplay;
      } else {
          // Hitung jumlah berdasarkan persentase, lalu potong/trim ke desimal yang benar
          const percentage = parseInt(amountChoice) / 100;
          const calculatedAmount = parseFloat(totalBalanceDisplay) * percentage;
          sellAmountBase = calculatedAmount.toFixed(decimals); 
      }
      // **********************************************
    }
    
    // c. Konversi jumlah jual (sellAmountBase) ke BigNumber (Wei)
    try {
      amountInWei = ethers.utils.parseUnits(sellAmountBase.toString(), decimals); 
    } catch (e) {
      logger.error(`Error konversi jumlah sell: ${e.message}. Input: ${sellAmountBase.toString()}`);
      return;
    }
    
    if (amountInWei.gt(totalTokenBalance)) {
        logger.error(`Jumlah jual (${ethers.utils.formatUnits(amountInWei, decimals)}) melebihi total saldo token yang tersedia (${totalBalanceDisplay}). Transaksi dibatalkan.`);
        return;
    }

    amountDisplay = `${ethers.utils.formatUnits(amountInWei, decimals)} Token`;

  } else if (action === 'buy') {
    const { amount } = await prompts.buyAmountPrompt();
    fundsInWei = ethers.utils.parseEther(amount); 
    amountDisplay = `${amount} BNB`;
  }
  
  // 4. Tanya opsi trade (Gwei dan Slippage)
  const tradeOptions = await prompts.tradeOptionsPrompt(action);

  // 5. Konfirmasi
  logger.info(`\n--- KONFIRMASI ${action.toUpperCase()} ---`);
  logger.info(` Aksi: ${action.toUpperCase()}`);
  logger.info(` Token: ${tokenAddress}`);
  logger.info(` Jumlah: ${amountDisplay}`);
  logger.info(` Dompet: ${walletChoice} (${signers.length} dompet)`);
  logger.info(` Custom Gwei: ${tradeOptions.gwei} Gwei`);
  logger.info(` Slippage: ${tradeOptions.slippage}%`);
  logger.info('-------------------------');
  
  const { confirm } = await prompts.confirmActionPrompt('Lanjutkan transaksi ini?');
  if (!confirm) {
    logger.warning('Transaksi dibatalkan.');
    return;
  }

  logger.info(`Memulai ${action} untuk ${tokenAddress} dengan ${signers.length} dompet...`);
  
  // 6. Eksekusi
  const tradePromises = signers.map(async signer => {
    let individualAmountInWei = amountInWei;
    let finalFundsInWei = fundsInWei;

    if (action === 'sell') {
      const currentBalance = await blockchain.getTokenBalance(tokenAddress, signer.address);
      
      // Jika 100%, jual saldo dompet itu sendiri
      if (sellPromptResult.amountChoice === '100') {
        individualAmountInWei = currentBalance;
      } else {
        // Jika persentase/custom, bagi rata ke setiap dompet
        if (amountInWei.gt(0)) {
           // Pembagian integer untuk menghindari error floating point
           individualAmountInWei = amountInWei.div(signers.length);
        }
      }
      
      // Batas atas: tidak boleh melebihi saldo dompet yang ada
      if (currentBalance.lt(individualAmountInWei)) {
         individualAmountInWei = currentBalance;
      }
      
      // Cek apakah saldo nol (setelah pembagian)
      if (individualAmountInWei.isZero()) {
         logger.warning(`[${signer.address}] Saldo token nol. Melewatkan transaksi.`);
         return;
      }
      
      logger.info(`[${signer.address}] Menjual: ${ethers.utils.formatUnits(individualAmountInWei, decimals)} Token...`);

    } else if (action === 'buy') {
      // Untuk Buy, dana dibagi rata
      if (fundsInWei.gt(0)) {
        // Pembagian integer untuk menghindari error floating point
        finalFundsInWei = fundsInWei.div(signers.length); 
      }
    }
    
    // Eksekusi Trade, meneruskan opsi kustom dan parameter yang telah dihitung per dompet
    return blockchain.tradeToken(
        action, 
        signer, 
        tokenAddress, 
        individualAmountInWei, 
        finalFundsInWei, 
        { isBot: false, gwei: tradeOptions.gwei, slippage: tradeOptions.slippage }
      )
      .then(receipt => logger.success(`[${signer.address}] Transaksi ${action} berhasil: ${receipt.transactionHash}`))
      .catch(e => logger.error(`[${signer.address}] Transaksi ${action} gagal: ${e.message}`));
  });
  
  // Tunggu semua promise selesai
  await Promise.all(tradePromises);
  logger.success(`Semua ${action} selesai diproses.`);
}


// Fungsi pembantu untuk mendapatkan simbol (digunakan di sellAmountPrompt)
async function getContractSymbol(tokenAddress) {
  try {
    // Kita ambil dari blockchain.js
    const tokenContract = blockchain.getContract(tokenAddress, ABIS.ERC20, blockchain.getProvider());
    const symbol = await tokenContract.symbol();
    return symbol;
  } catch (e) {
    return 'TOKEN';
  }
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
        // isBot di-set TRUE karena ini adalah aksi cepat (menggunakan AGGRESSIVE_GAS_PRICE default)
        const buyPromises = multiSigners.map(signer => 
          // Menggunakan tradeOptions standard/aggressive
          blockchain.tradeToken('buy', signer, token, '0', fundsInWei, { isBot: true, gwei: '1.5', slippage: '0' })
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
      
      // Tambahkan parameter TRUE untuk mengaktifkan LOW_GAS_PRICE (0.11 Gwei)
      const botTradeOptions = { isBot: true, gwei: '0.11', slippage: '1' }; 

      // Cek saldo seller
      const sellerBalance = await blockchain.getTokenBalance(tokenAddress, sellerSigner.address);
      if (sellerBalance.lt(sellAmountInWei)) {
        logger.warning(`[VolumeBot] Seller ${sellerSigner.address} tidak punya cukup token (${ethers.utils.formatEther(sellerBalance)}). Melewatkan...`);
        // Lakukan pembelian saja untuk mengisi saldo
        logger.info(`[VolumeBot] Membeli token untuk Seller ${sellerSigner.address}...`);
        await blockchain.tradeToken('buy', sellerSigner, tokenAddress, '0', buyFundsInWei, botTradeOptions)
          .catch(e => logger.error(`[VolumeBot] Top-up Gagal: ${e.message}`));
        return;
      }
      
      // Lakukan sell dan buy secara "bersamaan"
      const sellPromise = blockchain.tradeToken('sell', sellerSigner, tokenAddress, sellAmountInWei, '0', botTradeOptions)
        .then(receipt => logger.success(`[VolumeBot-SELL] ${sellerSigner.address} berhasil: ${receipt.transactionHash}`))
        .catch(e => logger.error(`[VolumeBot-SELL] Gagal: ${e.message}`));
        
      const buyPromise = blockchain.tradeToken('buy', buyerSigner, tokenAddress, '0', buyFundsInWei, botTradeOptions)
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
