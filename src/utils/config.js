// src/utils/config.js
require('dotenv').config();
const path = require('path');

//const API_DOCS = require('../../API-Documents.md'); // Ini hanya untuk referensi manual, tidak di-parse

// Alamat Kontrak dari API-Documents.md
const CONTRACT_ADDRESSES = {
  BSC: {
    TOKEN_MANAGER_V1: '0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC',
    TOKEN_MANAGER_V2: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
    TOKEN_MANAGER_HELPER_V3: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
  }
};

// API Endpoints from API-CreateToken.md
const API_BASE_URL = 'https://four.meme/meme-api';
const API_ENDPOINTS = {
  GENERATE_NONCE: `${API_BASE_URL}/v1/private/user/nonce/generate`,
  LOGIN: `${API_BASE_URL}/v1/private/user/login/dex`,
  UPLOAD_IMAGE: `${API_BASE_URL}/v1/private/token/upload`,
  CREATE_TOKEN: `${API_BASE_URL}/v1/private/token/create`,
};

// ABIs
const ABI_PATH = path.join(__dirname, '../../abi');
const ABIS = {
  TOKEN_MANAGER_V1: require(path.join(ABI_PATH, 'TokenManagerV1.json')),
  TOKEN_MANAGER_V2: require(path.join(ABI_PATH, 'TokenManagerV2.json')),
  TOKEN_MANAGER_HELPER_V3: require(path.join(ABI_PATH, 'TokenManagerHelperV3.json')),
  ERC20: require(path.join(ABI_PATH, 'ERC20.json')),
};

// Paths
const WALLETS_FILE_PATH = path.join(__dirname, '../../wallets.json');

module.exports = {
  MAIN_WALLET_PK: process.env.MAIN_WALLET_PRIVATE_KEY,
  RPC_URL: process.env.BSC_RPC_URL,
  NETWORK: 'BSC',
  CONTRACT_ADDRESSES: CONTRACT_ADDRESSES[this.NETWORK] || CONTRACT_ADDRESSES.BSC,
  API_ENDPOINTS,
  ABIS,
  WALLETS_FILE_PATH,
  LABELS: [
    'Meme', 'AI', 'Defi', 'Games', 'Infra', 'De-Sci', 
    'Social', 'Depin', 'Charity', 'Others'
  ]
};