// src/services/blockchain.js
const { ethers } = require('ethers');
const { RPC_URL, ABIS, CONTRACT_ADDRESSES } = require('../utils/config');
const logger = require('../utils/logger');
const { loadMainWallet, loadMultiWallets } = require('./wallet');

let provider;

// --- KONSTANTA GAS PRICE (VERSATILITY) ---
// Gas Price agresif untuk transaksi sensitif waktu (Buy/Sell manual)
const AGGRESSIVE_GAS_PRICE = ethers.utils.parseUnits("1.5", "gwei"); 
// Gas Price rendah untuk Volume Bot, Fund, Refund, dan Create Token (toleransi waktu lebih besar)
const LOW_GAS_PRICE = ethers.utils.parseUnits("0.11", "gwei"); 
// Batas gas yang diestimasi manual untuk interaksi kontrak, untuk menghindari UNPREDICTABLE_GAS_LIMIT saat saldo rendah
const MANUAL_GAS_LIMIT = ethers.BigNumber.from(400000); 

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

async function getTokenBalance(tokenAddress, walletAddress) {
  const tokenContract = getContract(tokenAddress, ABIS.ERC20, getProvider());
  const balance = await tokenContract.balanceOf(walletAddress);
  return balance;
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
      gasLimit: MANUAL_GAS_LIMIT,
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
 * @param {boolean} isBot - Apakah dipanggil dari Volume Bot.
 */
async function tradeToken(action, signer, tokenAddress, amountInWei, fundsInWei = '0', isBot = false) {
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
  
  // *** IMPLEMENTASI GAS PRICE BERSYARAT ***
  const selectedGasPrice = isBot ? LOW_GAS_PRICE : AGGRESSIVE_GAS_PRICE;
  logger.info(`[${signer.address}] Menggunakan Gas Price: ${ethers.utils.formatUnits(selectedGasPrice, "gwei")} Gwei`);

  // Opsi transaksi dasar
  let txOptions = {
    gasLimit: MANUAL_GAS_LIMIT,
    gasPrice: selectedGasPrice,
  };

  if (action === 'buy') {
    // Sesuai API-Documents.md, V1 & V2 punya method serupa
    
    if (fundsInWei.gt(0)) {
      logger.info(`[${signer.address}] Membeli ${ethers.utils.formatEther(fundsInWei)} BNB...`);
      // V1: purchaseTokenAMAP(address token, uint256 funds, uint256 minAmount)
      // V2: buyTokenAMAP(address token, uint256 funds, uint256 minAmount)
      const methodName = version === 1 ? 'purchaseTokenAMAP(address,uint256,uint256)' : 'buyTokenAMAP(address,uint256,uint256)';
      
      txOptions.value = fundsInWei; 
      tx = await contract[methodName](tokenAddress, fundsInWei, 0, txOptions); 
      
    } else {
      logger.info(`[${signer.address}] Membeli ${ethers.utils.formatEther(amountInWei)} token...`);
      // V1: purchaseToken(address token, uint256 amount, uint256 maxFunds)
      // V2: buyToken(address token, uint256 amount, uint256 maxFunds)
      const methodName = version === 1 ? 'purchaseToken(address,uint256,uint256)' : 'buyToken(address,uint256,uint256)';
      // maxFunds (param terakhir) di-set sangat tinggi
      const maxFunds = ethers.utils.parseEther('1000'); 
      
      txOptions.value = maxFunds; // Walaupun hanya 'maxFunds', ini tetap dikirim sebagai 'value'
      tx = await contract[methodName](tokenAddress, amountInWei, maxFunds, txOptions);
    }
  } else if (action === 'sell') {
    logger.info(`[${signer.address}] Menjual ${ethers.utils.formatEther(amountInWei)} token...`);
    
    // 1. Approve
    const tokenContract = getContract(tokenAddress, ABIS.ERC20, signer);
    const allowance = await tokenContract.allowance(signer.address, tokenManagerAddress);
    
    if (allowance.lt(amountInWei)) {
      logger.info(`[${signer.address}] Menyetujui (Approve) token...`);
      // Approve juga diset dengan Gas Price yang dipilih
      const approveTx = await tokenContract.approve(tokenManagerAddress, ethers.constants.MaxUint256, txOptions);
      await approveTx.wait();
      logger.info(`[${signer.address}] Approve berhasil.`);
    }
    
    // 2. Sell
    if (version === 1) {
      // V1: saleToken(address tokenAddress, uint256 amount)
      const methodName = 'saleToken(address,uint256)';
      tx = await contract[methodName](tokenAddress, amountInWei, txOptions);
    } else {
      // V2: sellToken(address token, uint256 amount, uint256 minFunds)
      const methodName = 'sellToken(address,uint256,uint256)';
      tx = await contract[methodName](tokenAddress, amountInWei, 0, txOptions); // 0 = minFunds
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
  getTokenManagerInfo,
  callCreateToken,
  fundWallets,
  refundWallets,
  tradeToken,
};