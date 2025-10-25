// src/cli/actions/trading.js (Versi 3.1)
const { ethers } = require('ethers');
const blockchain = require('../../services/blockchain');
const prompts = require('../prompts');
const logger = require('../../utils/logger');
const { ABIS, CONTRACT_ADDRESSES } = require('../../utils/config');
const { loadMultiWallets } = require('../../services/wallet');

// Versi skrip saat ini (dibuat untuk pelacakan)
const SCRIPT_VERSION = '3.1'; 

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
  
  // 3. Tentukan jumlah trade (logika kompleks untuk SELL)
  let amountInWei = ethers.BigNumber.from('0');
  let fundsInWei = ethers.BigNumber.from('0');
  let amountDisplay = "";
  let totalTokenBalance = ethers.BigNumber.from('0');
  let decimals = 18; // Default

  if (action === 'buy') {
    const { amount } = await prompts.buyAmountPrompt();
    fundsInWei = ethers.utils.parseEther(amount); // 'amount' adalah string BNB, e.g., "0.01"
    amountDisplay = `${amount} BNB`;
    
  } else if (action === 'sell') {
    // a. Dapatkan desimal & saldo total untuk semua signers
    decimals = await blockchain.getTokenDecimals(tokenAddress);

    for (const signer of signers) {
      const balance = await blockchain.getTokenBalance(tokenAddress, signer.address);
      totalTokenBalance = totalTokenBalance.add(balance);
    }
    
    const totalBalanceDisplay = ethers.utils.formatUnits(totalTokenBalance, decimals);
    
    // b. Tanya jumlah/persentase sell
    const { amountChoice, customAmount } = await prompts.sellAmountPrompt(totalBalanceDisplay, await getContractSymbol(tokenAddress));
    
    let sellAmountBase;
    
    if (amountChoice === 'custom') {
      sellAmountBase = customAmount; // Sudah dalam bentuk angka float (misalnya 245000)
    } else {
      const percentage = parseInt(amountChoice) / 100;
      
      // *** PERBAIKAN LOGIKA PRESISI FLOATING-POINT ***
      if (amountChoice === '100') {
          // Jika 100%, gunakan totalTokenBalance langsung, lalu konversi ke string
          // Ini adalah cara paling aman untuk menghindari error floating point.
          sellAmountBase = totalBalanceDisplay;
      } else {
          // Hitung jumlah berdasarkan persentase
          // Lakukan perhitungan lalu potong/trim ke jumlah desimal yang benar
          const calculatedAmount = parseFloat(totalBalanceDisplay) * percentage;
          sellAmountBase = calculatedAmount.toFixed(decimals); // Trim ke desimal yang benar
      }
      // **********************************************
    }
    
    // c. Konversi jumlah jual (sellAmountBase) ke BigNumber (Wei)
    try {
      // Gunakan parseUnits pada string yang sudah dipotong/valid
      amountInWei = ethers.utils.parseUnits(sellAmountBase.toString(), decimals); 
    } catch (e) {
      logger.error(`Error konversi jumlah sell: ${e.message}. Pastikan jumlah tidak melebihi saldo.`);
      return;
    }
    
    // Verifikasi: Apakah jumlah yang diminta melebihi saldo? (Perbandingan BigNumber)
    if (amountInWei.gt(totalTokenBalance)) {
        logger.error(`Jumlah jual (${ethers.utils.formatUnits(amountInWei, decimals)}) melebihi total saldo token yang tersedia (${totalBalanceDisplay}). Transaksi dibatalkan.`);
        return;
    }

    amountDisplay = `${ethers.utils.formatUnits(amountInWei, decimals)} Token`;
  }

  // 4. Konfirmasi
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
  
  // 5. Eksekusi
  const tradePromises = signers.map(async signer => {
    // Hitung alokasi sell untuk setiap dompet
    let individualAmountInWei = amountInWei;
    
    // Ambil amountChoice lagi dari prompt untuk logika alokasi
    const amountChoice = prompts.sellAmountPrompt.answers.amountChoice;

    if (action === 'sell') {
      // Dapatkan saldo per dompet
      const currentBalance = await blockchain.getTokenBalance(tokenAddress, signer.address);
      
      if (amountChoice === '100') {
        // Jika menjual 100% dari total, maka dompet ini menjual saldonya sendiri
        individualAmountInWei = currentBalance;
      } else {
        // Jika menjual persentase/custom dari TOTAL, bagi rata di semua dompet.
        // Kita menggunakan pembagian integer BigNumber karena jumlah sudah dihitung sebelumnya.
        
        // Cek apakah amountInWei adalah hasil dari persentase/custom
        if (amountInWei.gt(0)) {
           // Bagi rata: Total Amount In Wei / Jumlah dompet
           individualAmountInWei = amountInWei.div(signers.length);
        }

      }
      
      // Cek Batas Atas: Jika bagian individu lebih besar dari saldo dompet, gunakan saldo dompet.
      if (currentBalance.lt(individualAmountInWei)) {
         individualAmountInWei = currentBalance;
      }
      
      // Jika saldo dompet nol, lewati
      if (individualAmountInWei.isZero()) {
         logger.warning(`[${signer.address}] Saldo token nol. Melewatkan transaksi.`);
         return;
      }
      
      logger.info(`[${signer.address}] Menjual: ${ethers.utils.formatUnits(individualAmountInWei, decimals)} Token...`);
    } else {
       // Untuk BUY, fundsInWei dan amountInWei sudah dihitung per dompet sebelumnya
       individualAmountInWei = amountInWei; 
    }
    
    // Eksekusi Trade
    return blockchain.tradeToken(action, signer, tokenAddress, individualAmountInWei, fundsInWei, false)
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
