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

// ... (createTokenPrompts) ...

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

// fundWalletsPrompts disederhanakan
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

const walletChoicePrompt = (action) => {
    const choices = [
      { name: 'Semua Multi-Dompet', value: 'multi' },
      { name: 'Hanya Dompet Utama', value: 'main' },
    ];

    if (action === 'sell') {
      // Menambahkan opsi "Semua Wallet" untuk Sell
      choices.unshift({ name: 'Semua Wallet (Main lalu Multi)', value: 'all' });
    }

  return inquirer.prompt([
    {
      type: 'list',
      name: 'walletChoice',
      message: 'Gunakan dompet yang mana untuk transaksi?',
      loop: false,
      choices: choices,
    }
  ]);
};


// Digunakan untuk BUY (jumlah BNB) dan Trade (hanya ambil CA)
const tradeTokenAddressPrompt = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'tokenAddress',
      message: 'Masukkan Contract Address (CA) token:',
      validate: input => /^0x[a-fA-F0-9]{40}$/.test(input) ? true : 'Alamat kontrak tidak valid',
    },
  ]);
};

// Digunakan hanya untuk BUY (meminta jumlah BNB)
const buyAmountPrompt = () => {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'amount',
      message: 'Jumlah BNB (e.g., "0.01") yang akan digunakan oleh SETIAP dompet untuk membeli:',
      validate: input => (parseFloat(input) > 0) ? true : 'Jumlah harus angka desimal lebih besar dari 0',
    }
  ]);
};


// Digunakan hanya untuk SELL (memilih persentase atau jumlah custom)
const sellAmountPrompt = (totalBalanceDisplay, symbol) => {
  return inquirer.prompt([
    {
      type: 'list',
      name: 'amountChoice',
      message: `Pilih jumlah jual. Saldo Total: ${totalBalanceDisplay} ${symbol}.`,
      loop: false,
      choices: [
        { name: '10% dari Saldo', value: '10' },
        { name: '25% dari Saldo', value: '25' },
        { name: '50% dari Saldo', value: '50' },
        { name: '100% dari Saldo', value: '100' },
        new inquirer.Separator(),
        { name: 'Jumlah Custom (e.g., 245000 atau 245k)', value: 'custom' },
      ],
    },
    {
      type: 'input',
      name: 'customAmount',
      message: 'Masukkan jumlah token yang akan dijual (e.g., 245000, 245k):',
      when: (answers) => answers.amountChoice === 'custom',
      validate: (input) => {
        // Logika validasi untuk angka atau format 'k'
        const normalized = input.replace(/,/g, '');
        let value = parseFloat(normalized);

        if (normalized.toLowerCase().endsWith('k')) {
          value = parseFloat(normalized.slice(0, -1)) * 1000;
        }
        
        return (value > 0 && !isNaN(value)) ? true : 'Jumlah custom tidak valid atau kurang dari 0';
      },
      filter: (input) => {
        // Ubah 'k' menjadi angka penuh
        const normalized = input.replace(/,/g, '');
        if (normalized.toLowerCase().endsWith('k')) {
          return parseFloat(normalized.slice(0, -1)) * 1000;
        }
        return parseFloat(normalized);
      }
    }
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
  walletChoicePrompt,
  tradeTokenAddressPrompt, // BARU: Hanya ambil CA
  buyAmountPrompt,        // BARU: Hanya ambil jumlah BNB (untuk buy)
  sellAmountPrompt,       // BARU: Ambil jumlah sell (persentase/custom)
  snipePrompts,
  volumeBotPrompts,
  confirmActionPrompt,
};
