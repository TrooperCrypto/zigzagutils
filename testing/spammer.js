import ethers from 'ethers';
import * as zksync from "zksync";
import WebSocket from 'ws';

//Settings
const zigzagChainId = 1000;
const keys = [
    "aaa",
    "bbb"
];

// globals
const MARKETS = {};
const MARKET_ALIAS = [];
const PRICES = {};
const WALLETS = {};
const QUOTES = [];

const zigzagWsUrl = {
    1:    "wss://zigzag-exchange.herokuapp.com",
    1000: "wss://secret-thicket-93345.herokuapp.com"
}

// Connect to zksync
const ETH_NETWORK = (zigzagChainId === 1) ? "mainnet" : "rinkeby";
const ethersProvider = ethers.getDefaultProvider(ETH_NETWORK);
let syncProvider;
try {
    syncProvider = await zksync.getDefaultProvider(ETH_NETWORK);
    for(let i=0; i<keys.length; i++) {
        let ethWallet = new ethers.Wallet(keys[i]);
        let syncWallet = await zksync.Wallet.fromEthSigner(ethWallet, syncProvider);
        if (!(await syncWallet.isSigningKeySet())) {
            console.log("setting sign key");
            const signKeyResult = await syncWallet.setSigningKey({
                feeToken: "ETH",
                ethAuthType: "ECDSA",
            });
            console.log(signKeyResult);
        }
        let accountId = await syncWallet.getAccountId();
        let account_state = await syncWallet.getAccountState();
        WALLETS[accountId] = {
            'ethWallet': ethWallet,
            'syncWallet': syncWallet,
            'account_state': account_state,
            'ORDER_BROADCASTING': false,
        }
    }
} catch (e) {
    console.log(e);
    throw new Error("Could not connect to zksync API");
}
console.log("zkSync connected.");

let zigzagws = new WebSocket(zigzagWsUrl[zigzagChainId]);
zigzagws.on('open', onWsOpen);
zigzagws.on('close', onWsClose);
zigzagws.on('error', console.error);

async function onWsOpen() {
    zigzagws.on('message', handleMessage);
    zigzagws.send(JSON.stringify({'op':'marketsreq', 'args':[zigzagChainId, true]}));
}

function onWsClose () {
    console.log("Websocket closed..");
    setTimeout(() => {
        console.log("..Restarting:")
        zigzagws = new WebSocket(zigzagWsUrl[zigzagChainId]);
        zigzagws.on('open', onWsOpen);
        zigzagws.on('close', onWsClose);
        zigzagws.on('error', onWsClose);
    }, 5000);
}

async function handleMessage(json) {
    const msg = JSON.parse(json);
    switch(msg.op) {
        case 'error':
            console.error(msg);
            break;
        case 'marketinfo2':
            console.log("Got marketinfo2");
            const marketinfos = msg.args[0];
            marketinfos.forEach(info => {
                MARKETS[info.alias] = info;
                MARKET_ALIAS.push(info.alias);
            });
            getQuotes();
            setTimeout(processQuotes, 1000);
            break;
        case "marketinfo":
            const marketInfo = msg.args[0];
            const marketId  = marketInfo.alias;
            if(!marketId) break;
            MARKETS[marketId] = marketInfo;
            break;
        case 'lastprice':
            const lastprices = msg.args[0];
            lastprices.forEach(l => {
                const marketId = l[0];
                const price = l[1];
                PRICES[marketId] = price;
            });
            break;
        case 'quote':
            const quote = msg.args;
            QUOTES.push(quote);
            break;
        default:
            break;
    }
}

async function getQuotes() {
    if(QUOTES.length > (Object.keys(WALLETS).length * 2)) {
        setTimeout(getQuotes, 500);
        return;
    }
    const marketCount = MARKET_ALIAS.length;
    const marketNumber = Math.floor(Math.random() * marketCount);
    const marketId = MARKET_ALIAS[marketNumber];
    const marketInfo = MARKETS[marketId];
    const side = (Math.random() > 0.5) ? 'b' : 's';
    const minSize = marketInfo.minSize;
    const maxSize = minSize * 25;
    const randomAmount = (Math.random() * (maxSize- minSize)) + minSize;
    let amount = 0;
    if(side == 's') {
        amount = randomAmount;
    } else {
        amount = randomAmount * PRICES[marketId];
    }

    const args = [zigzagChainId, marketId, side, amount];
    zigzagws.send(JSON.stringify({ "op":"requestquote", "args": args }));
    setTimeout(getQuotes, 100);
}

async function processQuotes() {
    for(let walletId in WALLETS) {
        if(QUOTES.length == 0) {
            setTimeout(processQuotes, 500);
            return;
        }
        const wallet = WALLETS[walletId];
        if(wallet.ORDER_BROADCASTING) {
            continue;
        }
        wallet.ORDER_BROADCASTING = true;
        try {
            await sendOrder(wallet, QUOTES.shift());
        } catch (e) {
            console.log(e)
            console.error("Error sending order.");
            wallet.ORDER_BROADCASTING = false;
        }
    }
    setTimeout(processQuotes, 500);
}

async function sendOrder(wallet, quote) {
    const chainId       = quote[0];
    const marketId      = quote[1];
    const side          = quote[2];
    const baseQuantity  = quote[3];
    const price         = quote[4];
    const quoteQuantity = quote[5];

    const marketInfo = MARKETS[marketId];
    let tokenBuy, tokenSell, sellQuantity, tokenRatio = {}, fullSellQuantity;
    if (side === 'b') {
        sellQuantity = parseFloat(quoteQuantity);
        tokenSell = marketInfo.quoteAssetId;
        tokenBuy = marketInfo.baseAssetId;
        tokenRatio[marketInfo.baseAssetId] = baseQuantity;
        tokenRatio[marketInfo.quoteAssetId] = quoteQuantity;
        fullSellQuantity = (sellQuantity * 10**(marketInfo.quoteAsset.decimals)).toLocaleString('fullwide', {useGrouping: false })
    } else if (side === 's') {
        sellQuantity = parseFloat(baseQuantity);
        tokenSell = marketInfo.baseAssetId;
        tokenBuy = marketInfo.quoteAssetId;
        tokenRatio[marketInfo.baseAssetId] = baseQuantity;
        tokenRatio[marketInfo.quoteAssetId] = quoteQuantity;
        fullSellQuantity = (sellQuantity * 10**(marketInfo.baseAsset.decimals)).toLocaleString('fullwide', {useGrouping: false })
    }

    const now_unix = Date.now() / 1000 | 0;
    const validUntil = now_unix + 120;
    const sellQuantityBN = ethers.BigNumber.from(fullSellQuantity);
    const packedSellQuantity = zksync.utils.closestPackableTransactionAmount(sellQuantityBN);
    const order = await wallet.syncWallet.getOrder({
        tokenSell,
        tokenBuy,
        amount: packedSellQuantity.toString(),
        ratio: zksync.utils.tokenRatio(tokenRatio),
        validUntil
    });
    const args = [chainId, marketId, order];
    zigzagws.send(JSON.stringify({ "op":"submitorder2", "args": args }));
    setTimeout(setActive, 4000, wallet);
}

function setActive(wallet) {
    wallet.ORDER_BROADCASTING = false;
}
