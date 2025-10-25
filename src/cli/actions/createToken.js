// src/cli/actions/createToken.js (Versi 3.0 - Fix API Test Mode)
const { ethers } = require('ethers');
const blockchain = require('../../services/blockchain');
const api = require('../../services/api');
const prompts = require('../prompts');
const logger = require('../../utils/logger');
const { tradeToken } = require('../../services/blockchain');

/**
 * Alur Penuh (Step 1-4 + On-chain Call)
 * @param {boolean} isTestMode - Apakah menggunakan mode uji coba
 */
async function handleCreateToken(isTestMode = false) {
  const signer = await blockchain.getMainWalletSigner();
  logger.info(`Menggunakan alamat kreator: ${signer.address}`);
  
  // Jika Test Mode, kita bypass API off-chain
  if (isTestMode) {
      logger.warning('[TEST MODE] Melewati langkah API off-chain (Nonce, Login, Upload, Get Args) karena API kemungkinan tidak mendukung Testnet.');
      const tokenAddressSimulated = '0xSimulatedTokenAddressForTest';
      
      // Langsung lompat ke konfirmasi
      const { confirm: confirmSimulated } = await prompts.confirmActionPrompt('Lanjutkan simulasi pembuatan token?');
      if (!confirmSimulated) {
          logger.warning('Pembuatan token dibatalkan.');
          return;
      }
      
      // Simulasi panggilan on-chain
      const { tokenAddress } = await blockchain.callCreateToken(
          signer,
          '0x0', // Args dummy
          '0x0', // Signature dummy
          isTestMode
      );
      
      // Lanjutkan ke Bundle Buy Simulasi
      const { bundleAction } = await prompts.createTokenSubMenu();
      if (bundleAction === 'create_and_buy') {
          const { buyAmountEth } = await prompts.bundleBuyPrompt();
          const fundsInWei = ethers.utils.parseEther(buyAmountEth);
          const multiSigners = await blockchain.getMultiWalletSigners();
          
          if (multiSigners.length === 0) {
              logger.warning('Tidak ada multi-wallet untuk membeli.');
              return;
          }

          logger.info(`Memulai bundle buy simulasi untuk ${tokenAddress} dengan ${multiSigners.length} dompet...`);
          const bundleTradeOptions = { isBot: true, gwei: '0.11', slippage: '1', isTestMode }; 
          
          const buyPromises = multiSigners.map(signer => 
              tradeToken('buy', signer, tokenAddress, '0', fundsInWei, bundleTradeOptions)
                  .catch(e => logger.error(`Gagal buy dari ${signer.address}: ${e.message}`))
          );
              
          await Promise.all(buyPromises);
          logger.success('Bundle buy simulasi selesai.');
      }
      return;
  }
  // --- END TEST MODE BYPASS ---


  // 1. Dapatkan input dari pengguna
  const tokenParams = await prompts.createTokenPrompts();
  
  // 2. Alur API Off-chain
  // Step 1: Get Nonce
  const nonce = await api.getNonce(signer.address);
  if (!nonce) return;

  // Step 2: Sign message & Login
  const message = `You are sign in Meme {${nonce}}`;
  const signature = await signer.signMessage(message);
  const accessToken = await api.login(signer.address, signature, nonce);
  if (!accessToken) return;
  
  // Step 3: Upload Image
  const imgUrl = await api.uploadImage(tokenParams.imagePath, accessToken);
  if (!imgUrl) return;
  logger.info(`URL Gambar: ${imgUrl}`); // <-- FITUR BARU: Log URL

  // 3. Susun data token lengkap
  const fullTokenData = {
    name: tokenParams.name,
    shortName: tokenParams.shortName,
    desc: tokenParams.desc,
    imgUrl: imgUrl,
    launchTime: Date.now(), // Gunakan waktu sekarang
    label: tokenParams.label,
    webUrl: tokenParams.webUrl || "",
    twitterUrl: tokenParams.twitterUrl || "",
    telegramUrl: tokenParams.telegramUrl || "",
    preSale: tokenParams.preSale || "0",
    onlyMPC: tokenParams.onlyMPC,
  };

  // Step 4: Get createArg and signature from API
  const createParams = await api.getCreateTokenParams(fullTokenData, accessToken);
  if (!createParams) return;
  
  // 4. Minta Konfirmasi
  logger.info('\n--- KONFIRMASI CREATE TOKEN ---');
  logger.info(` Nama: ${fullTokenData.name} (${fullTokenData.shortName})`);
  logger.info(` Label: ${fullTokenData.label}`);
  logger.info(` Desc: ${fullTokenData.desc}`);
  logger.info(` Img: ${fullTokenData.imgUrl}`);
  logger.info(` MPC Only: ${fullTokenData.onlyMPC}`);
  logger.info(` Kreator: ${signer.address}`);
  if (isTestMode) logger.warning('MODE UJI COBA AKTIF');
  logger.info('---------------------------------');
  
  const { confirm } = await prompts.confirmActionPrompt('Lanjutkan membuat token ini?');
  if (!confirm) {
    logger.warning('Pembuatan token dibatalkan.');
    return;
  }

  // 5. Panggil Kontrak On-chain
  const { receipt, tokenAddress } = await blockchain.callCreateToken(
    signer,
    createParams.createArg,
    createParams.signature,
    isTestMode // Meneruskan isTestMode
  );

  if (!tokenAddress) {
    logger.error('Token gagal dibuat di blockchain.');
    return;
  }
  
  // 6. Tampilkan sub-menu (Create vs Bundle)
  const { bundleAction } = await prompts.createTokenSubMenu();
  
  if (bundleAction === 'create_and_buy') {
    const { buyAmountEth } = await prompts.bundleBuyPrompt();
    const fundsInWei = ethers.utils.parseEther(buyAmountEth);
    const multiSigners = await blockchain.getMultiWalletSigners();
    
    if (multiSigners.length === 0) {
      logger.warning('Tidak ada multi-wallet untuk membeli. Harap buat dompet terlebih dahulu.');
      return;
    }

    logger.info(`Memulai bundle buy untuk ${tokenAddress} dengan ${multiSigners.length} dompet...`);
    
    // Konfirmasi lagi untuk bundle buy
    const { confirm: confirmBundle } = await prompts.confirmActionPrompt(
      `Yakin akan membeli ${buyAmountEth} BNB per dompet (${multiSigners.length} dompet)?`
    );
    if (!confirmBundle) {
      logger.warning('Bundle buy dibatalkan.');
      return;
    }

    // Opsi trade untuk bundle buy
    const bundleTradeOptions = { isBot: true, gwei: '0.11', slippage: '1', isTestMode }; 
    
    const buyPromises = multiSigners.map(signer => 
      tradeToken('buy', signer, tokenAddress, '0', fundsInWei, bundleTradeOptions)
        .catch(e => logger.error(`Gagal buy dari ${signer.address}: ${e.message}`))
    );
        
    await Promise.all(buyPromises);
    logger.success('Bundle buy selesai.');
  }
}

module.exports = {
  handleCreateToken,
};
