import { clearAllIntervals, isValidListing, getFormattedTimestamp} from './helpers.js';
import { boughtTokenIds, isProcessingBuyQueue, executionQueue, updateProcessingBuyQueueStatus, targetTokenIds } from './config.js';

export async function buySniper(senderAddress, signingCosmWasmClient) {
    try {
      if(process.env.TOKEN_ID === "SWEEP" || process.env.TOKEN_ID === "AUTO") {
          const desiredTraits = JSON.parse(process.env.DESIRED_TRAITS || '[]');

          const palletListingResponse = await fetch(`https://api.prod.pallet.exchange/api/v2/nfts/${process.env.CONTRACT_ADDRESS}/tokens?token_id_exact=false&buy_now_only=true&timed_auction_only=false&not_for_sale=false&max_price=${process.env.PRICE_LIMIT}&sort_by_price=asc&sort_by_id=asc&page=1&page_size=25`);
        if (!palletListingResponse.ok) {
          let errorMsg = "";
          try {
              const errorData = await palletListingResponse.json();
              errorMsg = errorData.message || JSON.stringify(errorData); 
          } catch (parseError) {
              errorMsg = palletListingResponse.statusText;
          }
          throw new Error(`${getFormattedTimestamp()}:Failed to get pallet listings! ${errorMsg} Retrying...`);
        }
        const palletListingResponseData = await palletListingResponse.json();
        const filteredListings = filterByTraits(palletListingResponseData.tokens, desiredTraits);

          if (filteredListings.length > 0 && !isProcessingBuyQueue) {
              console.log(`${getFormattedTimestamp()}:Filtered listings valid! Sniping...`)
              filteredListings.forEach(listing => {
                  executionQueue.push({ senderAddress, palletListingResponseData: { tokens: [listing] }, signingCosmWasmClient});
              });
              await processQueue();
          }
      } else {
        const tokenIds = process.env.TOKEN_ID.split(',').map(id => parseInt(id.trim(), 10));

        for (const tokenId of tokenIds) {
          if (boughtTokenIds.has(tokenId)) {
            continue; // Skip this token id as it's already been bought
          }
          const palletListingResponse = await fetch(`https://api.prod.pallet.exchange/api/v2/nfts/${process.env.CONTRACT_ADDRESS}/tokens?token_id=${tokenId}&token_id_exact=true`);
          if (!palletListingResponse.ok) {
            let errorMsg = "";
            try {
                const errorData = await palletListingResponse.json();
                errorMsg = errorData.message || JSON.stringify(errorData); 
            } catch (parseError) {
                errorMsg = palletListingResponse.statusText;
            }
            throw new Error(`${getFormattedTimestamp()}:Failed to get pallet listing! ${errorMsg} Retrying...`);
          }
          const palletListingResponseData = await palletListingResponse.json();
    
          if (isValidListing(palletListingResponseData) && !isProcessingBuyQueue) {
            console.log(`${getFormattedTimestamp()}:Listing valid for token id: ${tokenId}! Sniping...`)
            executionQueue.push({ senderAddress, palletListingResponseData, signingCosmWasmClient});
            await processQueue();
          }
        }
      }
    } catch (error){
        console.log(`${getFormattedTimestamp()}:Snipe unsuccessful! " + ${error.message}`);
    }
}

function filterByTraits(listings, desiredTraits) {
    return listings.filter(listing => {
        const { traits } = listing.token; // Extract traits from the token information
        return traits.every(trait => {
            const { type, value } = trait;
            // Check if the current trait type and value match any of the desired traits
            return desiredTraits.some(desiredTrait =>
                desiredTrait.type === type && desiredTrait.value === value);
        });
    });
}


