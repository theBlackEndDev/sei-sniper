import { buyingIntervalIds, mintingIntervalIds } from './config.js';
import { getHoldings} from './helpers.js';
import { buySniper } from './buy-sniper.js';
import { mintSniper } from './mint-sniper.js';
import { restoreWallet } from "@sei-js/core";
import { getSigningCosmWasmClient } from "@sei-js/core";
import {fromHex} from "@cosmjs/encoding";
import {DirectSecp256k1Wallet} from "@cosmjs/proto-signing";


export let walletConfigs = process.env.RECOVERY_PHRASE.split(',');

export function removeWallet(senderAddress)
{
    if (mintingIntervalIds[senderAddress]) {
        clearInterval(mintingIntervalIds[senderAddress]);
        delete mintingIntervalIds[senderAddress]; // Remove the interval ID from tracking
    }
    walletConfigs = walletConfigs.filter(wallet => wallet !== senderAddress); // Remove the wallet
}

async function processConfig(config) {
    try {
        let restoredWallet = null;
        let senderAddress = null;

        if (config.includes(' ')) { // Recovery phrase
            restoredWallet = await restoreWallet(config);
            const accounts = await restoredWallet.getAccounts();
            senderAddress = accounts[0].address;
        } else { // Private key
            const privateKeyUint8array = fromHex(config.substring(2));
            restoredWallet = await DirectSecp256k1Wallet.fromKey(privateKeyUint8array, "sei");
            const [accounts] = await restoredWallet.getAccounts();
            senderAddress = accounts.address;
        }

        const signingCosmWasmClient = await getSigningCosmWasmClient(process.env.RPC_URL, restoredWallet, {gasPrice: process.env.GAS_LIMIT + "usei"});

        if(process.env.MODE === 'MINT'){
            console.log("Sniper in MINT mode");
            const pollingFrequency = parseFloat(process.env.POLLING_FREQUENCY) * 1000;
            if (!isNaN(pollingFrequency) && pollingFrequency > 0) {

                mintingIntervalIds[senderAddress] = setInterval(() => mintSniper(senderAddress, signingCosmWasmClient), pollingFrequency);
            } else {
                console.error("Invalid POLLING_FREQUENCY. Please set a valid number in seconds");
            }
        } else if (process.env.MODE === "BUY"){
            console.log("Sniper in BUY mode:"
             + "\nwith contract address: " + process.env.CONTRACT_ADDRESS
             + "\nwith token id: " + process.env.TOKEN_ID
             + "\nwith buy limit: " + process.env.BUY_LIMIT
             + "\nwith price limit: " + process.env.PRICE_LIMIT
             + "\nwith gas limit: " + process.env.GAS_LIMIT
             + "\nwith polling frequency: " + process.env.POLLING_FREQUENCY
            );
            console.log("\nSniper watching marketplace listings...");
            const pollingFrequency = parseFloat(process.env.POLLING_FREQUENCY) * 1000;
            if (!isNaN(pollingFrequency) && pollingFrequency > 0) {
                const intervalId = setInterval(() => buySniper(senderAddress, signingCosmWasmClient), pollingFrequency);
                buyingIntervalIds.push(intervalId);
            } else {
                console.error("Invalid POLLING_FREQUENCY. Please set a valid number in seconds");
            }
        } else {
            console.log("Invalid MODE! Try BUY or MINT");
        }
    } catch (error) {
        console.error("Error processing config: " + error.message);
    }
}

async function main() {
    if(process.env.MODE === 'MINT'){
        await Promise.allSettled(walletConfigs.map(config => processConfig(config.trim())));
    }else {
        walletConfigs.map(config => processConfig(config.trim()))
    }
}

main();
