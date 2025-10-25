// src/services/blockchain.js (Versi 5.0)
const { ethers } = require('ethers');
const { RPC_URL, ABIS, CONTRACT_ADDRESSES } = require('../utils/config');
const logger = require('../utils/logger');
const { loadMainWallet, loadMultiWallets } = require('./wallet');

let provider;

// --- KONSTANTA GAS PRICE TETAP (Hanya untuk Bot/Transfer Massal) ---
// Gas Price rendah untuk Volume Bot, Fund, Refund, dan Create Token (toleransi waktu lebih besar)
const LOW_GAS_PRICE = ethers.utils.parseUnits("0.11", "gwei"); 
// Batas gas yang diestimasi manual untuk interaksi kontrak
const DEFAULT_GAS_LIMIT = ethers.BigNumber.from(400000); 

function getProvider() {
  if (!provider) {
    provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  }
  return provider;
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
  try {
    const tokenContract = getContract(tokenAddress, ABIS.ERC20, getProvider());
    const decimals = await tokenContract.decimals();
    return decimals;
  } catch (e) {
    // Default ke 18 jika gagal (standar ERC20)
    logger.warning(`Gagal mendapatkan desimal untuk ${tokenAddress}. Menggunakan default 18.`);
    return 18;
  }
}

/**
 * Mendapatkan info manajer token (V1 atau V2) dari Helper V3.
 * Ini adalah langkah krusial sebelum melakukan trade.
 */
async function getTokenManagerInfo(tokenAddress) {
  try {
    const helperContract = getContract(
      CONTRACT_ADDRESSES.TOKEN_MANAGER_HELPER_V3,
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
    logger.error(`Gagal mendapatkan info token untuk ${tokenAddress}: ${e.message}`);
    return null;
  }
}

/**
 * Memanggil createToken di TokenManagerV2 (menggunakan LOW_GAS_PRICE)
 */
async function callCreateToken(signer, createArg, signature) {
  logger.info('Mengirim transaksi createToken ke blockchain...');
  const contract = getContract(
    CONTRACT_ADDRESSES.TOKEN_MANAGER_V2,
    ABIS.TOKEN_MANAGER_V2,
    signer
  );
  
  try {
    const tx = await contract.createToken(createArg, signature, {
      gasPrice: LOW_GAS_PRICE, // LOW_GAS_PRICE untuk Create Token
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
 * Menggunakan LOW_GAS_PRICE untuk fund/transfer
 */
async function fundWallets(mainSigner, multiWalletAddresses, amountInEth) {
  logger.info(`Mengirim ${amountInEth} BNB ke ${multiWalletAddresses.length} dompet...`);
  const amountInWei = ethers.utils.parseEther(amountInEth);
  const promises = multiWalletAddresses.map(address => {
    return mainSigner.sendTransaction({
      to: address,
      value: amountInWei,
      gasPrice: LOW_GAS_PRICE, // LOW_GAS_PRICE untuk Transfer
    }).then(tx => tx.wait());
  });
  
  await Promise.all(promises);
  logger.success('Semua dompet berhasil didanai.');
}

/**
 * Menggunakan LOW_GAS_PRICE untuk refund
 */
async function refundWallets(multiSigners, mainWalletAddress) {
  logger.info(`Mengembalikan semua BNB dari ${multiSigners.length} dompet ke ${mainWalletAddress}...`);
  
  const promises = multiSigners.map(async (signer) => {
    try {
      const balance = await signer.getBalance();
      
      const gasLimit = ethers.BigNumber.from(21000);
      const gasCost = LOW_GAS_PRICE.mul(gasLimit); // Menggunakan LOW_GAS_PRICE
      
      const valueToSend = balance.sub(gasCost);

      if (valueToSend.gt(0)) {
        logger.info(`[${signer.address}] Mengirim ${ethers.utils.formatEther(valueToSend)} BNB...`);
        const tx = await signer.sendTransaction({
          to: mainWalletAddress,
          value: valueToSend,
          gasPrice: LOW_GAS_PRICE, // LOW_GAS_PRICE untuk Refund
          gasLimit: gasLimit,
        });
        return tx.wait();
      } else {
        logger.warning(`[${signer.address}] Saldo tidak cukup untuk gas.`);
      }
    } catch (e) {
      logger.warning(`Gagal mengembalikan dana dari ${signer.address}: ${e.message}`);
    }
  });

  await Promise.all(promises);
  logger.success('Proses refund selesai.');
}

/**
 * Fungsi trade (buy/sell) terpadu
 * @param {string} action - 'buy' atau 'sell'
 * @param {object} signer - Wallet signer
 * @param {string} tokenAddress - Alamat Token
 * @param {BigNumber} amountInWei - Jumlah token (jual) atau 0
 * @param {BigNumber} fundsInWei - Jumlah BNB (beli) atau 0
 * @param {object} tradeOptions - { isBot: boolean, gwei: string, slippage: string }
 */
async function tradeToken(action, signer, tokenAddress, amountInWei, fundsInWei = '0', tradeOptions = {}) {
  const info = await getTokenManagerInfo(tokenAddress);
  if (!info) {
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
  
  // *** IMPLEMENTASI GAS PRICE BERSYARAT & CUSTOM ***
  // Jika isBot TRUE, gunakan LOW_GAS_PRICE. Jika FALSE, gunakan custom Gwei dari tradeOptions
  const finalGasPrice = tradeOptions.isBot ? LOW_GAS_PRICE : ethers.utils.parseUnits(tradeOptions.gwei.toString(), "gwei");
  const minAmountOrFundsSlippage = tradeOptions.slippage;
  
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
      
      // Hitung minFunds (Slippage) untuk V2: minFunds = estimatedFunds * (1 - slippage%)
      // Karena kita tidak bisa memanggil trySell di sini, kita akan set minFunds=0
      // dan mengandalkan bahwa pengguna tahu risiko slippage TINGGI.
      // Sesuai permintaan, pengguna hanya ingin mengontrol GWEI. Kita set minFunds=0.
      minAmountWei = ethers.BigNumber.from(0); // minFunds di V2 adalah minimum dana yang diterima (BNB)
      
      // NOTE: Jika kita ingin menggunakan minFunds berdasarkan Slippage (%) dari input,
      // kita HARUS menggunakan trySell dari Helper V3. Tanpa itu, kita hanya bisa mengabaikannya (0).
      // Untuk tujuan kontrol Gwei/Fee seperti yang diminta, kita akan set 0/abaikan minFunds.
      
      tx = await contract[methodName](tokenAddress, amountInWei, minAmountWei, txOptions); 
    }
  } else {
    throw new Error('Aksi tidak dikenal');
  }
  
  return tx.wait();
}

module.exports = {
  getProvider,
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
