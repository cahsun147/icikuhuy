// src/services/wallet.js
const { ethers } = require('ethers');
const fs = require('fs-extra');
const { WALLETS_FILE_PATH, MAIN_WALLET_PK } = require('../utils/config');
const logger = require('../utils/logger');

// PERINGATAN KEAMANAN: Menyimpan private key dalam file JSON tidak aman.
// Ini hanya untuk tujuan demonstrasi.
// Gunakan solusi yang lebih aman (seperti vault terenkripsi) untuk produksi.

async function loadMainWallet(provider) {
  if (!MAIN_WALLET_PK) {
    throw new Error('MAIN_WALLET_PRIVATE_KEY tidak ditemukan di .env');
  }
  try {
    const wallet = new ethers.Wallet(MAIN_WALLET_PK, provider);
    return wallet;
  } catch (e) {
    logger.error(`Gagal memuat dompet utama: ${e.message}`);
    process.exit(1);
  }
}

async function loadMultiWallets(provider) {
  if (!fs.existsSync(WALLETS_FILE_PATH)) {
    return [];
  }
  try {
    const walletsJson = await fs.readJson(WALLETS_FILE_PATH);
    const wallets = walletsJson.map(item => new ethers.Wallet(item.privateKey, provider));
    return wallets;
  } catch (e) {
    logger.error(`Gagal memuat multi-dompet: ${e.message}`);
    return [];
  }
}

async function saveMultiWallets(wallets) {
  const walletsJson = wallets.map(wallet => ({
    address: wallet.address,
    privateKey: wallet.privateKey,
  }));
  try {
    await fs.writeJson(WALLETS_FILE_PATH, walletsJson, { spaces: 2 });
    logger.success(`Berhasil menyimpan ${wallets.length} dompet ke ${WALLETS_FILE_PATH}`);
  } catch (e) {
    logger.error(`Gagal menyimpan dompet: ${e.message}`);
  }
}

async function generateWallets(count, provider) {
  logger.info(`Membuat ${count} dompet baru...`);
  const existingWallets = await loadMultiWallets(provider);
  const newWallets = [];
  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom().connect(provider);
    newWallets.push(wallet);
  }
  
  const allWallets = [...existingWallets, ...newWallets];
  await saveMultiWallets(allWallets);
  return allWallets;
}

module.exports = {
  loadMainWallet,
  loadMultiWallets,
  generateWallets,
  saveMultiWallets,
};