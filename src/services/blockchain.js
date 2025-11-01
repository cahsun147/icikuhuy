// src/services/blockchain.js (Versi 5.7 - Final Fix Transfer & Refund)
const { ethers } = require('ethers');
const { CONTRACT_ADDRESSES, ABIS, RPC_MAINNET_URL, RPC_TESTNET_URL } = require('../utils/config');
const logger = require('../utils/logger');
const { loadMainWallet, loadMultiWallets } = require('./wallet');

let provider;
let currentNetwork;
let currentContracts;

// --- KONSTANTA GAS PRICE TETAP (Hanya untuk Bot/Simulasi Kontrak) ---
// Gas Price rendah untuk Volume Bot, dan sebagai fallback GasPrice untuk simulasi
const LOW_GAS_PRICE = ethers.utils.parseUnits("0.11", "gwei"); 
// Batas gas yang diestimasi manual untuk interaksi kontrak
const DEFAULT_GAS_LIMIT = ethers.BigNumber.from(400000); 

/**
 * Menginisialisasi Provider berdasarkan mode (Mainnet atau Testnet).
 * @param {boolean} isTestMode
 */
function initProvider(isTestMode) {
  const rpcUrl = isTestMode ? RPC_TESTNET_URL : RPC_MAINNET_URL;
  const networkName = isTestMode ? 'BSC_TESTNET' : 'BSC_MAINNET';
  
  if (!rpcUrl) {
    throw new Error(`RPC URL untuk ${networkName} tidak ditemukan di .env. Harap isi variabel ${isTestMode ? 'BSC_TESTNET_RPC_URL' : 'BSC_MAINNET_RPC_URL'}`);
  }
  
  if (provider && currentNetwork === networkName) {
    return; // Sudah diinisialisasi dengan benar
  }

  provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  currentNetwork = networkName;
  // Memastikan konfigurasi kontrak dimuat
  currentContracts = CONTRACT_ADDRESSES[networkName];
  if (!currentContracts) {
      throw new Error(`Konfigurasi kontrak untuk jaringan ${networkName} hilang di config.js`);
  }
  logger.info(`Provider terhubung ke: ${networkName}`);
}

function getProvider() {
  if (!provider) {
    // Ini seharusnya tidak pernah terpanggil jika mainLoop sudah benar
    throw new Error('Provider belum diinisialisasi. Panggil initProvider() terlebih dahulu.');
  }
  return provider;
}

function getCurrentContracts() {
    if (!currentContracts) {
        throw new Error('Kontrak belum diinisialisasi. Panggil initProvider() terlebih dahulu.');
    }
    return currentContracts;
}

async function getMainWalletSigner() {
  return loadMainWallet(getProvider());
}

async function getMultiWalletSigners() {
  return loadMultiWallets(getProvider());
}

function getContract(address, abi, signer) {
  return new ethers.Contract(address, abi, signer);
}

async function getBnbBalance(address) {
  const balance = await getProvider().getBalance(address);
  return ethers.utils.formatEther(balance);
}

/**
 * Mendapatkan saldo token (dalam format BigNumber)
 * @param {string} tokenAddress - Alamat kontrak token
 * @param {string} walletAddress - Alamat dompet
 * @returns {Promise<ethers.BigNumber>} Saldo token
 */
async function getTokenBalance(tokenAddress, walletAddress) {
  // Simulasi Saldo Token untuk Test Mode (selalu mengembalikan saldo besar agar simulasi trade berhasil)
  if (currentNetwork === 'BSC_TESTNET') {
      // Saldo fiktif 1 juta token (18 decimals)
      return ethers.utils.parseUnits("1000000", 18); 
  }
  
  const tokenContract = getContract(tokenAddress, ABIS.ERC20, getProvider());
  const balance = await tokenContract.balanceOf(walletAddress);
  return balance;
}

/**
 * Mendapatkan desimal token (0-18)
 * @param {string} tokenAddress - Alamat kontrak token
 * @returns {Promise<number>} Jumlah desimal
 */
