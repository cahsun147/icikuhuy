// src/services/api.js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { API_ENDPOINTS, NETWORK } = require('../utils/config');
const logger = require('../utils/logger');

/**
 * Step 1: Get Nonce
 */
async function getNonce(address) {
  logger.info('Mendapatkan nonce dari server...');
  try {
    const response = await axios.post(API_ENDPOINTS.GENERATE_NONCE, {
      accountAddress: address,
      verifyType: "LOGIN",
      networkCode: NETWORK,
    });
    if (response.data.code === "0") {
      logger.success('Nonce didapatkan.');
      return response.data.data;
    } else {
      throw new Error(response.data.message || 'Gagal mendapatkan nonce');
    }
  } catch (e) {
    logger.error(`API Error (getNonce): ${e.message}`);
    return null;
  }
}

/**
 * Step 2: User Login
 */
async function login(address, signature, nonce) {
  logger.info('Melakukan login ke server...');
  try {
    const response = await axios.post(API_ENDPOINTS.LOGIN, {
      region: "WEB",
      langType: "EN",
      loginIp: "",
      inviteCode: "",
      verifyInfo: {
        address: address,
        networkCode: NETWORK,
        signature: signature,
        verifyType: "LOGIN"
      },
      walletName: "MetaMask"
    });
    
    if (response.data.code === "0") {
      logger.success('Login berhasil.');
      return response.data.data; // access_token
    } else {
      throw new Error(response.data.message || 'Gagal login');
    }
  } catch (e) {
    logger.error(`API Error (login): ${e.message}`);
    return null;
  }
}

/**
 * Step 3: Upload Token Image
 */
async function uploadImage(filePath, accessToken) {
  logger.info(`Mengunggah gambar: ${filePath}...`);
  if (!fs.existsSync(filePath)) {
    logger.error('File gambar tidak ditemukan.');
    return null;
  }
  
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  
  try {
    const response = await axios.post(API_ENDPOINTS.UPLOAD_IMAGE, form, {
      headers: {
        ...form.getHeaders(),
        'meme-web-access': accessToken,
      },
    });
    
    if (response.data.code === "0") {
      logger.success('Gambar berhasil diunggah.');
      return response.data.data; // image URL
    } else {
      throw new Error(response.data.message || 'Gagal unggah gambar');
    }
  } catch (e) {
    logger.error(`API Error (uploadImage): ${e.message}`);
    return null;
  }
}

/**
 * Step 4: Create Token (Get Signature)
 */
async function getCreateTokenParams(tokenData, accessToken) {
  logger.info('Mendapatkan parameter createToken dari server...');
  
  // Menggabungkan parameter custom dengan parameter fixed
  const payload = {
    ...tokenData, // name, shortName, desc, imgUrl, label, etc.
    
    // Fixed Parameters from API-CreateToken.md
    totalSupply: 1000000000,
    raisedAmount: 24,
    saleRate: 0.8,
    reserveRate: 0,
    funGroup: false,
    clickFun: false,
    symbol: "BNB", // Base currency
    lpTradingFee: 0.0025, // Fixed trading fee
  };
  
  try {
    const response = await axios.post(API_ENDPOINTS.CREATE_TOKEN, payload, {
      headers: {
        'meme-web-access': accessToken,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.data.code === "0") {
      logger.success('Parameter (createArg & signature) didapatkan.');
      // Response API harusnya berisi 'createArg' dan 'signature'
      // Saya asumsikan formatnya ada di `response.data.data`
      if (!response.data.data.createArg || !response.data.data.signature) {
         throw new Error('Respon API tidak mengandung createArg or signature');
      }
      return {
        createArg: response.data.data.createArg,
        signature: response.data.data.signature,
      };
    } else {
      throw new Error(response.data.message || 'Gagal membuat token');
    }
  } catch (e) {
    logger.error(`API Error (createToken): ${e.message}`);
    return null;
  }
}

module.exports = {
  getNonce,
  login,
  uploadImage,
  getCreateTokenParams,
};