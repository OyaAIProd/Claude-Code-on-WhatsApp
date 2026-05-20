const path = require("path");

const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "portfolio.db");
const STARTING_BALANCE = 10000000;
const FEE_RATE = 0.003;
const DEFAULT_USD_IDR = 16400;

const COIN_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  LTC: "litecoin",
  ATOM: "cosmos",
  NEAR: "near",
  ARB: "arbitrum"
};

const BINANCE_SYMBOLS = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  BNB: "BNBUSDT",
  SOL: "SOLUSDT",
  ADA: "ADAUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  MATIC: "POLUSDT",
  LINK: "LINKUSDT",
  AVAX: "AVAXUSDT",
  LTC: "LTCUSDT",
  ATOM: "ATOMUSDT",
  NEAR: "NEARUSDT",
  ARB: "ARBUSDT"
};

const BINANCE_TO_SYM = Object.fromEntries(Object.entries(BINANCE_SYMBOLS).map(([k, v]) => [v, k]));

module.exports = {
  DB_DIR,
  DB_PATH,
  STARTING_BALANCE,
  FEE_RATE,
  DEFAULT_USD_IDR,
  COIN_IDS,
  BINANCE_SYMBOLS,
  BINANCE_TO_SYM
};