async function getTokenDecimals(tokenAddress) {
  // Simulasi Desimal Token untuk Test Mode
  if (currentNetwork === 'BSC_TESTNET') {
      return 18; // Default untuk token fiktif
  }
  
  try {
    const tokenContract = getContract(tokenAddress, ABIS.ERC20, getProvider());
    const decimals = await tokenContract.decimals();
    return decimals;
  } catch (e) {
    logger.warning(`Gagal mendapatkan desimal untuk ${tokenAddress}. Menggunakan default 18.`);
    return 18;
  }
}

/**
 * Mendapatkan info manajer token (V1 atau V2) dari Helper V3.
 * @param {string} tokenAddress - Alamat Token
 * @returns {Promise<{version: number, tokenManagerAddress: string, quote: string}>}
 */
async function getTokenManagerInfo(tokenAddress) {
  if (currentNetwork === 'BSC_TESTNET') {
      // Mengembalikan respons simulasi yang sukses untuk melewati langkah ini
      return {
          version: 2, 
          tokenManagerAddress: getCurrentContracts().TOKEN_MANAGER_V2, 
          quote: ethers.constants.AddressZero // BNB
      };
  }
  
  try {
    const contracts = getCurrentContracts();
    const helperContract = getContract(
      contracts.TOKEN_MANAGER_HELPER_V3,
      ABIS.TOKEN_MANAGER_HELPER_V3,
      getProvider()
    );
    // (version, tokenManager, quote, lastPrice, ...)
    const info = await helperContract.getTokenInfo(tokenAddress);
    return {
      version: info.version.toNumber(),
      tokenManagerAddress: info.tokenManager,
      quote: info.quote,
    };
  } catch (e) {
    // Kontrak Helper tidak ada di Testnet, ini adalah penyebab error utama
    logger.error(`Gagal mendapatkan info token untuk ${tokenAddress}: call revert exception`);
    return null;
  }
}

/**
 * Memanggil createToken di TokenManagerV2 (menggunakan LOW_GAS_PRICE untuk simulasi)
 * @param {boolean} isTestMode - Menentukan apakah akan melakukan dry run.
 */
