// src/cli/prompts.js
const inquirer = require('inquirer');
const { LABELS } = require('../utils/config');

const mainMenu = () => {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Pilih aksi:',
      loop: false, // <-- FIX: Mencegah infinite scroll
      choices: [
        { name: '1. Create Token', value: 'create' },
        { name: '2. Generate Multiwallet', value: 'generate' },
        { name: '3. Funding (Main to MultiWallet)', value: 'fund' }, // OPSI FUNDING BARU
        { name: '4. Sniper Token (Monitor Event)', value: 'snipe' },
        { name: '5. Buy Token (by CA)', value: 'buy' },
        { name: '6. Sell Token (by CA)', value: 'sell' },
        { name: '7. Volume Bot (by CA)', value: 'volume' },
        { name: '8. Refund BNB (Multi to Main)', value: 'refund' }, // Pindah ke urutan 8
        new inquirer.Separator(),
        { name: 'Keluar', value: 'exit' },
      ],
    },
  ]);
};

// ... (createTokenPrompts tidak berubah, kecuali pesan untuk imagePath) ...

const createTokenPrompts = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Nama Token (e.g., "Release"):',
      validate: input => input ? true : 'Nama tidak boleh kosong',
    },
    {
      type: 'input',
      name: 'shortName',
      message: 'Symbol/Ticker (e.g., "RELS"):',
      validate: input => input ? true : 'Symbol tidak boleh kosong',
    },
    {
      type: 'input',
      name: 'desc',
      message: 'Deskripsi Token:',
    },
    {
      type: 'input',
      name: 'imagePath',
      message: 'Path ke file gambar (e.g., ./token.png). Gambar akan di-upload setelah login:',
      validate: input => input ? true : 'Path gambar tidak boleh kosong',
    },
    {
      type: 'list',
      name: 'label',
      message: 'Pilih Kategori (Label):',
      choices: LABELS,
    },
    {
      type: 'input',
      name: 'webUrl',
      message: 'Project Website (opsional):',
    },
    {
      type: 'input',
      name: 'twitterUrl',
      message: 'Project Twitter (opsional, e.g., https://x.com/example):',
    },
    {
      type: 'input',
      name: 'telegramUrl',
      message: 'Project Telegram (opsional):',
    },
    {
      type: 'input',
      name: 'preSale',
      message: 'BNB Presale (dibuat oleh kreator, "0" jika tidak ada):',
      default: '0',
    },
    {
      type: 'confirm',
      name: 'onlyMPC',
      message: 'Mode Binance MPC Wallet (HANYA bisa ditrading via Binance MPC)?',
      default: false,
    },
  ]);
};


const createTokenSubMenu = () => {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'bundleAction',
      message: 'Pilih aksi selanjutnya:',
      loop: false,
      choices: [
        { name: '1. Create Token (Hanya membuat)', value: 'create_only' },
        { name: '2. Create Token (Bundle - Beli dengan multi-wallet setelah dibuat)', value: 'create_and_buy' },
      ],
    },
  ]);
};

const bundleBuyPrompt = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'buyAmountEth',
      message: 'Jumlah BNB (e.g., "0.01") yang akan digunakan oleh SETIAP multi-wallet untuk membeli:',
      validate: input => (parseFloat(input) > 0) ? true : 'Jumlah harus angka desimal lebih besar dari 0',
    }
  ]);
};

const generateWalletPrompts = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'count',
      message: 'Jumlah dompet baru yang akan dibuat:',
      validate: input => (parseInt(input, 10) > 0) ? true : 'Jumlah harus angka lebih besar dari 0',
    },
  ]);
};

// fundWalletsPrompts disederhanakan karena tidak ada lagi Custom vs Default
const fundWalletsPrompts = () => {
  const message = 'Jumlah BNB (e.g., "0.01") yang akan dikirim dari MAIN wallet ke SETIAP multi-wallet:';
    
  return inquirer.prompt([
    {
      type: 'input',
      name: 'amount',
      message: message,
      validate: input => (parseFloat(input) > 0) ? true : 'Jumlah harus angka desimal lebih besar dari 0',
    },
  ]);
};

const walletChoicePrompt = () => {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'walletChoice',
      message: 'Gunakan dompet yang mana untuk transaksi?',
      loop: false,
      choices: [
        { name: 'Semua Multi-Dompet', value: 'multi' },
        { name: 'Hanya Dompet Utama', value: 'main' },
      ],
    }
  ]);
};

const tradeTokenPrompts = (action) => {
  const amountMessage = action === 'buy'
    ? 'Jumlah BNB (e.g., "0.01") yang akan digunakan oleh SETIAP dompet untuk membeli:'
    : 'Jumlah Token (e.g., "1000.5") yang akan dijual oleh SETIAP dompet:';
    
  return inquirer.prompt([
    {
      type: 'input',
      name: 'tokenAddress',
      message: 'Masukkan Contract Address (CA) token:',
      validate: input => /^0x[a-fA-F0-9]{40}$/.test(input) ? true : 'Alamat kontrak tidak valid',
    },
    {
      type: 'input',
      name: 'amount',
      message: amountMessage,
      validate: input => (parseFloat(input) > 0) ? true : 'Jumlah harus angka desimal lebih besar dari 0',
    },
  ]);
};

const snipePrompts = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'symbol',
      message: 'Masukkan Ticker/Symbol token yang akan di-snipe (case-sensitive):',
      validate: input => input ? true : 'Symbol tidak boleh kosong',
    },
    {
      type: 'input',
      name: 'buyAmountEth',
      message: 'Jumlah BNB (e.g., "0.01") yang akan digunakan SETIAP multi-wallet untuk membeli:',
      validate: input => (parseFloat(input) > 0) ? true : 'Jumlah harus angka desimal lebih besar dari 0',
    }
  ]);
};

const volumeBotPrompts = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'tokenAddress',
      message: 'Masukkan Contract Address (CA) token:',
      validate: input => /^0x[a-fA-F0-9]{40}$/.test(input) ? true : 'Alamat kontrak tidak valid',
    },
    {
      type: 'input',
      name: 'buyAmountEth',
      message: 'Jumlah BNB untuk Beli (e.g., "0.01"):',
      default: '0.01',
    },
    {
      type: 'input',
      name: 'sellAmountToken',
      message: 'Jumlah Token untuk Jual (e.g., "1000"):',
      default: '1000',
    },
    {
      type: 'input',
      name: 'intervalSeconds',
      message: 'Interval antar trade (detik):',
      default: '60',
    },
  ]);
};

const confirmActionPrompt = (message) => {
  return inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: message || 'Apakah Anda yakin ingin melanjutkan?',
      default: false,
    }
  ]);
};


module.exports = {
  mainMenu,
  createTokenPrompts,
  createTokenSubMenu,
  bundleBuyPrompt,
  generateWalletPrompts,
  fundWalletsPrompts,
  tradeTokenPrompts,
  walletChoicePrompt,
  snipePrompts,
  volumeBotPrompts,
  confirmActionPrompt,
};