export async function processQueue() {
    if (isProcessingBuyQueue || executionQueue.length === 0) {
        return;
    }
  
    updateProcessingBuyQueueStatus(true);
    const { senderAddress, palletListingResponseData, signingCosmWasmClient} = executionQueue.shift();
  
    try {
      if(process.env.TOKEN_ID === "SWEEP"){
        await executeContractMultiple(senderAddress, palletListingResponseData, signingCosmWasmClient);
      }
      if(process.env.TOKEN_ID === "AUTO"){
        await executeContractAuto(senderAddress, palletListingResponseData, signingCosmWasmClient);
      }
      else{
        await executeContract(senderAddress, palletListingResponseData, signingCosmWasmClient);
      }
    } catch (error) {
        console.log(getFormattedTimestamp() + ":Snipe unsuccessful! " + error.message);
    } finally {
       updateProcessingBuyQueueStatus(false);
       await processQueue();
    }
  }
  
  export async function executeContract(senderAddress, palletListingResponseData, signingCosmWasmClient) {
    try {
        const msg =  {
          "buy_now": {
              "expected_price": {
                  "amount": palletListingResponseData.tokens[0].auction.price[0].amount,
                  "denom": "usei"
              },
              "nft": {
                  "address": process.env.CONTRACT_ADDRESS,
                  "token_id": palletListingResponseData.tokens[0].id
              }
          }
      };
  
        const amountString = palletListingResponseData.tokens[0].auction.price[0].amount;
        const amountNumber = parseFloat(amountString);
        const finalPalletAmount = amountNumber + (amountNumber * 0.02); //Add 2% for pallet fee
  
        const totalFunds = [{
          denom: 'usei',
          amount: finalPalletAmount.toString()
        }];
        
        const result = await signingCosmWasmClient.execute(senderAddress, "sei152u2u0lqc27428cuf8dx48k8saua74m6nql5kgvsu4rfeqm547rsnhy4y9", msg, "auto", "sniper", totalFunds );
        if(result.transactionHash){
          boughtTokenIds.add(palletListingResponseData.tokens[0].id_int);
          console.log(getFormattedTimestamp() + ":Snipe successful for token id:" + palletListingResponseData.tokens[0].id_int + ", Tx hash: " + result.transactionHash);

          if (boughtTokenIds.size === targetTokenIds.size || boughtTokenIds.size ===  process.env.BUY_LIMIT ) {
              console.log(getFormattedTimestamp() + ":All tokens have been successfully bought. Exiting...");
              clearAllIntervals();
              process.exit(0);
          }
        }
        else {
          console.log(getFormattedTimestamp() + ":Snipe unsuccessful!")
        }
      } catch (error) {
        console.log(getFormattedTimestamp() + ":Snipe unsuccessful! " + error.message);
      }
  }

  export async function executeContractMultiple(senderAddress, palletListingResponseData, signingCosmWasmClient) {
    try {

      let batchBids = {
        "batch_bids": {
            "bids": []
        }
      };

      const batchBidsSliced = palletListingResponseData.tokens.slice(0, process.env.BUY_LIMIT).map(token => ({
        "bid_type": {
          "buy_now": {
            "expected_price": {
              "amount": token.auction.price[0].amount.toString(),
              "denom": "usei"
            }
          }
        },
        "nft": {
          "address": process.env.CONTRACT_ADDRESS,
          "token_id": token.id_int.toString()
        }
      }));

        batchBids.batch_bids.bids = batchBidsSliced;

        let totalAmount = 0;
        batchBidsSliced.forEach(bid => {
          let amount = parseFloat(bid.bid_type.buy_now.expected_price.amount);
          totalAmount += amount + (amount * 0.02); // Add amount with 2% fee to total
        });
        const totalFunds = [{
            denom: 'usei',
            amount: totalAmount.toString()
        }];

        const result = await signingCosmWasmClient.execute(senderAddress, "sei152u2u0lqc27428cuf8dx48k8saua74m6nql5kgvsu4rfeqm547rsnhy4y9", batchBids, "auto", "sniper", totalFunds);

        if (result.transactionHash) {
            console.log(getFormattedTimestamp() + ":Snipe successful! Tx hash: " + result.transactionHash);
            console.log(getFormattedTimestamp() + ":All tokens have been successfully bought. Exiting...");
            clearAllIntervals();
            process.exit(0);
        } else {
            console.log(getFormattedTimestamp() + ":Snipe unsuccessful!");
        }
    } catch (error) {
        console.log(getFormattedTimestamp() + ":Snipe unsuccessful! " + error.message);
    }
  }

  export async function executeContractAuto(senderAddress, palletListingResponseData, signingCosmWasmClient) {
    for (const token of palletListingResponseData.tokens) {
      try {
        const bid = {
          "buy_now": {
            "expected_price": {
              "amount": token.auction.price[0].amount.toString(),
              "denom": "usei"
            },
            "nft": {
              "address": process.env.CONTRACT_ADDRESS,
              "token_id": token.id.toString()
            }
          }
        };

        const amountNumber = parseFloat(token.auction.price[0].amount);
        const finalAmount = amountNumber + (amountNumber * 0.02); // 2% fee

        const totalFunds = [{
            denom: 'usei',
            amount: finalAmount.toString()
        }];

        const result = await signingCosmWasmClient.execute(senderAddress, "sei152u2u0lqc27428cuf8dx48k8saua74m6nql5kgvsu4rfeqm547rsnhy4y9", bid, "auto", "sniper", totalFunds);
  
        if (result.transactionHash) {
            boughtTokenIds.add(token.id_int);
            const buyLimit = parseInt(process.env.BUY_LIMIT, 10); 
            console.log(getFormattedTimestamp() + ":Snipe successful for token id:" + token.id_int + ", Tx hash: " + result.transactionHash);
            if (boughtTokenIds.size ===  buyLimit) {
                console.log(getFormattedTimestamp() + ":All tokens have been successfully bought. Exiting...");
                process.exit(0);
            }
        } else {
            console.log(getFormattedTimestamp() + `:Snipe unsuccessful for token id: ${token.id}`);
        }
      } catch (error) {
        console.log(getFormattedTimestamp() + ":Snipe unsuccessful! " + error.message);
      }
    }
  }