async function callCreateToken(signer, createArg, signature, isTestMode = false) {
  logger.info('Mengirim transaksi createToken ke blockchain...');
  const contracts = getCurrentContracts();
  const contract = getContract(
    contracts.TOKEN_MANAGER_V2,
    ABIS.TOKEN_MANAGER_V2,
    signer
  );

  if (isTestMode) {
    logger.warning('[TEST MODE] Transaksi Create Token disimulasikan. Tidak ada biaya BNB riil yang dikeluarkan.');
    // Simulasi berhasil dan mengembalikan alamat token fiktif
    return { receipt: { transactionHash: '0xSIMULATED_CREATE_TOKEN_HASH' }, tokenAddress: '0xSimulatedTokenAddressForTest' };
  }
  
  try {
    const tx = await contract.createToken(createArg, signature, {
      gasPrice: LOW_GAS_PRICE, 
      gasLimit: DEFAULT_GAS_LIMIT,
    });
    logger.info(`Transaksi dikirim: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.success('Transaksi dikonfirmasi!');
    
    // Cari event TokenCreate untuk mendapatkan alamat token baru
    const iface = new ethers.utils.Interface(ABIS.TOKEN_MANAGER_V2);
    let tokenAddress = null;
    for (const log of receipt.logs) {
      try {
        const parsedLog = iface.parseLog(log);
        if (parsedLog.name === 'TokenCreate') {
          tokenAddress = parsedLog.args.token;
          logger.success(`Token baru dibuat di alamat: ${tokenAddress}`);
          break;
        }
      } catch (e) {
        // Abaikan log yang tidak bisa di-parse
      }
    }
    
    if (!tokenAddress) {
      logger.warning('Tidak dapat menemukan event TokenCreate di receipt.');
    }
    return { receipt, tokenAddress };

  } catch (e) {
    logger.error(`Transaksi createToken gagal: ${e.message}`);
    if (e.data) {
       logger.error(`Revert reason: ${e.data}`);
    }
    return { receipt: null, tokenAddress: null };
  }
}

/**
 * Fund Wallets: Menggunakan Gas Price Otomatis agar Transfer Testnet berhasil.
 */
async function fundWallets(mainSigner, multiWalletAddresses, amountInEth, isTestMode = false) {
  logger.info(`Mengirim ${amountInEth} BNB ke ${multiWalletAddresses.length} dompet...`);
  
  if (isTestMode) {
      logger.info('[TEST MODE] Eksekusi transfer BNB di Testnet (Transfer BNB Testnet tidak disimulasikan).');
  }

  const amountInWei = ethers.utils.parseEther(amountInEth);
  
  // Mengirim semua transaksi secara paralel dengan pelaporan status
  const promises = multiWalletAddresses.map(address => {
    return (async () => {
        // Gunakan Gas Price otomatis (tidak disetel manual) untuk fix REPLACEMENT_UNDERPRICED
        const tx = await mainSigner.sendTransaction({
            to: address,
            value: amountInWei,
            // Hapus gasPrice/gasLimit untuk membiarkan Ethers/Provider menentukan yang optimal
        });
        const receipt = await tx.wait();
        return { address, txHash: receipt.transactionHash };
    })()
    .catch(error => ({ 
        status: 'rejected', 
        address, // Sertakan alamat untuk pelaporan error
        error: error.reason || (error.error && error.error.message) || String(error) 
    }));
  });

  const results = await Promise.allSettled(promises);
  
  // Pelaporan status
  results.forEach((result, index) => {
      // Ambil alamat dari data yang dikirim oleh promise (baik fulfilled maupun rejected)
      const data = result.status === 'fulfilled' ? result.value : result.reason;
      const address = data.address;
      const addressShort = address ? `${address.substring(0, 8)}...${address.substring(address.length - 4)}` : `Wallet ${index + 1}`;
      
      if (result.status === 'fulfilled') {
          logger.success(`[Wallet ${index + 1} ${addressShort}] Berhasil (Tx: ${result.value.txHash.substring(0, 8)})`);
      } else {
          logger.error(`[Wallet ${index + 1} ${addressShort}] Gagal: ${result.reason.error || result.reason}`);
      }
  });

  const failedCount = results.filter(r => r.status === 'rejected').length;
  if (failedCount > 0) {
      throw new Error(`Gagal mendanai ${failedCount} dompet.`); // Throw error agar tertangkap di handleManageWallets
  }
  logger.success('Semua dompet berhasil didanai.');
}

/**
 * Refund Wallets: Menggunakan Gas Price Otomatis agar Transfer Testnet berhasil.
 */
async function refundWallets(multiSigners, mainWalletAddress, isTestMode = false) {
  logger.info(`Mengembalikan semua BNB dari ${multiSigners.length} dompet ke ${mainWalletAddress}...`);
  
  if (isTestMode) {
      logger.info('[TEST MODE] Eksekusi refund BNB di Testnet (Refund BNB Testnet tidak disimulasikan).');
  }
  
  const promises = multiSigners.map((signer) => {
    return (async () => {
        const balance = await signer.getBalance();
        
        // Dapatkan gas price saat ini (otomatis)
        const gasPrice = await getProvider().getGasPrice();
        const gasLimit = ethers.BigNumber.from(21000); // Standard transfer gas limit
        const gasCost = gasPrice.mul(gasLimit);
        
        const valueToSend = balance.sub(gasCost);

        if (valueToSend.lte(0)) {
            return { address: signer.address, message: 'Saldo tidak cukup untuk gas.' };
        }
        
        logger.info(`[${signer.address}] Mengirim ${ethers.utils.formatEther(valueToSend)} BNB...`);
        
        const tx = await signer.sendTransaction({
            to: mainWalletAddress,
            value: valueToSend,
            // Hapus gasPrice/gasLimit untuk membiarkan Ethers/Provider menentukan yang optimal
        });
        const receipt = await tx.wait();
        return { address: signer.address, txHash: receipt.transactionHash };
    })()
    .then(result => ({ status: 'fulfilled', value: result })) // Wrap hasil sukses
    .catch(error => ({ 
        status: 'rejected', 
        address: signer.address, 
        error: error.reason || (error.error && error.error.message) || String(error) 
    }));
  });

  // Karena kita sudah menangani reject di dalam promise.map, kita hanya perlu resolve di sini
  const results = await Promise.all(promises); 
  
  // Pelaporan status
  results.forEach((result, index) => {
      const data = result.status === 'fulfilled' ? result.value : result.reason;
      const address = data.address;
      const addressShort = address ? `${address.substring(0, 8)}...${address.substring(address.length - 4)}` : `Wallet ${index + 1}`;
      
      if (result.status === 'fulfilled' && result.value) {
          const message = result.value.message || `Berhasil (Tx: ${result.value.txHash.substring(0, 8)})`;
          logger.success(`[Wallet ${index + 1} ${addressShort}] ${message}`);
      } else {
          logger.error(`[Wallet ${index + 1} ${addressShort}] Gagal: ${result.reason.error || result.reason}`);
      }
  });

  const failedCount = results.filter(r => r.status === 'rejected').length;
  if (failedCount > 0) {
      throw new Error(`Gagal merefund ${failedCount} dompet.`); // Throw error agar tertangkap di handleManageWallets
  }
  logger.success('Proses refund selesai.');
}

/**
 * Fungsi trade (buy/sell) terpadu
 */
async function tradeToken(action, signer, tokenAddress, amountInWei, fundsInWei = '0', tradeOptions = {}) {
  const info = await getTokenManagerInfo(tokenAddress);
  if (!info) {
    // Gunakan throw yang lebih spesifik agar tertangkap di handleTrade
    throw new Error('Tidak bisa mendapatkan info token manager.');
  }

  const { version, tokenManagerAddress, quote } = info;
  
  // Script ini hanya mendukung BNB (quote == 0x0)
  if (quote !== ethers.constants.AddressZero) {
    throw new Error('Token ini menggunakan BEP20 sebagai quote, tidak didukung oleh script ini.');
  }
  
  let abi;
  let contract;
  
  if (version === 1) {
    abi = ABIS.TOKEN_MANAGER_V1;
  } else if (version === 2) {
    abi = ABIS.TOKEN_MANAGER_V2;
  } else {
    throw new Error(`Versi TokenManager tidak dikenal: ${version}`);
  }
  
  contract = getContract(tokenManagerAddress, abi, signer);

  let tx;
  
  // --- DRY RUN / SIMULASI ---
  if (tradeOptions.isTestMode) {
    logger.warning(`[TEST MODE] Transaksi ${action.toUpperCase()} disimulasikan. Tidak ada biaya BNB riil yang dikeluarkan.`);
    // Simulasi berhasil
    return { transactionHash: '0xSIMULATED_TRADE_HASH' };
  }
  // --- END DRY RUN ---

  // *** IMPLEMENTASI GAS PRICE BERSYARAT & CUSTOM ***
  const finalGasPrice = tradeOptions.isBot ? LOW_GAS_PRICE : ethers.utils.parseUnits(tradeOptions.gwei.toString(), "gwei");
  const minAmountOrFundsSlippage = parseFloat(tradeOptions.slippage);
  
  logger.info(`[${signer.address}] Menggunakan Gas Price: ${ethers.utils.formatUnits(finalGasPrice, "gwei")} Gwei`);

  // Opsi transaksi dasar
  let txOptions = {
    gasLimit: DEFAULT_GAS_LIMIT,
    gasPrice: finalGasPrice,
  };
  
  // Hitung Slippage/minFunds untuk V2 (V1 minAmount/maxFunds di set di handleTrade)
  let minAmountWei = ethers.BigNumber.from(0); 

  if (action === 'buy') {
    
    // Perhitungan minAmount (Slippage) untuk V2: minAmount = estimatedAmount * (1 - slippage%)
    // Karena kita tidak memiliki fungsi tryBuy di sini, kita akan menyederhanakan
    // Jika slippage > 0, kita akan menghitung minAmount.
    if (minAmountOrFundsSlippage && minAmountOrFundsSlippage > 0) {
        logger.warning("Perhatian: Perhitungan minAmount Buy (slippage) tanpa tryBuy bersifat spekulatif. Set minAmount = 0 jika tidak yakin.");
    }
    
    // Untuk V1, minAmount selalu 0 di purchaseTokenAMAP, V2 bisa minAmount > 0
    // Karena kita tidak bisa memprediksi jumlah token yang akan diterima (tryBuy tidak dipanggil),
    // kita akan membiarkan minAmount tetap 0 untuk Buy, kecuali jika BuyAmount digunakan.

    if (fundsInWei.gt(0)) {
      // Pembelian dengan dana (BNB) spesifik (AMAP)
      logger.info(`[${signer.address}] Membeli ${ethers.utils.formatEther(fundsInWei)} BNB...`);
      const methodName = version === 1 ? 'purchaseTokenAMAP(address,uint256,uint256)' : 'buyTokenAMAP(address,uint256,uint256)';
      
      // Jika Buy, minAmount adalah minimum token yang akan diterima. Kita set 0 untuk membatasi slippage.
      txOptions.value = fundsInWei; 
      minAmountWei = ethers.BigNumber.from(0); 
      tx = await contract[methodName](tokenAddress, fundsInWei, minAmountWei, txOptions); 
      
    } else {
      // Pembelian dengan jumlah token spesifik
      logger.info(`[${signer.address}] Membeli ${ethers.utils.formatUnits(amountInWei, await getTokenDecimals(tokenAddress))} token...`);
      const methodName = version === 1 ? 'purchaseToken(address,uint256,uint256)' : 'buyToken(address,uint256,uint256)';
      
      // maxFunds (param terakhir) dihitung berdasarkan Slippage (%)
      // Kita set 1000 BNB + slippage% untuk memastikan transaksi terkirim, lalu biarkan kontrak membatalkan.
      const maxFundsBase = ethers.utils.parseEther('1000'); 
      const maxFunds = maxFundsBase.mul(100 + minAmountOrFundsSlippage).div(100); 
      
      txOptions.value = maxFunds;
      tx = await contract[methodName](tokenAddress, amountInWei, maxFunds, txOptions);
    }
  } else if (action === 'sell') {
    const decimals = await getTokenDecimals(tokenAddress);
    logger.info(`[${signer.address}] Menjual ${ethers.utils.formatUnits(amountInWei, decimals)} token...`);
    
    // 1. Approve
    const tokenContract = getContract(tokenAddress, ABIS.ERC20, signer);
    const allowance = await tokenContract.allowance(signer.address, tokenManagerAddress);
    
    if (allowance.lt(amountInWei)) {
      logger.info(`[${signer.address}] Menyetujui (Approve) token...`);
      const approveTx = await tokenContract.approve(tokenManagerAddress, ethers.constants.MaxUint256, txOptions);
      await approveTx.wait();
      logger.info(`[${signer.address}] Approve berhasil.`);
    }
    
    // 2. Sell
    if (version === 1) {
      // V1: saleToken(address tokenAddress, uint256 amount)
      const methodName = 'saleToken(address,uint256)';
      tx = await contract[methodName](tokenAddress, amountInWei, txOptions); // V1 tidak mendukung minFunds
    } else {
      // V2: sellToken(address token, uint256 amount, uint256 minFunds)
      const methodName = 'sellToken(address,uint256,uint256)';
      
      // minFunds di V2 adalah minimum dana yang diterima (BNB)
      minAmountWei = ethers.BigNumber.from(0); 
      
      tx = await contract[methodName](tokenAddress, amountInWei, minAmountWei, txOptions); 
    }
  } else {
    throw new Error('Aksi tidak dikenal');
  }
  
  return tx.wait();
}

module.exports = {
  initProvider, // BARU
  getProvider,
  getCurrentContracts, // BARU
  getMainWalletSigner,
  getMultiWalletSigners,
  getBnbBalance,
  getTokenBalance,
  getTokenDecimals, 
  getTokenManagerInfo,
  callCreateToken,
  fundWallets,
  refundWallets,
  tradeToken,
};
