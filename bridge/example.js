
const BASE_URL = "https://api.zksync.io/api/v0.2/"

const LAST_TX = "0x71b03c9383fde7db41125db224d638f44544a2386b35550e737392d4f88403af"
const MY_ADDRESS = "0xcc9557f04633d82fb6a1741dcec96986cd8689ae"

async function fetchZkSync() {
  let lastTx = LAST_TX;
  let txs = []
  do {            
      txs = await getTransactionsFromZkSync(address,lastTx, 100);
      if(txs.length == 0) {
          return;
      }
      for(let i=1; i<txs.length;i++) {
        const tx = txs[i];

        if(tx.op.type != 'Transfer') { 
          continue; 
        }

        if (tx.op.to != MY_ADDRESS) {
          continue;
        }

        if (tx.status !== 'finalized' || tx.status !== 'committed') {
          continue;
        }

        const tokenId = tx.op.token;
        const token = syncProvider.tokenSet.resolveTokenSymbol(tokenId);

        const amountParsed = tx.op.amount;

        // part of batch tx, this is the fee tx - ignore
        if(amountParsed == 0) { continue; }
        const amount = syncProvider.tokenSet.formatToken(tokenId, amountParsed);

        const prosessed = await processTransactions(
            tx.txHash,
            token,
            amount,
            amountParsed,
            tx.createdAt
        );
      }
      lastTx = (txs.pop()).txHash;
      LAST_TX = lastTx;
  } while (txs.length > 90);
}

async function getTransactionsFromZkSync(account, latest, count) {
  let response, tx;
  try {
      response = await fetch(`${BASE_URL}accounts/${account}/transactions?from=${latest}&limit=${count}&direction=newer`);
      tx = await response.json();
  } catch (e) {
      return [];
  }    
  const result = (tx.status == 'success') ? tx.result?.list : [];
  return result;
}